import { formatCurrency } from "@/lib/finance";
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
  /** Quarter label shown on the VAT tile (VAT stays quarterly). */
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
  outstandingIn,
  outstandingOut,
  vatNet,
  vatLabel,
  active,
  moneyOutType,
  onSelect,
}: FinanceSummaryProps) {
  return (
    <div className="space-y-5">
      {/* The three sources — each a tile you click to open its development below */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SourceTile
          label="Revenue"
          value={revenue}
          active={active === "moneyIn"}
          onClick={() => onSelect?.("moneyIn")}
        />
        <SourceTile
          label="Variable production cost"
          paren="Airtable"
          value={variableCost}
          active={active === "moneyOut" && moneyOutType === "variable"}
          onClick={() => onSelect?.("moneyOut", "variable")}
        />
        <SourceTile
          label="Operational fixed cost"
          paren="Overheads"
          value={fixedCost}
          active={active === "moneyOut" && moneyOutType === "fixed"}
          onClick={() => onSelect?.("moneyOut", "fixed")}
        />
      </div>

      {/* Derived profits — on the section card itself, not in tiles */}
      <div className="flex flex-wrap items-baseline justify-end gap-x-12 gap-y-3 border-t border-divider pt-5">
        <ProfitReadout label="Gross profit" hint="Revenue − variable" value={grossProfit} />
        <ProfitReadout
          label="Operating profit"
          hint="Gross − fixed"
          value={operatingProfit}
          strong
        />
      </div>

      {/* Secondary reads — VAT (clickable) and outstanding balances */}
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
            VAT {vatLabel} · est.
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

function SourceTile({
  label,
  paren,
  value,
  active,
  onClick,
}: {
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
        "group ssr-tile w-full p-5 text-left transition-all duration-200",
        active
          ? "ring-1 ring-gold/60"
          : "hover:-translate-y-0.5 hover:ring-1 hover:ring-white/10",
      )}
    >
      <p className="mb-3 flex items-baseline gap-1.5 text-[9px] uppercase tracking-[0.28em] text-foreground/40">
        <span>{label}</span>
        {paren && <span className="text-foreground/25">({paren})</span>}
      </p>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-serif text-2xl text-strong tabular-nums">
          {formatCurrency(value)}
        </span>
        <span className="text-xs text-gold opacity-0 transition-opacity group-hover:opacity-100">
          →
        </span>
      </div>
    </button>
  );
}

function ProfitReadout({
  label,
  hint,
  value,
  strong,
}: {
  label: string;
  hint?: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-[0.24em] text-foreground/40">{label}</span>
      {hint && (
        <span className="hidden text-[10px] uppercase tracking-[0.2em] text-foreground/25 md:inline">
          {hint}
        </span>
      )}
      <span
        className={cn(
          "font-serif tabular-nums",
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
