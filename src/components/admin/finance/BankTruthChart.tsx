import { useMemo, useState } from "react";

// The Revolut bank-truth trading position over time: monthly income (up) vs
// expenses (down) as thin bars, with each month's net as a neutral marker line.
// One £ axis, position encodes polarity, hover reveals the exact figures.

interface Txn { date_completed: string | null; amount: number; classification: string }

const INCOME = "#84b594";   // money in  (matches the page's income colour)
const EXPENSE = "#cf9080";  // money out (matches the page's expense colour)
const NET = "#e8dcc4";      // neutral ink for the net line
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}
const kLabel = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1000) return `${v < 0 ? "−" : ""}£${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `${v < 0 ? "−" : ""}£${a.toFixed(0)}`;
};
const money = (v: number) => `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function BankTruthChart({ rows }: { rows: Txn[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const months = useMemo(() => {
    const m = new Map<string, { income: number; expense: number }>();
    for (const t of rows) {
      if (!t.date_completed) continue;
      const isIncome = t.classification === "client_income" || t.classification === "ebay_resale" || t.classification === "refund";
      const isExpense = t.classification === "expense" || t.classification === "bank_fee"; // expense amounts are negative
      if (!isIncome && !isExpense) continue; // non-trading (internal FX / financing) excluded
      const key = t.date_completed.slice(0, 7); // YYYY-MM
      const e = m.get(key) ?? { income: 0, expense: 0 };
      if (isIncome) e.income += t.amount; else e.expense += t.amount;
      m.set(key, e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({
      key, income: v.income, expense: v.expense, net: v.income + v.expense,
    }));
  }, [rows]);

  if (months.length === 0) return null;

  const W = 1000, H = 250, padL = 8, padR = 8, padT = 16, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxUp = Math.max(1, ...months.map((m) => m.income), ...months.map((m) => m.net));
  const maxDn = Math.max(1, ...months.map((m) => -m.expense), ...months.map((m) => -m.net));
  const top = niceCeil(maxUp), bot = niceCeil(maxDn);
  const zeroY = padT + (top / (top + bot)) * plotH;
  const yUp = (v: number) => zeroY - (v / top) * (zeroY - padT);
  const yDn = (v: number) => zeroY + (-v / bot) * (H - padB - zeroY);
  const slot = plotW / months.length;
  const barW = Math.min(18, slot * 0.36);

  const gridVals = [top, top / 2, -bot / 2, -bot];

  return (
    <div className="relative mt-6" onMouseLeave={() => setHover(null)}>
      {/* Legend */}
      <div className="mb-3 flex items-center gap-5">
        {[["Income", INCOME], ["Expenses", EXPENSE], ["Net", NET]].map(([l, c]) => (
          <div key={l} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: c as string }} />
            <span className="text-[11px] uppercase tracking-[0.16em] text-white/40">{l}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} preserveAspectRatio="none">
        {/* gridlines + y labels */}
        {gridVals.map((gv, i) => {
          const y = gv >= 0 ? yUp(gv) : yDn(gv);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={padL + 2} y={y - 3} fontSize={9} fill="rgba(255,255,255,0.28)" style={{ letterSpacing: "0.05em" }}>{kLabel(gv)}</text>
            </g>
          );
        })}
        {/* zero baseline */}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />

        {/* bars */}
        {months.map((m, i) => {
          const cx = padL + slot * (i + 0.5);
          const active = hover === i;
          return (
            <g key={m.key} opacity={hover == null || active ? 1 : 0.4} style={{ transition: "opacity 120ms" }}>
              {m.income > 0 && <rect x={cx - barW / 2} y={yUp(m.income)} width={barW} height={Math.max(1, zeroY - yUp(m.income))} rx={3} fill={INCOME} />}
              {m.expense < 0 && <rect x={cx - barW / 2} y={zeroY} width={barW} height={Math.max(1, yDn(m.expense) - zeroY)} rx={3} fill={EXPENSE} />}
            </g>
          );
        })}

        {/* net line + dots */}
        <polyline
          points={months.map((m, i) => `${padL + slot * (i + 0.5)},${m.net >= 0 ? yUp(m.net) : yDn(m.net)}`).join(" ")}
          fill="none" stroke={NET} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9}
        />
        {months.map((m, i) => {
          const y = m.net >= 0 ? yUp(m.net) : yDn(m.net);
          return <circle key={m.key} cx={padL + slot * (i + 0.5)} cy={y} r={hover === i ? 3.5 : 2} fill={NET} />;
        })}

        {/* x labels — every other month to avoid clutter */}
        {months.map((m, i) => {
          if (months.length > 8 && i % 2 !== 0) return null;
          const [y, mm] = m.key.split("-");
          return <text key={m.key} x={padL + slot * (i + 0.5)} y={H - 8} fontSize={9} fill="rgba(255,255,255,0.32)" textAnchor="middle" style={{ letterSpacing: "0.04em" }}>{MONTHS_SHORT[+mm - 1]}{mm === "01" ? ` '${y.slice(2)}` : ""}</text>;
        })}

        {/* hover hit areas */}
        {months.map((m, i) => (
          <rect key={m.key} x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} style={{ cursor: "default" }} />
        ))}
      </svg>

      {/* tooltip */}
      {hover != null && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-[#17131c] px-3 py-2 shadow-lg"
          style={{ left: `${((hover + 0.5) / months.length) * 100}%`, top: 8, transform: `translateX(${hover < months.length / 2 ? "8px" : "calc(-100% - 8px)"})` }}>
          <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-white/45">{MONTHS_SHORT[+months[hover].key.split("-")[1] - 1]} {months[hover].key.split("-")[0]}</p>
          <div className="space-y-0.5 text-xs tabular-nums">
            <div className="flex items-center justify-between gap-6"><span style={{ color: INCOME }}>Income</span><span className="text-white/85">{money(months[hover].income)}</span></div>
            <div className="flex items-center justify-between gap-6"><span style={{ color: EXPENSE }}>Expenses</span><span className="text-white/85">{money(months[hover].expense)}</span></div>
            <div className="mt-0.5 flex items-center justify-between gap-6 border-t border-white/10 pt-0.5"><span className="text-white/60">Net</span><span className="text-white/90">{money(months[hover].net)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
