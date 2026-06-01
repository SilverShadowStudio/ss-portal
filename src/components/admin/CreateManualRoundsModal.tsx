import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLog";
import { formatCurrency } from "@/lib/invoiceUtils";
import { calculateRoundFee } from "@/lib/roundPricing";
import {
  getEarliestBookableMonday,
  getRoundEndDate,
  isMonday,
  isSameDay,
  formatDayMonth,
} from "@/lib/bookingDates";

interface CreateManualRoundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sceneId: string;
  sceneName: string;
  projectName?: string;
  onCreated: () => void;
}

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
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
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// Next round's start = previous delivery + one week (buffer_weeks default of 1,
// mirroring the booking flow's cadence).
function nextStartAfter(prevStart: Date): Date {
  return addDays(getRoundEndDate(prevStart), 7);
}

export function CreateManualRoundsModal({
  isOpen,
  onClose,
  sceneId,
  sceneName,
  projectName,
  onCreated,
}: CreateManualRoundsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const earliest = useMemo(() => getEarliestBookableMonday(), []);
  const [numRounds, setNumRounds] = useState(1);
  const [startDate, setStartDate] = useState<Date>(earliest);
  const [displayMonth, setDisplayMonth] = useState<Date>(startOfMonth(earliest));
  const [fees, setFees] = useState<number[]>([calculateRoundFee(1)]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset to defaults on each open.
  useEffect(() => {
    if (!isOpen) return;
    setNumRounds(1);
    setStartDate(earliest);
    setDisplayMonth(startOfMonth(earliest));
    setFees([calculateRoundFee(1)]);
    setNote("");
  }, [isOpen, earliest]);

  // Resize the per-round fee array as the count changes, preserving any edits
  // and defaulting new rounds to the standard rate for that round number.
  useEffect(() => {
    setFees((prev) =>
      Array.from({ length: numRounds }, (_, i) => prev[i] ?? calculateRoundFee(i + 1)),
    );
  }, [numRounds]);

  // Round start dates computed from the first start + 1-week buffer between rounds.
  const starts = useMemo(() => {
    const out: Date[] = [startDate];
    for (let i = 1; i < numRounds; i++) out.push(nextStartAfter(out[i - 1]));
    return out;
  }, [startDate, numRounds]);

  const roundNumbers = useMemo(
    () => Array.from({ length: numRounds }, (_, i) => i + 1),
    [numRounds],
  );

  const feesValid = fees.length === numRounds && fees.every((f) => Number.isFinite(f) && f >= 0);
  const valid =
    !!user && isMonday(startDate) && startDate.getTime() >= earliest.getTime() && feesValid;

  async function handleCreate() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const bookingGroupId = crypto.randomUUID();
      const rows = starts.map((start, i) => ({
        scene_id: sceneId,
        round_number: roundNumbers[i],
        kind: "production",
        status: "pending",
        payment_method: "manual",
        start_date: start.toISOString(),
        end_date: getRoundEndDate(start).toISOString(),
        round_fee: fees[i],
        reservation_expires_at: null,
        booking_group_id: bookingGroupId,
        instructions: note.trim() || null,
        created_by: user!.id,
      }));
      const { error } = await supabase.from("scene_rounds").insert(rows as never);
      if (error) throw error;

      await logActivity({
        action: "round_created",
        description: `Created ${numRounds} round${numRounds === 1 ? "" : "s"} manually on ${sceneName}`,
        actorRole: "admin",
        entityType: "scene",
        entityId: sceneId,
        sceneId,
        sceneName,
        metadata: { booking_group_id: bookingGroupId, payment_method: "manual", rounds: roundNumbers },
      });

      toast({
        title: "Rounds created",
        description: `${numRounds} round${numRounds === 1 ? "" : "s"} added to ${sceneName}.`,
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error("[CreateManualRoundsModal] insert failed:", err);
      toast({ title: "Couldn't create the rounds", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const canGoPrev = displayMonth.getTime() > startOfMonth(earliest).getTime();

  const renderMonthGrid = (monthStart: Date) => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const total = daysInMonth(year, month);
    const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first offset
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
          <div key={r} className="grid grid-cols-7">
            {Array.from({ length: 7 }).map((__, c) => {
              const cellIndex = r * 7 + c;
              const dayNum = cellIndex - lead + 1;
              if (dayNum < 1 || dayNum > total) return <div key={c} className="h-8 w-8" />;
              const day = new Date(year, month, dayNum);
              const selectable = isMonday(day) && day.getTime() >= earliest.getTime();
              const isSelected = isSameDay(day, startDate);
              const bgClass = isSelected ? "bg-gold" : "";
              const textClass = isSelected ? "text-brand-dark" : selectable ? "text-strong" : "text-recessive";
              const borderClass = selectable && !isSelected ? "border-transparent hover:border-gold" : "border-transparent";
              return (
                <button
                  key={c}
                  type="button"
                  disabled={!selectable}
                  onClick={() => selectable && setStartDate(day)}
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
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={() => !submitting && onClose()} />
      <div className="relative z-10 flex w-full max-w-[560px] flex-col border border-border/60 bg-card p-8 shadow-2xl" style={{ borderRadius: 4, maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div>
          <h2 className="font-serif text-strong" style={{ fontSize: 18 }}>Create rounds manually</h2>
          <p className="mt-1 font-sans text-[11px] uppercase tracking-[0.16em] text-label">
            {projectName ? `${projectName} — ` : ""}{sceneName}
          </p>
        </div>

        <p className="mt-5 font-sans text-standard" style={{ fontSize: 14, lineHeight: 1.6 }}>
          Use this to add rounds for a client who has paid externally. The client will see these rounds in their portal without going through the booking flow.
        </p>

        {/* Number of rounds */}
        <div className="mt-8">
          <p className="font-sans text-[9px] uppercase tracking-[0.28em] text-label">Number of rounds</p>
          <div className="mt-3 flex items-center gap-8">
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
            <span className="w-12 text-center font-serif text-strong tabular-nums" style={{ fontSize: 32 }}>{numRounds}</span>
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

        {/* Round 01 start date */}
        <div className="mt-8">
          <p className="font-sans text-[9px] uppercase tracking-[0.28em] text-label">Round 01 start date</p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => canGoPrev && setDisplayMonth((m) => addMonths(m, -1))}
              disabled={!canGoPrev}
              className="font-serif text-label transition-colors hover:text-strong disabled:opacity-30 disabled:hover:text-label"
              style={{ fontSize: 18 }}
              aria-label="Previous month"
            >
              ‹
            </button>
            {renderMonthGrid(displayMonth)}
            <button
              type="button"
              onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
              className="font-serif text-label transition-colors hover:text-strong"
              style={{ fontSize: 18 }}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        {/* Per-round fees + computed schedule */}
        <div className="mt-8">
          <p className="font-sans text-[9px] uppercase tracking-[0.28em] text-label">Rounds &amp; fees</p>
          <div className="mt-3">
            {roundNumbers.map((rn, i) => (
              <div key={rn} className="flex items-center justify-between gap-4 border-b border-border py-3">
                <div className="flex flex-col">
                  <span className="font-sans uppercase text-[11px] tracking-[0.16em] text-standard">
                    Round {String(rn).padStart(2, "0")}
                  </span>
                  <span className="font-serif tabular-nums text-recessive" style={{ fontSize: 12 }}>
                    {formatDayMonth(starts[i])} → {formatDayMonth(getRoundEndDate(starts[i]))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-serif text-label" style={{ fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={Number.isFinite(fees[i]) ? fees[i] : 0}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setFees((prev) => prev.map((f, idx) => (idx === i ? (Number.isFinite(v) ? v : 0) : f)));
                    }}
                    className="h-9 w-28 border border-border bg-transparent px-3 text-right font-serif tabular-nums text-strong outline-none focus:border-gold"
                    style={{ borderRadius: 2, fontSize: 14 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reference / note */}
        <div className="mt-6">
          <p className="font-sans text-[9px] uppercase tracking-[0.28em] text-label">Reference / note (optional)</p>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. invoice number"
            className="mt-3 h-10 w-full border border-border bg-transparent px-3 font-sans text-standard outline-none placeholder:text-recessive focus:border-gold"
            style={{ borderRadius: 2, fontSize: 14 }}
          />
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-end gap-5">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="font-sans uppercase text-[10px] tracking-[0.26em] text-label hover:text-strong transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={handleCreate}
            className="inline-flex h-12 items-center border border-gold bg-transparent px-8 font-sans uppercase text-[10px] tracking-[0.26em] text-strong transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ borderRadius: 2 }}
          >
            {submitting ? "Creating…" : "Create rounds"}
          </button>
        </div>
      </div>
    </div>
  );
}
