import { formatCurrency } from "@/lib/finance";
import { cn } from "@/lib/utils";

export type FinanceSectionKey = "moneyIn" | "moneyOut" | "vat";
export type MoneyOutKind = "fixed" | "variable";

interface FinanceSummaryProps {
  /** All figures are for the selected period, VAT-inclusive. */
  revenue: number;
  variableCost: number;
  fixedCost: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
  outstandingIn: number;
  outstandingOut: number;
  vatNet: number;
  /** Period label shown on the VAT line. */
  vatLabel: string;
  active?: FinanceSectionKey | null;
  /** Which Money-out kind the open section is filtered to (for tile highlight). */
  moneyOutType?: "all" | MoneyOutKind;
  /** Cost tiles pass a kind so Money out opens pre-filtered to that type. */
  onSelect?: (key: FinanceSectionKey, moneyOutKind?: MoneyOutKind) => void;
}

export function FinanceSummary({
  revenue,
  variableCost,
  fixedCost,
  grossProfit,
  operatingProfit,
  netProfit,
  outstandingIn,
  outstandingOut,
  vatNet,
  vatLabel,
  active,
  moneyOutType,
  onSelect,
}: FinanceSummaryProps) {
  return (
    <div className="space-y-2">
      {/* The P&L waterfall — sources are clickable tiles, running totals read
          out on the card between them. */}
      <SourceTile
        label="Revenue"
        value={revenue}
        active={active === "moneyIn"}
        onClick={() => onSelect?.("moneyIn")}
      />
      <SourceTile
        op="−"
        label="Variable production cost"
        paren="Airtable"
        value={variableCost}
        active={active === "moneyOut" && moneyOutType === "variable"}
        onClick={() => onSelect?.("moneyOut", "variable")}
      />
      <ProfitReadout label="Gross profit" value={grossProfit} />

      <SourceTile
        op="−"
        label="Operational fixed cost"
        paren="Overheads"
        value={fixedCost}
        active={active === "moneyOut" && moneyOutType === "fixed"}
        onClick={() => onSelect?.("moneyOut", "fixed")}
      />
      <ProfitReadout label="Operating profit" value={operatingProfit} />

      <SourceTile
        op="−"
        label="VAT"
        paren={vatLabel}
        value={vatNet}
        active={active === "vat"}
        onClick={() => onSelect?.("vat")}
      />
      <ProfitReadout label="Net profit" value={netProfit} strong />

      {/* Outstanding — "as of now", independent of the period */}
      <div className="ssr-tile px-5 py-4">
        <p className="mb-3 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.24em] text-foreground/45">
          <span className="w-3 shrink-0" />
          Outstanding
        </p>
        <div className="grid grid-cols-2 gap-4 pl-5">
          <Row label="Owed to you" value={formatCurrency(outstandingIn)} />
          <Row label="You owe" value={formatCurrency(outstandingOut)} />
        </div>
      </div>
    </div>
  );
}

function SourceTile({
  op,
  label,
  paren,
  value,
  active,
  onClick,
}: {
  op?: string;
  label: string;
  paren?: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group ssr-tile flex w-full items-baseline justify-between gap-4 px-5 py-4 text-left transition-all duration-200",
        active ? "ring-1 ring-gold/60" : "hover:ring-1 hover:ring-white/10",
      )}
    >
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="w-3 shrink-0 text-sm text-recessive">{op ?? ""}</span>
        <span className="text-[10px] uppercase tracking-[0.24em] text-foreground/50">{label}</span>
        {paren && (
          <span className="text-[10px] uppercase tracking-[0.24em] text-foreground/25">
            ({paren})
          </span>
        )}
        <span className="text-xs text-gold opacity-0 transition-opacity group-hover:opacity-100">
          →
        </span>
      </span>
      <span className="shrink-0 font-serif text-xl text-strong tabular-nums">
        {formatCurrency(value)}
      </span>
    </button>
  );
}

function ProfitReadout({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-1.5">
      <span className="flex items-baseline gap-2">
        <span className="w-3 shrink-0 text-sm text-recessive">=</span>
        <span
          className={cn(
            "uppercase tracking-[0.24em]",
            strong ? "text-[11px] text-gold" : "text-[10px] text-foreground/55",
          )}
        >
          {label}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 font-serif tabular-nums",
          strong ? "text-3xl text-gold" : "text-2xl text-strong",
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
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
