import { useEffect, useMemo, useRef, useState } from "react";
import type { EarningsPeriod } from "@/components/EarningsView";

// Earnings by month.
//
// The job is "compare magnitude across a time series", so: columns, one hue.
// Height carries the value — the colour is not also encoding it, because
// double-encoding one variable buys nothing and costs legibility.
//
// One series, so no legend: the section title already says what's plotted.
// Values are labelled selectively (the best month, and the one you're hovering)
// rather than a number on every column, which nobody reads.

const GOLD = "#C9A96A";           // single series — contrast vs the tile passes 3:1
const GOLD_BRIGHT = "#ecd39c";    // hover only
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  periods: EarningsPeriod[];
  currency: string;
}

function money(n: number, ccy: string, dp = 2) {
  const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ccy === "USD" ? "$" : `${ccy} `;
  return sym + new Intl.NumberFormat("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n || 0);
}

/** Clean axis ceiling — 1/2/5 × a power of ten, so ticks land on round numbers. */
function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function EarningsChart({ periods, currency }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Measured, not scaled. A viewBox stretched to fit would distort the type;
  // measuring lets the columns spread across the tile at any month count, which
  // is what stops four months from huddling at the left edge.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bars = useMemo(
    () =>
      periods
        .filter((p) => p.period_year && p.period_month)
        .map((p) => ({
          key: p.key,
          year: p.period_year as number,
          month: p.period_month as number,
          label: MONTHS_SHORT[(p.period_month as number) - 1],
          total: p.total,
          balance: p.balance,
        })),
    [periods],
  );

  if (bars.length === 0) return null;

  // Geometry, in real pixels.
  const H = 208;
  const PAD_T = 26, PAD_B = 30, PAD_L = 56, PAD_R = 16;
  const plotH = H - PAD_T - PAD_B;
  const MIN_SLOT = 56;
  const avail = Math.max(width, 320) - PAD_L - PAD_R;
  const slot = Math.max(MIN_SLOT, avail / bars.length);
  const W = PAD_L + PAD_R + slot * bars.length;
  // ≤24px and never more than half the slot — the leftover is air, not padding.
  const barW = Math.min(24, Math.max(10, slot * 0.42));

  const max = niceCeil(Math.max(...bars.map((b) => b.total)));
  const ticks = [0, max / 2, max];
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const best = bars.reduce((a, b) => (b.total > a.total ? b : a), bars[0]);
  const multiYear = new Set(bars.map((b) => b.year)).size > 1;

  return (
    <div ref={wrapRef} className="ssr-tile overflow-x-auto p-5">
      <svg
        width={W} height={H}
        style={{ display: "block" }}
        role="img"
        aria-label={`Earnings by month, ${bars.length} months, highest ${money(best.total, currency, 0)} in ${best.label} ${best.year}`}
      >
        {/* Gridlines — hairline, solid, recessive. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <text
              x={PAD_L - 10} y={y(t) + 3} textAnchor="end"
              fill="rgba(255,255,255,0.35)" fontSize={9}
              style={{ letterSpacing: "0.08em", fontVariantNumeric: "tabular-nums" }}
            >
              {t === 0 ? "0" : money(t, currency, 0)}
            </text>
          </g>
        ))}

        {bars.map((b, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const top = y(b.total);
          const on = hover === i;
          const showValue = on || (hover === null && b.key === best.key);
          return (
            <g key={b.key}
               onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               style={{ cursor: "default" }}>
              {/* Hit target wider than the mark. */}
              <rect x={cx - slot / 2} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {on && (
                <rect x={cx - slot / 2 + 3} y={PAD_T - 8} width={slot - 6} height={plotH + 8}
                      rx={6} fill="rgba(255,255,255,0.035)" />
              )}
              {/* 4px rounded data-end, square at the baseline. */}
              <path
                d={`M ${cx - barW / 2} ${PAD_T + plotH}
                    L ${cx - barW / 2} ${top + 4}
                    Q ${cx - barW / 2} ${top} ${cx - barW / 2 + 4} ${top}
                    L ${cx + barW / 2 - 4} ${top}
                    Q ${cx + barW / 2} ${top} ${cx + barW / 2} ${top + 4}
                    L ${cx + barW / 2} ${PAD_T + plotH} Z`}
                fill={on ? GOLD_BRIGHT : GOLD}
                opacity={hover === null || on ? 1 : 0.45}
              />
              {showValue && (
                <text x={cx} y={top - 8} textAnchor="middle"
                      fill="rgba(255,255,255,0.92)" fontSize={11}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {money(b.total, currency, 0)}
                </text>
              )}
              <text x={cx} y={H - 10} textAnchor="middle"
                    fill={on ? "#ecd39c" : "rgba(255,255,255,0.45)"} fontSize={10}
                    style={{ letterSpacing: "0.1em" }}>
                {multiYear ? `${b.label} ${String(b.year).slice(2)}` : b.label}
              </text>
            </g>
          );
        })}

        {/* Baseline sits above the month labels, so the columns rest on something. */}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH}
              stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      </svg>

      {/* The hover read-out. Kept as text under the plot rather than a floating
          tooltip: it never covers a neighbouring column, and it holds still. */}
      <div className="mt-3 flex min-h-[16px] items-center gap-x-5 border-t border-white/[0.05] pt-3 text-[11px]">
        {hover !== null ? (
          <>
            <span className="text-strong">
              {MONTHS_SHORT[bars[hover].month - 1]} {bars[hover].year}
            </span>
            <span className="text-white/45">
              Fee <span className="tabular-nums text-gold">{money(bars[hover].total, currency)}</span>
            </span>
            {bars[hover].balance > 0.005 ? (
              <span className="text-white/45">
                Outstanding <span className="tabular-nums text-[#ecd39c]">{money(bars[hover].balance, currency)}</span>
              </span>
            ) : (
              <span className="text-white/30">Paid in full</span>
            )}
          </>
        ) : (
          <span className="text-white/25">
            {bars.length} month{bars.length === 1 ? "" : "s"} on record · hover a column for the detail
          </span>
        )}
      </div>
    </div>
  );
}
