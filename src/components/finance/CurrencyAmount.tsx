import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFx } from "@/contexts/FxContext";
import { CURRENCY_SYMBOL, formatMoney } from "@/lib/fx";

const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * A money value shown in GBP. When the source is a foreign currency the £ value
 * is the quiet ECB conversion, followed by a small coloured currency symbol;
 * click it to see the calculation (original amount × rate = £). Past/paid values
 * lock to their date's rate (pass rateDate); future/unpaid use the live rate
 * (rateDate = null).
 */
export function CurrencyAmount({
  amount, currency, rateDate = null, className = "",
}: {
  amount: number;
  currency: string;
  rateDate?: string | null; // null → live rate
  className?: string;
}) {
  const fx = useFx();
  const cur = (currency || "GBP").toUpperCase();

  if (cur === "GBP") {
    return <span className={`tabular-nums ${className}`}>{formatMoney(amount, "GBP")}</span>;
  }

  const c = fx.convert(amount, cur, rateDate);
  const sym = CURRENCY_SYMBOL[cur] ?? cur;

  // Rate unavailable (offline / not yet loaded) — show the original, quietly.
  if (c.gbp == null || c.rate == null) {
    return <span className={`tabular-nums text-[#8FB0C9] ${className}`} title={`${cur} — conversion unavailable`}>{formatMoney(amount, cur)}</span>;
  }

  return (
    <span className={`inline-flex items-baseline gap-1.5 tabular-nums ${className}`}>
      {formatMoney(c.gbp, "GBP")}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="text-[#8FB0C9] hover:text-[#b9d4e6] transition-colors text-[11px] leading-none"
            title={`Converted from ${cur} — click for the calculation`}
          >
            {sym}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 rounded-sm border-divider bg-background p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-3 text-[9px] uppercase tracking-[0.24em] text-[#8FB0C9]">Currency conversion</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-recessive">Amount</span>
              <span className="tabular-nums text-strong">{formatMoney(amount, cur)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-recessive">Rate</span>
              <span className="tabular-nums text-standard">1 {cur} = {c.rate.toFixed(4)} GBP</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.08] pt-2">
              <span className="text-recessive">Total</span>
              <span className="tabular-nums text-strong">{formatMoney(c.gbp, "GBP")}</span>
            </div>
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-white/35">
            ECB rate · {c.live ? "live" : `as of ${fmtDate(c.rateDate)}`}
          </p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
