// SectionTotal — a section's outstanding figure rendered as a compact serif
// metric with a quiet eyebrow. Echoes the page-level "Total owed" treatment one
// step down in scale, so the Debts page reads as a single hierarchy:
// page total (hero) › section totals › row figures. Reused by every Debts
// section so the four headers stay identical.
//
// Styling only — no colours or type outside the redesign tokens (Cinzel serif
// via font-serif, text-strong, tabular-nums, uppercase text-label eyebrow).

interface SectionTotalProps {
  amount: number;
  /** Quiet eyebrow beside the figure — e.g. "outstanding", "owed". */
  label?: string;
  /** Currency formatter from the calling module (money / formatCurrency). */
  format: (n: number) => string;
}

export function SectionTotal({ amount, label = "outstanding", format }: SectionTotalProps) {
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span className="font-serif text-lg text-strong tabular-nums leading-none">{format(amount)}</span>
      <span className="text-[9px] uppercase tracking-[0.24em] text-white/30">{label}</span>
    </span>
  );
}
