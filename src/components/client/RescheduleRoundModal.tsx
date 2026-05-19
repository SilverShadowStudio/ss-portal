import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { DURATION, FM_EASE } from "@/lib/motion";

interface RescheduleRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves once the parent has persisted the new dates. */
  onConfirm: (newEndDate: Date) => Promise<void> | void;
  sceneName: string;
  roundNumber: number;
  /** Current scheduled delivery (scene_rounds.end_date). */
  currentEndDate: string | null;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Returns the first Monday that is >= the given date. */
function nextMondayOnOrAfter(d: Date): Date {
  const c = startOfDay(d);
  const day = c.getDay(); // 0=Sun ... 1=Mon ... 6=Sat
  const shift = day === 1 ? 0 : (8 - day) % 7;
  c.setDate(c.getDate() + shift);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function RescheduleRoundModal({
  isOpen,
  onClose,
  onConfirm,
  sceneName,
  roundNumber,
  currentEndDate,
}: RescheduleRoundModalProps) {
  const [selected, setSelected] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Build the Monday options. Spec: min date = (today + 7 days) rounded
  // forward to the next Monday. Show the next 12 Mondays from that anchor.
  const mondays = useMemo(() => {
    const minBase = startOfDay(new Date());
    minBase.setDate(minBase.getDate() + 7);
    const firstMonday = nextMondayOnOrAfter(minBase);
    const list: Date[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(firstMonday);
      d.setDate(firstMonday.getDate() + i * 7);
      list.push(d);
    }
    return list;
  }, [isOpen]);

  const currentDate = currentEndDate ? new Date(currentEndDate) : null;
  const isSameAsCurrent = selected && currentDate && sameDay(selected, currentDate);
  const canConfirm = !!selected && !isSameAsCurrent && !submitting;

  const handleConfirm = async () => {
    if (!selected || !canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm(selected);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            onClick={onClose}
            className="absolute inset-0 bg-background/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ type: "tween", duration: DURATION.standard / 1000, ease: FM_EASE.default }}
            className="relative w-full max-w-[520px] max-h-[90vh] overflow-y-auto shadow-[0_40px_100px_-16px_rgba(0,0,0,0.6)]"
            style={{ borderRadius: 4, background: "var(--brand-dark-surface, #181614)", border: "1px solid #2A2820" }}
            role="dialog"
            aria-modal="true"
            aria-label="Reschedule round"
          >
            {/* Header */}
            <div className="px-7 sm:px-10 pt-9 pb-5 border-b border-border/30 flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/45 font-sans mb-2">
                  Round {roundNumber.toString().padStart(2, "0")}
                </p>
                <h2
                  className="font-serif font-normal text-foreground"
                  style={{ fontSize: "1.45rem", lineHeight: 1.1, letterSpacing: "-0.01em" }}
                >
                  Reschedule delivery
                </h2>
                <p className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-foreground/45 font-sans">
                  {sceneName}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-1 text-foreground/50 hover:text-foreground transition-colors"
                style={{ lineHeight: 1 }}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1} />
              </button>
            </div>

            {/* Body */}
            <div className="px-7 sm:px-10 py-7">
              <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 mb-2">
                Current delivery
              </p>
              <p className="text-[13px] text-foreground/80 font-sans mb-7">
                {currentDate ? formatLongDate(currentDate) : "Not scheduled"}
              </p>

              <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 mb-3">
                Pick a new Monday
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {mondays.map((m) => {
                  const isSelected = selected && sameDay(m, selected);
                  const isCurrent = currentDate && sameDay(m, currentDate);
                  return (
                    <button
                      key={m.toISOString()}
                      type="button"
                      onClick={() => setSelected(m)}
                      className={`h-11 px-2 text-[11px] font-sans uppercase tracking-[0.14em] border transition-colors ${
                        isSelected
                          ? "border-[var(--brand-gold)] text-gold"
                          : isCurrent
                          ? "border-border/40 text-foreground/35"
                          : "border-border/40 text-foreground/65 hover:text-foreground hover:border-foreground/40"
                      }`}
                      style={{ borderRadius: 2 }}
                    >
                      {formatShortDate(m)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 sm:px-10 pb-9 pt-2 flex flex-wrap gap-3 items-center">
              <button
                type="button"
                onClick={onClose}
                className="h-12 px-5 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/40 hover:text-foreground/65 transition-colors"
                style={{ borderRadius: 2 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="flex-1 min-w-[200px] h-12 px-5 text-[10px] font-sans uppercase tracking-[0.24em] border border-[var(--brand-gold)] bg-transparent text-gold transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ borderRadius: 2 }}
              >
                {submitting
                  ? "Rescheduling…"
                  : selected
                  ? `Reschedule to ${formatShortDate(selected)}`
                  : "Reschedule"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
