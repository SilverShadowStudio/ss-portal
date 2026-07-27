import { formatCurrency, type Quarter } from "@/lib/finance";
import { cn } from "@/lib/utils";

export type FinanceSectionKey = "moneyIn" | "moneyOut" | "vat";
export type MoneyOutKind = "fixed" | "variable";

interface FinanceSummaryProps {
  /** All figures are this-quarter totals, VAT-inclusive. */
  revenue: number;
  variableCost: number;
  fixedCost: number;
  grossProfit: number;
  operatingProfit: number;
  outstandingIn: number;
  outstandingOut: number;
  vatNet: number;
  currentQuarter: Quarter;
  active?: FinanceSectionKey | null;
  /** Cost lines pass a kind so Money out opens pre-filtered to that type. */
  onSelect?: (key: FinanceSectionKey, moneyOutKind?: MoneyOutKind) => void;
}

export function FinanceSummary({
  revenue,
  variableCost,
  fixedCost,
  grossProfit,
  operatingProfit,
  outstandingIn,
  outstandingOut,
  vatNet,
  currentQuarter,
  active,
  onSelect,
}: FinanceSummaryProps) {
  return (
    <div className="space-y-3">
      {/* The P&L spine — revenue down to operating profit. */}
      <div className="ssr-tile p-6">
        <SpineLine
          label="Money in"
          hint="revenue"
          value={revenue}
          onClick={() => onSelect?.("moneyIn")}
          active={active === "moneyIn"}
        />
        <SpineLine
          op="−"
          label="Variable production cost"
          hint="Airtable"
          value={variableCost}
          muted
          onClick={() => onSelect?.("moneyOut", "variable")}
          active={active === "moneyOut"}
        />
        <Rule />
        <SpineLine label="Gross profit" value={grossProfit} total />
        <SpineLine
          op="−"
          label="Operational fixed cost"
          hint="overheads"
          value={fixedCost}
          muted
          onClick={() => onSelect?.("moneyOut", "fixed")}
          active={active === "moneyOut"}
        />
        <Rule />
        <SpineLine label="Operating profit" value={operatingProfit} total strong />
      </div>

      {/* Secondary reads — VAT (clickable) and outstanding balances. */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSelect?.("vat")}
          aria-pressed={active === "vat"}
          className={cn(
            "ssr-tile w-full p-5 text-left transition-all duration-200",
            active === "vat"
              ? "ring-1 ring-gold/60"
              : "hover:-translate-y-0.5 hover:ring-1 hover:ring-white/10",
          )}
        >
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-3">
            VAT {currentQuarter.label} · est.
          </p>
          <p
            className={cn(
              "font-serif text-lg tabular-nums",
              vatNet !== 0 ? "text-gold" : "text-strong",
            )}
          >
            {formatCurrency(vatNet)}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-gold-muted">
            In progress · cash basis
          </p>
        </button>

        <div className="ssr-tile p-5">
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-3">
            Outstanding
          </p>
          <div className="space-y-2">
            <Row label="Owed to you" value={formatCurrency(outstandingIn)} />
            <Row label="You owe" value={formatCurrency(outstandingOut)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Rule() {
  return <div className="my-3 h-px bg-divider" />;
}

function SpineLine({
  label,
  hint,
  value,
  op,
  onClick,
  active,
  muted,
  total,
  strong,
}: {
  label: string;
  hint?: string;
  value: number;
  op?: string;
  onClick?: () => void;
  active?: boolean;
  muted?: boolean;
  total?: boolean;
  strong?: boolean;
}) {
  const body = (
    <div className="group flex items-baseline justify-between gap-4 py-1.5">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="w-3 shrink-0 text-sm text-recessive">{op ?? ""}</span>
        <span
          className={cn(
            total ? "font-serif text-base text-strong" : "text-sm",
            !total && (muted ? "text-standard" : "text-strong"),
          )}
        >
          {label}
        </span>
        {hint && (
          <span className="text-[10px] uppercase tracking-[0.24em] text-foreground/35">
            {hint}
          </span>
        )}
        {onClick && (
          <span className="text-xs text-gold opacity-0 transition-opacity group-hover:opacity-100">
            →
          </span>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 font-serif tabular-nums",
          strong
            ? "text-2xl text-gold"
            : total
              ? "text-lg text-strong"
              : muted
                ? "text-base text-standard"
                : "text-base text-strong",
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );

  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "-mx-2 block w-[calc(100%+1rem)] rounded-sm px-2 text-left transition-colors",
        active ? "bg-gold/[0.06]" : "hover:bg-foreground/[0.03]",
      )}
    >
      {body}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-recessive">{label}</span>
      <span className="font-serif text-lg text-strong tabular-nums">{value}</span>
    </div>
  );
}
