import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLog";
import { formatCurrency } from "@/lib/invoiceUtils";
import { calculateRoundFee, calculateTotalsForRounds, VAT_RATE } from "@/lib/roundPricing";
import {
  getEarliestBookableMonday,
  getRoundEndDate,
  getReservationExpiry,
  formatDayMonth,
} from "@/lib/bookingDates";
import { RESERVATIONS_CHANGED_EVENT } from "./ReservationBasket";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  sceneId: string;
  sceneName: string;
  projectName?: string;
  onBooked: () => void;
}

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;

// One week between a round's delivery and the next round's start (default
// cadence; matches scene_rounds.buffer_weeks default of 1).
function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}

export function BookingModal({ isOpen, onClose, sceneId, sceneName, projectName, onBooked }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const earliest = useMemo(() => getEarliestBookableMonday(), []);
  const [startRoundNumber, setStartRoundNumber] = useState(1);
  const [numRounds, setNumRounds] = useState(1);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const roundNumbers = useMemo(
    () => Array.from({ length: numRounds }, (_, i) => startRoundNumber + i),
    [numRounds, startRoundNumber],
  );
  const totals = useMemo(() => calculateTotalsForRounds(roundNumbers), [roundNumbers]);

  // Pass 1: round start dates are auto-computed (Round 1 = earliest bookable
  // Monday; each later round = previous delivery + one week). User-selectable
  // dates land in Pass 2. The wizard steps still render one screen per round.
  const startDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < numRounds; i++) {
      if (i === 0) dates.push(earliest);
      else dates.push(addWeeks(getRoundEndDate(dates[i - 1]), 1));
    }
    return dates;
  }, [earliest, numRounds]);

  // Total steps = ROUNDS (1) + one per round + REVIEW (1).
  const totalSteps = 2 + numRounds;
  const reviewStep = totalSteps - 1;

  // Step labels for the progress indicator.
  const stepLabels = useMemo(() => {
    const labels = ["ROUNDS"];
    for (let i = 0; i < numRounds; i++) {
      labels.push(`ROUND ${String(startRoundNumber + i).padStart(2, "0")}`);
    }
    labels.push("REVIEW");
    return labels;
  }, [numRounds, startRoundNumber]);

  // Derive the next round number from existing non-cancelled rounds on the scene.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("scene_rounds")
        .select("round_number, status")
        .eq("scene_id", sceneId);
      if (cancelled) return;
      const maxNum = (data || [])
        .filter((r: { status: string }) => r.status !== "cancelled")
        .reduce((m: number, r: { round_number: number }) => Math.max(m, r.round_number), 0);
      setStartRoundNumber(maxNum + 1);
    })();
    return () => { cancelled = true; };
  }, [isOpen, sceneId]);

  // Reset to the first step on each open.
  useEffect(() => {
    if (!isOpen) return;
    setNumRounds(1);
    setCurrentStep(0);
  }, [isOpen]);

  // If numRounds shrinks while on a now-out-of-range step, clamp.
  useEffect(() => {
    setCurrentStep((s) => Math.min(s, 2 + numRounds - 1));
  }, [numRounds]);

  const nextStep = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, 2 + numRounds - 1));
  }, [numRounds]);

  const prevStep = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const goToStep = useCallback((n: number) => {
    setCurrentStep((s) => (n < s ? n : s));
  }, []);

  const valid = !!user;

  async function handleConfirm() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const bookingGroupId = crypto.randomUUID();
      const firstStart = startDates[0];
      const expiry = getReservationExpiry(firstStart);
      const rows = roundNumbers.map((rn, i) => ({
        scene_id: sceneId,
        round_number: rn,
        status: "reserved",
        start_date: startDates[i].toISOString(),
        end_date: getRoundEndDate(startDates[i]).toISOString(),
        round_fee: calculateRoundFee(rn),
        reservation_expires_at: expiry.toISOString(),
        booking_group_id: bookingGroupId,
        instructions: null,
        created_by: user!.id,
      }));
      const { error } = await supabase.from("scene_rounds").insert(rows as never);
      if (error) throw error;

      await logActivity({
        action: "round_reserved",
        description: `Reserved ${numRounds} round${numRounds === 1 ? "" : "s"} on ${sceneName}`,
        entityType: "scene",
        entityId: sceneId,
        sceneName,
        metadata: { booking_group_id: bookingGroupId, rounds: roundNumbers, gross_total: totals.grossTotal },
      });

      window.dispatchEvent(new Event(RESERVATIONS_CHANGED_EVENT));
      toast({
        title: "Booking reserved",
        description: `Payment required by ${expiry.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to confirm production.`,
      });
      onBooked();
      onClose();
    } catch (err) {
      console.error("[BookingModal] reservation failed:", err);
      toast({ title: "Couldn't reserve the booking", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const nextButton = (
    <button
      type="button"
      onClick={nextStep}
      className="inline-flex h-12 items-center border border-gold bg-transparent px-8 font-sans uppercase text-[10px] tracking-[0.26em] text-strong transition-opacity hover:opacity-80"
      style={{ borderRadius: 2 }}
    >
      Next
    </button>
  );

  const backLink = (
    <button
      type="button"
      onClick={prevStep}
      className="font-sans uppercase text-[10px] tracking-[0.26em] text-label hover:text-strong transition-colors"
    >
      ‹ Back
    </button>
  );

  // ── Step 0: ROUNDS ────────────────────────────────────────────────────────
  const renderRoundsStep = () => (
    <div className="flex flex-col items-center text-center">
      <h3 className="font-serif text-strong" style={{ fontSize: 28 }}>How many rounds?</h3>
      <p className="mt-4 max-w-[440px] font-serif text-standard" style={{ fontSize: 15, lineHeight: 1.6 }}>
        Round 01 is the design realisation round. Further rounds are corrections and revisions to your feedback.
      </p>
      <p className="mt-3 max-w-[440px] font-serif italic text-label" style={{ fontSize: 13, lineHeight: 1.6 }}>
        Additional rounds may be booked at any time after your final delivery.
      </p>
      <div className="mt-10 flex items-center gap-8">
        <button
          type="button"
          onClick={() => setNumRounds((n) => Math.max(MIN_ROUNDS, n - 1))}
          disabled={numRounds <= MIN_ROUNDS}
          className="font-sans uppercase text-label transition-colors hover:text-strong disabled:opacity-30 disabled:hover:text-label"
          style={{ fontSize: 24 }}
          aria-label="Fewer rounds"
        >
          −
        </button>
        <span className="w-16 text-center font-serif text-strong tabular-nums" style={{ fontSize: 36 }}>{numRounds}</span>
        <button
          type="button"
          onClick={() => setNumRounds((n) => Math.min(MAX_ROUNDS, n + 1))}
          disabled={numRounds >= MAX_ROUNDS}
          className="font-sans uppercase text-label transition-colors hover:text-strong disabled:opacity-30 disabled:hover:text-label"
          style={{ fontSize: 24 }}
          aria-label="More rounds"
        >
          +
        </button>
      </div>
    </div>
  );

  // ── Steps 1…N: per-round date (Pass 1 placeholder) ─────────────────────────
  const renderDateStep = (roundIdx: number) => {
    const rn = startRoundNumber + roundIdx;
    return (
      <div className="flex flex-col items-center text-center">
        <h3 className="font-serif text-strong" style={{ fontSize: 28 }}>
          When should Round {String(rn).padStart(2, "0")} begin?
        </h3>
        <p className="mt-4 max-w-[440px] font-serif text-standard" style={{ fontSize: 15, lineHeight: 1.6 }}>
          [Date selector lands in Pass 2]
        </p>
      </div>
    );
  };

  // ── Step N+1: REVIEW ───────────────────────────────────────────────────────
  const renderReviewStep = () => (
    <div className="flex flex-col">
      <h3 className="text-center font-serif text-strong" style={{ fontSize: 28 }}>Review your booking</h3>

      <p className="mt-8 font-sans text-[9px] uppercase tracking-[0.28em] text-label">Production schedule</p>
      <div className="mt-3">
        {roundNumbers.map((rn, i) => (
          <div key={rn} className="flex items-center justify-between border-b border-border py-3">
            <span className="font-sans uppercase text-[11px] tracking-[0.16em] text-standard">
              Round {String(rn).padStart(2, "0")}
            </span>
            <span className="font-serif tabular-nums text-standard" style={{ fontSize: 14 }}>
              {formatDayMonth(startDates[i])} → {formatDayMonth(getRoundEndDate(startDates[i]))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-serif italic text-label" style={{ fontSize: 13, lineHeight: 1.6 }}>
        Round dates may shift if feedback is delayed. Briefs must arrive by Friday 12:00 for the round starting the following Monday.
      </p>

      <div className="mt-8 space-y-2">
        <div className="flex items-center justify-between font-sans text-[13px]">
          <span className="text-standard">Net total</span>
          <span className="tabular-nums text-standard">{formatCurrency(totals.netTotal, "GBP")}</span>
        </div>
        <div className="flex items-center justify-between font-sans text-[13px]">
          <span className="text-standard">VAT ({Math.round(VAT_RATE * 100)}%)</span>
          <span className="tabular-nums text-standard">{formatCurrency(totals.vatAmount, "GBP")}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 font-sans" style={{ fontSize: 18 }}>
          <span className="text-strong">Total</span>
          <span className="tabular-nums text-strong">{formatCurrency(totals.grossTotal, "GBP")}</span>
        </div>
      </div>
    </div>
  );

  const isRoundsStep = currentStep === 0;
  const isReviewStep = currentStep === reviewStep;
  const dateRoundIdx = !isRoundsStep && !isReviewStep ? currentStep - 1 : -1;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={() => !submitting && onClose()} />
      <div className="relative z-10 flex w-full max-w-[640px] flex-col border border-border/60 bg-card p-8 shadow-2xl" style={{ borderRadius: 4, minHeight: 560, maxHeight: "90vh" }}>
        {/* Header — constant across steps */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-strong" style={{ fontSize: 18 }}>Book production rounds</h2>
            <p className="mt-1 font-sans text-[11px] uppercase tracking-[0.16em] text-label">
              {projectName ? `${projectName} — ` : ""}{sceneName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="font-sans uppercase text-[10px] tracking-[0.26em] text-label hover:text-strong transition-colors"
          >
            Close
          </button>
        </div>

        {/* Progress indicator */}
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {stepLabels.map((label, i) => {
            const isActive = i === currentStep;
            const isCompleted = i < currentStep;
            return (
              <Fragment key={`${label}-${i}`}>
                {i > 0 && <span className="font-sans text-[10px] text-label">·</span>}
                <button
                  type="button"
                  onClick={() => isCompleted && goToStep(i)}
                  disabled={!isCompleted}
                  className={[
                    "font-sans uppercase text-[10px] tracking-[0.18em] transition-colors",
                    isActive
                      ? "text-strong"
                      : isCompleted
                      ? "text-standard cursor-pointer hover:text-strong"
                      : "text-recessive cursor-default",
                  ].join(" ")}
                >
                  {label}
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* Step body — vertically centred, fills remaining height */}
        <div className="flex flex-1 flex-col justify-center py-8">
          {isRoundsStep && renderRoundsStep()}
          {dateRoundIdx >= 0 && renderDateStep(dateRoundIdx)}
          {isReviewStep && renderReviewStep()}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div>{!isRoundsStep && backLink}</div>
          <div>
            {isReviewStep ? (
              <button
                type="button"
                disabled={!valid || submitting}
                onClick={handleConfirm}
                className="inline-flex h-12 items-center border border-gold bg-transparent px-8 font-sans uppercase text-[10px] tracking-[0.26em] text-strong transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ borderRadius: 2 }}
              >
                {submitting ? "Reserving…" : "Confirm booking"}
              </button>
            ) : (
              nextButton
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
