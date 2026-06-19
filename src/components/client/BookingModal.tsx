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
  isMonday,
  isSameDay,
} from "@/lib/bookingDates";
import { RESERVATIONS_CHANGED_EVENT } from "./ReservationBasket";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  sceneId: string;
  sceneName: string;
  projectName?: string;
  onBooked: () => void;
  bookingMode?: 'calendar' | 'calendar_no_quote' | 'delivery' | 'delivery_no_quote';
}

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
const DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_MS = 86400000;

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
function isWeekday(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

function earliestStartAfter(prevStart: Date): Date {
  return addWeeks(getRoundEndDate(prevStart), 1);
}

function roundWeekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(start);
    d.setDate(d.getDate() + k);
    return d;
  });
}
function roundEndDay(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 6);
  return d;
}

function daySpanSegment(days: Date[], year: number, month: number, lead: number) {
  let colStart = Infinity;
  let colEnd = -Infinity;
  let rowIndex = -1;
  for (const day of days) {
    if (day.getFullYear() === year && day.getMonth() === month) {
      const cellIndex = lead + day.getDate() - 1;
      colStart = Math.min(colStart, cellIndex % 7);
      colEnd = Math.max(colEnd, cellIndex % 7);
      rowIndex = Math.floor(cellIndex / 7);
    }
  }
  return rowIndex === -1 ? null : { rowIndex, colStart, colEnd };
}

export function BookingModal({ isOpen, onClose, sceneId, sceneName, projectName, onBooked, bookingMode }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const isDelivery = bookingMode === 'delivery' || bookingMode === 'delivery_no_quote';
  const showPricing = bookingMode !== 'calendar_no_quote' && bookingMode !== 'delivery_no_quote';

  const earliest = useMemo(() => getEarliestBookableMonday(), []);
  // Next weekday after today — minimum selectable delivery date.
  const earliestDelivery = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (!isWeekday(d)) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [startRoundNumber, setStartRoundNumber] = useState(1);
  const [numRounds, setNumRounds] = useState(1);
  const [currentStep, setCurrentStep] = useState(0);
  const [mondays, setMondays] = useState<Date[]>([earliest]);
  const [displayMonth, setDisplayMonth] = useState<Date>(startOfMonth(earliest));
  const [submitting, setSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);

  const roundNumbers = useMemo(
    () => Array.from({ length: numRounds }, (_, i) => startRoundNumber + i),
    [numRounds, startRoundNumber],
  );
  const totals = useMemo(() => calculateTotalsForRounds(roundNumbers), [roundNumbers]);

  const totalSteps = isDelivery ? 2 : 2 + numRounds;
  const reviewStep = totalSteps - 1;

  const stepLabels = useMemo(() => {
    if (isDelivery) return ['DELIVERY DATE', 'REVIEW'];
    const labels = ["ROUNDS"];
    for (let i = 0; i < numRounds; i++) {
      labels.push(`ROUND ${String(startRoundNumber + i).padStart(2, "0")}`);
    }
    labels.push("REVIEW");
    return labels;
  }, [isDelivery, numRounds, startRoundNumber]);

  const minMondayFor = useCallback(
    (idx: number): Date => (idx === 0 ? earliest : earliestStartAfter(mondays[idx - 1])),
    [earliest, mondays],
  );

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

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStep(0);
    setShowDiscardConfirm(false);
    setCalendarOpen(false);
    if (isDelivery) {
      setMondays([earliestDelivery]);
      setDisplayMonth(startOfMonth(earliestDelivery));
    } else {
      setNumRounds(1);
      setMondays([earliest]);
      setDisplayMonth(startOfMonth(earliest));
    }
  }, [isOpen, isDelivery, earliest, earliestDelivery]);

  useEffect(() => {
    if (isDelivery) return;
    setMondays((prev) => {
      const next = prev.slice(0, numRounds);
      for (let i = next.length; i < numRounds; i++) {
        next.push(i === 0 ? earliest : earliestStartAfter(next[i - 1]));
      }
      return next;
    });
  }, [numRounds, earliest, isDelivery]);

  useEffect(() => {
    setCurrentStep((s) => Math.min(s, reviewStep));
  }, [reviewStep]);

  useEffect(() => {
    if (isDelivery) return;
    if (currentStep >= 1 && currentStep <= numRounds) {
      const sel = mondays[currentStep - 1];
      if (sel) setDisplayMonth(startOfMonth(sel));
    }
  }, [currentStep, numRounds, mondays, isDelivery]);

  useEffect(() => {
    if (!isDelivery || !mondays[0]) { setCountdown(null); return; }
    const target = new Date(mondays[0]);
    target.setHours(12, 0, 0, 0);
    const update = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setCountdown(null); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`Delivery in ${d} days ${h} hours ${m} minutes ${s} seconds`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isDelivery, mondays]);

  const nextStep = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, reviewStep));
  }, [reviewStep]);

  const prevStep = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const goToStep = useCallback((n: number) => {
    setCurrentStep((s) => (n < s ? n : s));
  }, []);

  const selectDate = useCallback((idx: number, day: Date) => {
    setMondays((prev) => {
      const next = prev.slice();
      const old = next[idx];
      const deltaDays = old ? Math.round((day.getTime() - old.getTime()) / DAY_MS) : 0;
      next[idx] = day;
      for (let i = idx + 1; i < next.length; i++) {
        if (deltaDays !== 0 && next[i]) {
          next[i] = new Date(next[i].getTime() + deltaDays * DAY_MS);
        }
        const min = earliestStartAfter(next[i - 1]);
        if (!next[i] || next[i] < min || !isMonday(next[i])) {
          next[i] = min;
        }
      }
      return next;
    });
  }, []);

  const valid = !!user && (isDelivery ? !!mondays[0] : mondays.length === numRounds && mondays.every(Boolean));

  async function handleConfirm() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const bookingGroupId = crypto.randomUUID();

      let rows: object[];
      if (isDelivery) {
        const now = new Date();
        const expiry = new Date(now);
        expiry.setDate(expiry.getDate() + 7);
        rows = [{
          scene_id: sceneId,
          round_number: startRoundNumber,
          status: "reserved",
          start_date: now.toISOString(),
          end_date: mondays[0].toISOString(),
          round_fee: calculateRoundFee(startRoundNumber),
          reservation_expires_at: expiry.toISOString(),
          booking_group_id: bookingGroupId,
          instructions: null,
          created_by: user!.id,
          buffer_weeks: 0,
        }];
      } else {
        const firstStart = mondays[0];
        const expiry = getReservationExpiry(firstStart);
        rows = roundNumbers.map((rn, i) => ({
          scene_id: sceneId,
          round_number: rn,
          status: "reserved",
          start_date: mondays[i].toISOString(),
          end_date: getRoundEndDate(mondays[i]).toISOString(),
          round_fee: calculateRoundFee(rn),
          reservation_expires_at: expiry.toISOString(),
          booking_group_id: bookingGroupId,
          instructions: null,
          created_by: user!.id,
        }));
      }

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
        description: isDelivery
          ? `Delivery target: ${mondays[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`
          : `Payment required by ${getReservationExpiry(mondays[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to confirm production.`,
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

  const isPristine = isDelivery ? currentStep === 0 : currentStep === 0 && numRounds === 1;
  const requestClose = () => {
    if (submitting) return;
    if (isPristine) onClose();
    else setShowDiscardConfirm(true);
  };

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

  // ── Step 0 (calendar mode): ROUNDS ────────────────────────────────────────
  const renderRoundsStep = () => (
    <div className="flex flex-col items-center text-center">
      <h3 className="font-serif text-strong" style={{ fontSize: 28 }}>How many rounds?</h3>
      <p className="mt-4 max-w-[440px] font-sans text-standard" style={{ fontSize: 15, lineHeight: 1.6 }}>
        Round 01 is the design realisation round. Further rounds are corrections and revisions to your feedback.
      </p>
      <p className="mt-3 max-w-[440px] font-sans italic normal-case text-label" style={{ fontSize: 13, lineHeight: 1.6 }}>
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

  // ── Calendar mode: one month grid with Monday-cadence week rectangles ──────
  const renderMonthGrid = (monthStart: Date, roundIdx: number, min: Date, activeStart: Date | undefined, lockedStarts: Date[]) => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const total = daysInMonth(year, month);
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const numRows = Math.ceil((lead + total) / 7);

    const activeEnd = activeStart ? roundEndDay(activeStart) : undefined;
    const activeDelivery = activeStart ? getRoundEndDate(activeStart) : undefined;
    const activeSeg = activeStart ? daySpanSegment(roundWeekDays(activeStart), year, month, lead) : null;

    const locked = lockedStarts.map((s) => ({
      start: s,
      end: roundEndDay(s),
      delivery: getRoundEndDate(s),
      seg: daySpanSegment(roundWeekDays(s), year, month, lead),
    }));

    const pct = (col: number) => `${(col / 7) * 100}%`;
    const CELL = 32;

    return (
      <div className="w-[224px]">
        <p className="mb-3 text-center font-sans uppercase text-[11px] tracking-[0.2em] text-label">
          {monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <div className="grid grid-cols-7">
          {DAY_HEADERS.map((h, i) => (
            <div key={i} className="flex h-6 items-center justify-center font-sans uppercase text-[10px] tracking-[0.12em] text-recessive">{h}</div>
          ))}
        </div>
        {Array.from({ length: numRows }).map((_, r) => (
          <div key={r} className="relative pb-1">
            <div className="grid grid-cols-7">
              {Array.from({ length: 7 }).map((__, c) => {
                const cellIndex = r * 7 + c;
                const dayNum = cellIndex - lead + 1;
                if (dayNum < 1 || dayNum > total) return <div key={c} className="h-8 w-8" />;
                const day = new Date(year, month, dayNum);
                const t = day.getTime();

                const isActiveStart = activeStart != null && isSameDay(day, activeStart);
                const isActiveDelivery = activeDelivery != null && isSameDay(day, activeDelivery);
                const inActive = activeStart != null && activeEnd != null && t >= activeStart.getTime() && t <= activeEnd.getTime();

                let isLockedDelivery = false;
                let inLocked = false;
                for (const li of locked) {
                  if (isSameDay(day, li.delivery)) isLockedDelivery = true;
                  if (t >= li.start.getTime() && t <= li.end.getTime()) inLocked = true;
                }

                const selectable = isMonday(day) && t >= min.getTime() && !inLocked;
                const isFilled = isActiveDelivery || isLockedDelivery;

                const bgClass = isActiveDelivery ? "bg-gold" : isLockedDelivery ? "bg-gold-muted" : "";
                const textClass = isFilled
                  ? "text-brand-dark"
                  : inLocked ? "text-label"
                  : (inActive || selectable) ? "text-strong"
                  : "text-recessive";
                const borderClass = selectable && !inActive ? "border-transparent hover:border-gold" : "border-transparent";

                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!selectable}
                    onClick={() => selectable && selectDate(roundIdx, day)}
                    className={[
                      "flex h-8 w-8 items-center justify-center border font-serif text-[14px] tabular-nums transition-colors",
                      bgClass,
                      textClass,
                      borderClass,
                      selectable ? "cursor-pointer" : "cursor-default",
                    ].join(" ")}
                    style={{ borderRadius: 2 }}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>

            {activeSeg && activeSeg.rowIndex === r && (
              <div
                className="pointer-events-none absolute border border-gold"
                style={{ top: 0, height: CELL, left: pct(activeSeg.colStart), width: pct(activeSeg.colEnd - activeSeg.colStart + 1) }}
              />
            )}
            {locked.map((li, i) => li.seg && li.seg.rowIndex === r && (
              <div
                key={`lr-${i}`}
                className="pointer-events-none absolute border border-gold-muted"
                style={{ top: 0, height: CELL, left: pct(li.seg.colStart), width: pct(li.seg.colEnd - li.seg.colStart + 1) }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderCalendar = (idx: number) => {
    const min = minMondayFor(idx);
    const activeStart = mondays[idx];
    const lockedStarts = mondays.slice(0, idx);
    const canGoPrev = displayMonth.getTime() > startOfMonth(min).getTime();
    return (
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => canGoPrev && setDisplayMonth((m) => addMonths(m, -1))}
          disabled={!canGoPrev}
          className="font-serif text-label transition-colors hover:text-strong disabled:opacity-30 disabled:hover:text-label"
          style={{ fontSize: 18 }}
          aria-label="Previous months"
        >
          ‹
        </button>
        <div className="flex gap-6">
          {renderMonthGrid(displayMonth, idx, min, activeStart, lockedStarts)}
          {renderMonthGrid(addMonths(displayMonth, 1), idx, min, activeStart, lockedStarts)}
        </div>
        <button
          type="button"
          onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
          className="font-serif text-label transition-colors hover:text-strong"
          style={{ fontSize: 18 }}
          aria-label="Next months"
        >
          ›
        </button>
      </div>
    );
  };

  // ── Calendar mode: per-round date step ─────────────────────────────────────
  const renderDateStep = (roundIdx: number) => {
    const rn = startRoundNumber + roundIdx;
    const prevRn = rn - 1;
    let body: string;
    if (roundIdx === 0) {
      body = "Choose the Monday when production starts. Each round takes one week.";
    } else {
      const prevDelivery = getRoundEndDate(mondays[roundIdx - 1]);
      const deliveryLabel = prevDelivery.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      body = `Round ${String(prevRn).padStart(2, "0")} delivers on Monday ${deliveryLabel}. Choose when Round ${String(rn).padStart(2, "0")} should start. The gap between these dates is your feedback period.`;
    }
    return (
      <div className="flex flex-col items-center text-center">
        <h3 className="font-serif text-strong" style={{ fontSize: 28 }}>
          When should Round {String(rn).padStart(2, "0")} begin?
        </h3>
        <p className="mt-4 max-w-[440px] font-sans text-standard" style={{ fontSize: 15, lineHeight: 1.6 }}>
          {body}
        </p>
        {renderCalendar(roundIdx)}
        {roundIdx >= 1 && (
          <p className="mt-4 font-sans italic normal-case text-label" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Default: one week after Round {String(prevRn).padStart(2, "0")} delivery.
          </p>
        )}
      </div>
    );
  };

  // ── Delivery mode: simple any-weekday month grid ───────────────────────────
  const renderDeliveryMonthGrid = (monthStart: Date, min: Date, selected: Date | undefined, onSelect?: (day: Date) => void) => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const total = daysInMonth(year, month);
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const numRows = Math.ceil((lead + total) / 7);

    return (
      <div className="w-[224px]">
        <p className="mb-3 text-center font-sans uppercase text-[11px] tracking-[0.2em] text-label">
          {monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <div className="grid grid-cols-7">
          {DAY_HEADERS.map((h, i) => (
            <div key={i} className="flex h-6 items-center justify-center font-sans uppercase text-[10px] tracking-[0.12em] text-recessive">{h}</div>
          ))}
        </div>
        {Array.from({ length: numRows }).map((_, r) => (
          <div key={r} className="pb-1">
            <div className="grid grid-cols-7">
              {Array.from({ length: 7 }).map((__, c) => {
                const cellIndex = r * 7 + c;
                const dayNum = cellIndex - lead + 1;
                if (dayNum < 1 || dayNum > total) return <div key={c} className="h-8 w-8" />;
                const day = new Date(year, month, dayNum);
                const isSelected = selected != null && isSameDay(day, selected);
                const selectable = isWeekday(day) && day.getTime() >= min.getTime();

                const bgClass = isSelected ? "bg-gold" : "";
                const textClass = isSelected
                  ? "text-brand-dark"
                  : selectable ? "text-strong"
                  : "text-recessive";
                const borderClass = selectable && !isSelected ? "border-transparent hover:border-gold" : "border-transparent";

                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!selectable}
                    onClick={() => { if (selectable) { if (onSelect) onSelect(day); else setMondays([day]); } }}
                    className={[
                      "flex h-8 w-8 items-center justify-center border font-serif text-[14px] tabular-nums transition-colors",
                      bgClass, textClass, borderClass,
                      selectable ? "cursor-pointer" : "cursor-default",
                    ].join(" ")}
                    style={{ borderRadius: 2 }}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDeliveryCalendar = (onSelect?: (day: Date) => void) => {
    const min = earliestDelivery;
    const selected = mondays[0];
    const canGoPrev = displayMonth.getTime() > startOfMonth(min).getTime();
    return (
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => canGoPrev && setDisplayMonth((m) => addMonths(m, -1))}
          disabled={!canGoPrev}
          className="font-serif text-label transition-colors hover:text-strong disabled:opacity-30 disabled:hover:text-label"
          style={{ fontSize: 18 }}
          aria-label="Previous months"
        >
          ‹
        </button>
        <div className="flex gap-6">
          {renderDeliveryMonthGrid(displayMonth, min, selected, onSelect)}
          {renderDeliveryMonthGrid(addMonths(displayMonth, 1), min, selected, onSelect)}
        </div>
        <button
          type="button"
          onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
          className="font-serif text-label transition-colors hover:text-strong"
          style={{ fontSize: 18 }}
          aria-label="Next months"
        >
          ›
        </button>
      </div>
    );
  };

  const renderDeliveryDateStep = () => {
    const selected = mondays[0];
    const dateLabel = selected
      ? selected.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : "Select a date";

    const handleDeliverySelect = (day: Date) => {
      setMondays([day]);
      setCalendarOpen(false);
    };

    return (
      <div className="flex flex-col items-center text-center">
        <h3 className="font-serif text-strong" style={{ fontSize: 28 }}>
          When do you need Round {String(startRoundNumber).padStart(2, "0")} delivered?
        </h3>
        <p className="mt-4 max-w-[440px] font-sans text-standard" style={{ fontSize: 15, lineHeight: 1.6 }}>
          Select your target delivery date. Production begins from today.
        </p>

        {/* Date picker button */}
        <button
          type="button"
          onClick={() => setCalendarOpen((v) => !v)}
          className="mt-8 flex items-center gap-4 border border-border/60 px-7 py-3 font-serif text-strong transition-colors hover:border-gold"
          style={{ fontSize: 20, borderRadius: 2 }}
        >
          {dateLabel}
          <span
            className="font-sans text-label transition-transform"
            style={{ fontSize: 10, letterSpacing: "0.1em", display: "inline-block", transform: calendarOpen ? "rotate(180deg)" : "none" }}
          >
            ▾
          </span>
        </button>

        {/* Calendar (expandable) */}
        {calendarOpen && renderDeliveryCalendar(handleDeliverySelect)}

        {/* Countdown */}
        {selected && countdown && (
          <p
            className="font-sans text-label"
            style={{ fontSize: 12, letterSpacing: "0.04em", marginTop: calendarOpen ? 20 : 16 }}
          >
            {countdown}
          </p>
        )}
      </div>
    );
  };

  // ── Review step ────────────────────────────────────────────────────────────
  const renderReviewStep = () => (
    <div className="flex flex-col">
      <h3 className="text-center font-serif text-strong" style={{ fontSize: 28 }}>Review your booking</h3>

      <p className="mt-8 font-sans text-[9px] uppercase tracking-[0.28em] text-label">Production schedule</p>
      <div className="mt-3">
        {isDelivery ? (
          <div className="flex items-center justify-between border-b border-border py-3">
            <span className="font-sans uppercase text-[11px] tracking-[0.16em] text-standard">
              Round {String(startRoundNumber).padStart(2, "0")}
            </span>
            <span className="font-serif tabular-nums text-standard" style={{ fontSize: 14 }}>
              Today → {formatDayMonth(mondays[0])}
            </span>
          </div>
        ) : (
          roundNumbers.map((rn, i) => (
            <div key={rn} className="flex items-center justify-between border-b border-border py-3">
              <span className="font-sans uppercase text-[11px] tracking-[0.16em] text-standard">
                Round {String(rn).padStart(2, "0")}
              </span>
              <span className="font-serif tabular-nums text-standard" style={{ fontSize: 14 }}>
                {formatDayMonth(mondays[i])} → {formatDayMonth(getRoundEndDate(mondays[i]))}
              </span>
            </div>
          ))
        )}
      </div>
      <p className="mt-3 font-sans italic normal-case text-label" style={{ fontSize: 13, lineHeight: 1.6 }}>
        {isDelivery
          ? `Production begins today. Delivery target: ${mondays[0].toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.`
          : "Round dates may shift if feedback is delayed. Briefs must arrive by Friday 12:00 for the round starting the following Monday."}
      </p>

      {showPricing && (
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
      )}
    </div>
  );

  const isRoundsStep = !isDelivery && currentStep === 0;
  const isDeliveryDateStep = isDelivery && currentStep === 0;
  const isReviewStep = currentStep === reviewStep;
  const dateRoundIdx = !isRoundsStep && !isReviewStep && !isDeliveryDateStep ? currentStep - 1 : -1;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={requestClose} />
      <div className="relative z-10 flex w-full max-w-[640px] flex-col border border-border/60 bg-card p-8 shadow-2xl" style={{ borderRadius: 4, minHeight: 560, maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-strong" style={{ fontSize: 18 }}>Book production rounds</h2>
            <p className="mt-1 font-sans text-[11px] uppercase tracking-[0.16em] text-label">
              {projectName ? `${projectName} — ` : ""}{sceneName}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
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

        {/* Step body */}
        <div className="flex flex-1 flex-col justify-center py-8">
          {isRoundsStep && renderRoundsStep()}
          {isDeliveryDateStep && renderDeliveryDateStep()}
          {dateRoundIdx >= 0 && renderDateStep(dateRoundIdx)}
          {isReviewStep && renderReviewStep()}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div>{!isRoundsStep && !isDeliveryDateStep && backLink}</div>
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

      {showDiscardConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDiscardConfirm(false)} />
          <div className="relative z-10 w-[360px] border border-border/60 bg-surface-elevated p-6 shadow-2xl" style={{ borderRadius: 0 }}>
            <h3 className="font-serif text-strong" style={{ fontSize: 20 }}>Discard this booking?</h3>
            <p className="mt-3 font-sans text-standard" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Your selections will not be saved.
            </p>
            <div className="mt-6 flex items-center justify-end gap-5">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="font-sans uppercase text-[10px] tracking-[0.26em] text-label hover:text-strong transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setShowDiscardConfirm(false); onClose(); }}
                className="inline-flex h-10 items-center border border-gold bg-transparent px-6 font-sans uppercase text-[10px] tracking-[0.26em] text-strong transition-opacity hover:opacity-80"
                style={{ borderRadius: 2 }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
