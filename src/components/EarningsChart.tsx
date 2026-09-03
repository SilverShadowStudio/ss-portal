import { useEffect, useMemo, useRef, useState } from "react";
import type { EarningsPeriod } from "@/components/EarningsView";

// Earnings by month — a curve.
//
// The visual language follows the finance charts Fred picked out: a smooth line
// with a soft bloom, a gradient wash falling away beneath it, a crosshair, and a
// value pill on the point being read.
//
// The curve is MONOTONE cubic, not a plain spline. An ordinary smooth curve
// overshoots between points — it would draw earnings above a month's peak or
// below zero, inventing money that was never invoiced. Monotone interpolation
// bends but never exceeds the values it joins.
//
// One series, so no legend: the section title says what's plotted.

const GOLD = "#C9A96A";
const GOLD_BRIGHT = "#ecd39c";
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

/**
 * Monotone cubic (Fritsch–Carlson) as an SVG path.
 *
 * The tangent clamp is the whole point: where the data turns, the slope is
 * forced to zero, and elsewhere it's limited to 3× the neighbouring secant.
 * That is what stops the curve bulging past a peak or dipping below a trough.
 */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const dx: number[] = [], dy: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dy[i] / dx[i];
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A turning point gets a flat tangent, so the curve can't sail past it.
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = (3 / Math.sqrt(s)) * slope[i];
      m[i] = t * a; m[i + 1] = t * b;
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3, c1y = pts[i].y + (m[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3, c2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

export function EarningsChart({ periods, currency }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const months = useMemo(() => {
    type M = { key: string; year: number; month: number; label: string; total: number; balance: number; worked: boolean };
    const worked: M[] = periods
      .filter((p) => p.period_year && p.period_month)
      .map((p) => ({
        key: p.key,
        year: p.period_year as number,
        month: p.period_month as number,
        label: MONTHS_SHORT[(p.period_month as number) - 1],
        total: p.total,
        balance: p.balance,
        worked: true,
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month);
    if (worked.length === 0) return [] as M[];

    // Fill the calendar gaps between the first and last worked month with
    // zero-value months, so the axis reads as a continuous run of months rather
    // than only the ones that were billed. Un-worked months sit at 0.
    const has = new Set(worked.map((w) => `${w.year}-${w.month}`));
    const out: M[] = [];
    const last = worked[worked.length - 1];
    let y = worked[0].year, m = worked[0].month, wi = 0;
    while (y < last.year || (y === last.year && m <= last.month)) {
      if (has.has(`${y}-${m}`)) {
        while (wi < worked.length && worked[wi].year === y && worked[wi].month === m) out.push(worked[wi++]);
      } else {
        out.push({ key: `gap-${y}-${m}`, year: y, month: m, label: MONTHS_SHORT[m - 1], total: 0, balance: 0, worked: false });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }, [periods]);

  if (months.length === 0) return null;

  const H = 236;
  const PAD_T = 36, PAD_B = 34, PAD_L = 58, PAD_R = 26;
  const plotH = H - PAD_T - PAD_B;
  const avail = Math.max(width, 320) - PAD_L - PAD_R;
  const slot = Math.max(56, avail / months.length);
  const W = PAD_L + PAD_R + slot * months.length;

  const max = niceCeil(Math.max(...months.map((b) => b.total)));
  const ticks = [0, max / 2, max];
  const yOf = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const xOf = (i: number) => PAD_L + slot * i + slot / 2;

  const pts = months.map((b, i) => ({ x: xOf(i), y: yOf(b.total) }));
  const line = monotonePath(pts);
  const area = pts.length > 1
    ? `${line} L ${pts[pts.length - 1].x} ${PAD_T + plotH} L ${pts[0].x} ${PAD_T + plotH} Z`
    : "";

  const multiYear = new Set(months.map((b) => b.year)).size > 1;
  const active = hover ?? months.length - 1;   // the latest month reads by default
  const ap = pts[active];
  const ab = months[active];

  /** Nearest month to the pointer — a crosshair tracks the axis, not the mark. */
  function track(e: React.MouseEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bestD) { bestD = d; best = i; } });
    setHover(best);
  }

  const pillLabel = money(ab.total, currency, 0);
  const pillW = Math.max(52, pillLabel.length * 7.4 + 18);
  const pillX = Math.min(Math.max(ap.x - pillW / 2, PAD_L), W - PAD_R - pillW);

  return (
    <div ref={wrapRef} className="ssr-tile overflow-x-auto p-5">
      <svg
        ref={svgRef}
        width={W} height={H}
        style={{ display: "block" }}
        onMouseMove={track}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Earnings by month across ${months.length} months, latest ${money(months[months.length - 1].total, currency, 0)}`}
      >
        <defs>
          {/* The wash under the curve. The usual ~10% wash is calibrated for a
              light surface; gold at that strength on this plum simply vanishes,
              so it's pitched to read as mass here and still fade to nothing. */}
          <linearGradient id="ssr-earn-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD_BRIGHT} stopOpacity={0.42} />
            <stop offset="38%" stopColor={GOLD} stopOpacity={0.16} />
            <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
          </linearGradient>
          {/* The bloom. Drawn under the crisp stroke so the line stays sharp. */}
          <filter id="ssr-earn-glow" x="-30%" y="-60%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /></feMerge>
          </filter>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yOf(t)} y2={yOf(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={PAD_L - 12} y={yOf(t) + 3} textAnchor="end" fill="rgba(255,255,255,0.32)" fontSize={9}
                  style={{ letterSpacing: "0.08em", fontVariantNumeric: "tabular-nums" }}>
              {t === 0 ? "0" : money(t, currency, 0)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill="url(#ssr-earn-fill)" />}

        {/* Crosshair — column band and vertical, behind the curve. */}
        {hover !== null && (
          <g>
            <rect x={ap.x - slot / 2} y={PAD_T - 12} width={slot} height={plotH + 12} rx={8} fill="rgba(255,255,255,0.04)" />
            <line x1={ap.x} x2={ap.x} y1={PAD_T - 12} y2={PAD_T + plotH} stroke="rgba(236,211,156,0.28)" strokeWidth={1} />
          </g>
        )}

        {area && (
          <path d={line} fill="none" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                opacity={0.55} filter="url(#ssr-earn-glow)" />
        )}
        <path d={line} fill="none" stroke={hover !== null ? GOLD_BRIGHT : GOLD}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* The reading point: filled, with a surface ring so it stays legible. */}
        <circle cx={ap.x} cy={ap.y} r={9} fill={GOLD_BRIGHT} opacity={0.16} />
        <circle cx={ap.x} cy={ap.y} r={4.5} fill={GOLD_BRIGHT} stroke="#211c25" strokeWidth={2} />

        {/* Value pill, clamped so it never runs off either edge. */}
        <g transform={`translate(${pillX}, ${Math.max(ap.y - 34, 2)})`}>
          <rect width={pillW} height={21} rx={10.5} fill="rgba(255,255,255,0.10)" />
          <text x={pillW / 2} y={14.5} textAnchor="middle" fill="#fff" fontSize={11}
                style={{ fontVariantNumeric: "tabular-nums" }}>
            {pillLabel}
          </text>
        </g>

        {months.map((b, i) => (
          <text key={b.key} x={xOf(i)} y={H - 12} textAnchor="middle"
                fill={i === active ? GOLD_BRIGHT : b.worked ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.20)"} fontSize={10}
                style={{ letterSpacing: "0.1em" }}>
            {multiYear ? `${b.label} ${String(b.year).slice(2)}` : b.label}
          </text>
        ))}

        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
      </svg>

      {/* Read-out row, in the manner of the reference charts: the numbers for
          whichever month is being read, held still under the plot. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-1 border-t border-white/[0.05] pt-3 text-[11px]">
        <span className="text-white/35">{MONTHS_SHORT[ab.month - 1]} {ab.year}</span>
        {ab.worked ? (
          <>
            <span className="text-white/35">
              Fee <span className="ml-1.5 tabular-nums text-gold">{money(ab.total, currency)}</span>
            </span>
            <span className="text-white/35">
              {ab.balance > 0.005 ? (
                <>Outstanding <span className="ml-1.5 tabular-nums text-[#ecd39c]">{money(ab.balance, currency)}</span></>
              ) : (
                <>Status <span className="ml-1.5 text-white/55">Paid in full</span></>
              )}
            </span>
          </>
        ) : (
          <span className="text-white/35">No invoiced work this month</span>
        )}
        <span className="ml-auto text-white/20">
          {hover === null ? "Hover the curve to read a month" : `${months.filter((b) => b.worked).length} months on record`}
        </span>
      </div>
    </div>
  );
}
