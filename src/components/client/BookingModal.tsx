import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { Minus, Plus, X, Check } from "lucide-react";
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
  isMonday,
  isSameDay,
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

const MAX_ROUNDS = 6;
const DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function BookingModal({ isOpen, onClose, sceneId, sceneName, projectName, onBooked }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const earliest = useMemo(() => getEarliestBookableMonday(), []);
  const [startRoundNumber, setStartRoundNumber] = useState(1);
  const [numRounds, setNumRounds] = useState(1);
  const [mondays, setMondays] = useState<(Date | null)[]>([]);
  const [activeRound, setActiveRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const roundNumbers = useMemo(
    () => Array.from({ length: numRounds }, (_, i) => startRoundNumber + i),
    [numRounds, startRoundNumber],
  );
  const totals = useMemo(() => calculateTotalsForRounds(roundNumbers), [roundNumbers]);

  // Progressive section reveal — guide the eye top-to-bottom as dates are placed.
  const hasAnyDatePlaced = mondays.some((m) => m !== null);
  const allDatesPlaced = mondays.length === numRounds && mondays.every((m) => m !== null);

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

  // Pills start empty — the client picks a pill, then points at a Monday
  // (airline seat selection). Reset to a single empty pill on each open.
  useEffect(() => {
    if (!isOpen) return;
    setNumRounds(1);
    setMondays([null]);
    setActiveRound(0);
  }, [isOpen]);

  // Pad/truncate the placed-dates array as the stepper changes (preserve picks).
  useEffect(() => {
    setMondays((prev) => Array.from({ length: numRounds }, (_, i) => prev[i] ?? null));
  }, [numRounds]);

  const minMondayFor = useCallback(
    (idx: number): Date => {
      if (idx === 0) return earliest;
      const prev = mondays[idx - 1];
      return prev ? getRoundEndDate(prev) : earliest;
    },
    [earliest, mondays],
  );

  const pickMonday = useCallback((day: Date) => {
    const next = mondays.slice();
    next[activeRound] = day;
    // Push any later PLACED rounds forward so they stay sequential.
    for (let i = activeRound + 1; i < next.length; i++) {
      const prev = next[i - 1];
      if (next[i] == null || prev == null) continue;
      const minStart = getRoundEndDate(prev);
      if (next[i]! < minStart) next[i] = minStart;
    }
    setMondays(next);
    // Auto-advance to the first still-empty pill (sequential seat-picking).
    const firstEmpty = next.findIndex((m) => m == null);
    setActiveRound(firstEmpty >= 0 ? firstEmpty : activeRound);
  }, [mondays, activeRound]);

  const valid = mondays.length === numRounds && mondays.every((m) => m != null) && !!user;

  async function handleConfirm() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const bookingGroupId = crypto.randomUUID();
      const firstStart = mondays[0]!;
      const expiry = getReservationExpiry(firstStart);
      const rows = roundNumbers.map((rn, i) => ({
        scene_id: sceneId,
        round_number: rn,
        status: "reserved",
        start_date: mondays[i]!.toISOString(),
        end_date: getRoundEndDate(mondays[i]!).toISOString(),
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

  const months = [startOfMonth(earliest), addMonths(earliest, 1)];

  const renderMonth = (monthStart: Date) => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const total = daysInMonth(year, month);
    const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first offset
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
    const minForActive = minMondayFor(activeRound);

    return (
      <div key={`${year}-${month}`} className="flex-1 min-w-0">
        <p className="mb-2 text-center font-sans text-[11px] uppercase tracking-[0.2em] text-foreground/60">
          {monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <div className="grid grid-cols-7 gap-1">
          {DAY_HEADERS.map((h, i) => (
            <div key={i} className="text-center font-sans text-[9px] text-foreground/30">{h}</div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const mon = isMonday(day);
            // Is this day inside any selected round's week?
            const roundIdx = mondays.findIndex(
              (m) => m && day >= m && day < getRoundEndDate(m),
            );
            const inWeek = roundIdx >= 0;
            const isStart = roundIdx >= 0 && isSameDay(day, mondays[roundIdx]!);
            // Is this day inside a feedback gap between two consecutive placed
            // rounds? (delivery Monday of round i → start Monday of round i+1).
            const inFeedbackWeek =
              !inWeek &&
              mondays.some((m, idx) => {
                const next = mondays[idx + 1];
                return m != null && next != null && day >= getRoundEndDate(m) && day < next;
              });
            // Feedback-gap Mondays are not bookable.
            const selectable = mon && day >= minForActive && !inFeedbackWeek;
            return (
              <button
                key={i}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && pickMonday(day)}
                className={[
                  "aspect-square flex items-center justify-center rounded-sm font-sans text-[11px] tabular-nums transition-colors",
                  inWeek
                    ? "bg-gold/15 text-foreground"
                    : inFeedbackWeek
                    ? "bg-muted/20 text-foreground/40 cursor-default"
                    : selectable
                    ? "text-foreground hover:bg-gold/10 cursor-pointer"
                    : "text-foreground/20 cursor-default",
                  isStart ? "ring-1 ring-gold font-semibold" : "",
                ].join(" ")}
                title={isStart && roundIdx >= 0 ? `Round ${String(roundNumbers[roundIdx]).padStart(2, "0")}` : undefined}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={() => !submitting && onClose()} />
      <div className="relative z-10 w-full max-w-[800px] max-h-[90vh] overflow-y-auto border border-border/60 bg-card p-6 shadow-2xl" style={{ borderRadius: 4 }}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-strong" style={{ fontSize: 22 }}>Book production rounds</h2>
            <p className="mt-1 font-sans text-[12px] text-gold">
              {projectName ? `${projectName} — ` : ""}{sceneName}
            </p>
          </div>
          <button onClick={() => !submitting && onClose()} aria-label="Close" className="text-label hover:text-strong transition-colors">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Section 1 — Rounds */}
        <section className="mb-8">
          <p className="mb-3 font-sans text-[9px] uppercase tracking-[0.28em] text-label">Rounds</p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setNumRounds((n) => Math.max(1, n - 1))}
                disabled={numRounds <= 1}
                className="flex h-8 w-8 items-center justify-center border border-border/60 disabled:opacity-30"
                style={{ borderRadius: 2 }}
                aria-label="Fewer rounds"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center font-serif text-strong" style={{ fontSize: 20 }}>{numRounds}</span>
              <button
                type="button"
                onClick={() => setNumRounds((n) => Math.min(MAX_ROUNDS, n + 1))}
                disabled={numRounds >= MAX_ROUNDS}
                className="flex h-8 w-8 items-center justify-center border border-border/60 disabled:opacity-30"
                style={{ borderRadius: 2 }}
                aria-label="More rounds"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="flex-1 font-sans text-[12px] leading-relaxed text-recessive">
              Round 01 is the design realisation round. Rounds 02+ are corrections and revisions.
            </p>
          </div>

          {/* Round pills — pick a pill, then point at a Monday on the calendar
              (airline seat selection). The pill is the change affordance. */}
          <div className="mt-4 flex flex-wrap gap-2">
            {roundNumbers.map((rn, i) => {
              const start = mondays[i];
              const placed = start != null;
              const active = activeRound === i;
              const nextStart = mondays[i + 1];
              // A feedback period sits between this round and the next when both
              // have dates placed and there's a real gap (next start strictly
              // after this round's delivery Monday).
              const showFeedback =
                placed &&
                i + 1 < roundNumbers.length &&
                nextStart != null &&
                nextStart > getRoundEndDate(start);
              return (
                <Fragment key={rn}>
                  <button
                    type="button"
                    onClick={() => setActiveRound(i)}
                    aria-pressed={active}
                    className={[
                      "flex min-w-[88px] flex-col items-start gap-0.5 border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-gold bg-gold/10 text-gold"
                        : placed
                        ? "border-gold/40 text-standard"
                        : "border-border/50 text-recessive hover:border-foreground/40",
                    ].join(" ")}
                    style={{ borderRadius: 2, ...(placed && !active ? { borderLeftWidth: 3, borderLeftColor: "hsl(var(--gold))" } : {}) }}
                  >
                    <span className="font-sans uppercase text-[10px] tracking-[0.16em]">
                      Round {String(rn).padStart(2, "0")}
                    </span>
                    {placed && (
                      <span className="font-sans uppercase text-[11px] tabular-nums opacity-80">
                        {formatDayMonth(start).toUpperCase()} → {formatDayMonth(getRoundEndDate(start)).toUpperCase()}
                      </span>
                    )}
                  </button>
                  {showFeedback && (
                    <div
                      aria-hidden
                      className="flex min-w-[88px] flex-col items-start gap-0.5 border border-border/30 bg-muted/20 px-3 py-2 text-left text-foreground/55"
                      style={{ borderRadius: 2 }}
                    >
                      <span className="font-sans uppercase text-[10px] tracking-[0.16em]">
                        Client feedback
                      </span>
                      <span className="font-sans uppercase text-[11px] tabular-nums opacity-80">
                        {formatDayMonth(getRoundEndDate(start)).toUpperCase()} → {formatDayMonth(nextStart).toUpperCase()}
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </section>

        {/* Section 2 — Production dates */}
        <section className={"mb-8 transition-opacity duration-300 " + (hasAnyDatePlaced ? "opacity-100" : "opacity-50")}>
          <p className="mb-3 font-sans text-[9px] uppercase tracking-[0.28em] text-label">Production dates</p>
          {!hasAnyDatePlaced && (
            <p className="mb-3 -mt-1 font-sans text-[11px] leading-relaxed text-gold/70">
              Click a round pill above, then select a Monday below
            </p>
          )}
          <div className="flex flex-col gap-6 sm:flex-row">
            {months.map(renderMonth)}
          </div>

          <p className="mt-4 font-sans text-[11px] leading-relaxed text-label">
            Round 02+ dates may shift if feedback is delayed. Instructions for each round must be provided by 12:00 on the Friday before the round starts.
          </p>
        </section>

        {/* Section 3 — Pricing */}
        <section className={"mb-8 transition-opacity duration-300 " + (allDatesPlaced ? "opacity-100" : "opacity-30")}>
          <p className="mb-3 font-sans text-[9px] uppercase tracking-[0.28em] text-label">Pricing</p>
          {!allDatesPlaced && (
            <p className="mb-3 -mt-1 font-sans text-[11px] leading-relaxed text-gold/70">
              Place all round dates to see total
            </p>
          )}
          <div className="space-y-1.5">
            {totals.breakdown.map((b) => (
              <div key={b.roundNumber} className="flex items-center justify-between font-sans text-[13px]">
                <span className="text-standard">Round {String(b.roundNumber).padStart(2, "0")}</span>
                <span className="tabular-nums text-standard">{formatCurrency(b.fee, "GBP")}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-border/30 pt-2 font-sans text-[13px]">
              <span className="text-recessive">Net total</span>
              <span className="tabular-nums text-standard">{formatCurrency(totals.netTotal, "GBP")}</span>
            </div>
            <div className="flex items-center justify-between font-sans text-[13px]">
              <span className="text-recessive">VAT ({Math.round(VAT_RATE * 100)}%)</span>
              <span className="tabular-nums text-standard">{formatCurrency(totals.vatAmount, "GBP")}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/30 pt-2 font-sans" style={{ fontSize: 15 }}>
              <span className="text-strong">Gross total</span>
              <span className="tabular-nums font-semibold" style={{ color: "hsl(var(--gold))" }}>{formatCurrency(totals.grossTotal, "GBP")}</span>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => !submitting && onClose()} className="font-sans uppercase text-[10px] tracking-[0.26em] text-label hover:text-strong transition-colors">
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 bg-gold px-5 py-2.5 font-sans uppercase text-[10px] tracking-[0.26em] text-background transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ borderRadius: 2 }}
          >
            {submitting ? "Reserving…" : <><Check className="h-3.5 w-3.5" /> Confirm booking</>}
          </button>
        </div>
      </div>
    </div>
  );
}
