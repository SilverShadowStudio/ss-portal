import { formatCurrency, type Quarter } from "@/lib/finance";
import { cn } from "@/lib/utils";

export type FinanceSectionKey = "moneyIn" | "moneyOut" | "vat" | "payables";

interface FinanceSummaryProps {
  moneyOut: { outstanding: number; paidThisQuarter: number; totalThisQuarter: number };
  payables: {
    outstanding: number;
    paidThisQuarter: number;
    totalThisQuarter: number;
    partialCount: number;
  };
  moneyIn: { outstanding: number; paidThisQuarter: number };
  vat: { netEstimate: number };
  currentQuarter: Quarter;
  /** Currently-open detail section (null = none open). */
  active?: FinanceSectionKey | null;
  /** Click a frame to open its detail section below the summary. */
  onSelect?: (key: FinanceSectionKey) => void;
}

export function FinanceSummary({
  moneyOut,
  payables,
  moneyIn,
  vat,
  currentQuarter,
  active,
  onSelect,
}: FinanceSummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Panel title="Money in" active={active === "moneyIn"} onClick={() => onSelect?.("moneyIn")}>
        <Row label="Outstanding" value={formatCurrency(moneyIn.outstanding)} />
        <Row label={`Paid ${currentQuarter.label}`} value={formatCurrency(moneyIn.paidThisQuarter)} />
      </Panel>
      <Panel title="Money out" active={active === "moneyOut"} onClick={() => onSelect?.("moneyOut")}>
        <Row label="Outstanding" value={formatCurrency(moneyOut.outstanding)} />
        <Row label={`Paid ${currentQuarter.label}`} value={formatCurrency(moneyOut.paidThisQuarter)} />
        <Row label={`Total ${currentQuarter.label}`} value={formatCurrency(moneyOut.totalThisQuarter)} />
      </Panel>
      <Panel title={`VAT ${currentQuarter.label} · est.`} active={active === "vat"} onClick={() => onSelect?.("vat")}>
        <Row
          label="Net VAT"
          value={formatCurrency(vat.netEstimate)}
          accent={vat.netEstimate !== 0}
        />
        <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-gold-muted">
          In progress · cash basis
        </p>
      </Panel>
      <Panel title="Payables" active={active === "payables"} onClick={() => onSelect?.("payables")}>
        <Row label="Outstanding" value={formatCurrency(payables.outstanding)} />
        <Row label={`Paid ${currentQuarter.label}`} value={formatCurrency(payables.paidThisQuarter)} />
        <Row label={`Total ${currentQuarter.label}`} value={formatCurrency(payables.totalThisQuarter)} />
        <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-gold-muted">
          Not part of your VAT return
          {payables.partialCount > 0 && ` · ${payables.partialCount} partial`}
        </p>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  children,
  active,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "ssr-tile w-full p-5 text-left transition-all duration-200",
        active
          ? "ring-1 ring-gold/60"
          : "hover:-translate-y-0.5 hover:ring-1 hover:ring-white/10",
      )}
    >
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </button>
  );
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-recessive">{label}</span>
      <span
        className={
          accent
            ? "font-serif text-lg text-gold tabular-nums"
            : muted
              ? "font-serif text-lg text-recessive tabular-nums"
              : "font-serif text-lg text-strong tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
