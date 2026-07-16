import { formatCurrency, type Quarter } from "@/lib/finance";

interface FinanceSummaryProps {
  moneyOut: { outstanding: number; paidThisQuarter: number; totalThisQuarter: number };
  moneyIn: { outstanding: number; paidThisQuarter: number };
  vat: { netEstimate: number };
  currentQuarter: Quarter;
}

export function FinanceSummary({ moneyOut, moneyIn, vat, currentQuarter }: FinanceSummaryProps) {
  return (
    <div className="mb-10 grid grid-cols-3 gap-8 border-y border-divider py-6">
      <Panel title="Money out">
        <Row label="Outstanding" value={formatCurrency(moneyOut.outstanding)} />
        <Row label={`Paid ${currentQuarter.label}`} value={formatCurrency(moneyOut.paidThisQuarter)} />
        <Row label={`Total ${currentQuarter.label}`} value={formatCurrency(moneyOut.totalThisQuarter)} />
      </Panel>
      <Panel title="Money in">
        <Row label="Outstanding" value={formatCurrency(moneyIn.outstanding)} />
        <Row label={`Paid ${currentQuarter.label}`} value={formatCurrency(moneyIn.paidThisQuarter)} />
        <Row label="—" value="" muted />
      </Panel>
      <Panel title={`VAT ${currentQuarter.label} · est.`}>
        <Row
          label="Net VAT"
          value={formatCurrency(vat.netEstimate)}
          accent={vat.netEstimate !== 0}
        />
        <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-gold-muted">
          In progress · cash basis
        </p>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
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
      <span
        className={
          muted
            ? "text-xs text-recessive"
            : "text-xs text-recessive"
        }
      >
        {label}
      </span>
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
