import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

// "Send Later" — the shape of Apple Mail's scheduling sheet (date field + time
// field with steppers, a month grid, an analogue clock, Cancel / Schedule),
// rendered in the studio's palette and type rather than macOS chrome.
//
// The clock is live: drag anywhere on the face to set the time. Hours snap to
// the nearest hour on the outer ring, minutes to 5 on the inner ring.

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const GOLD = "#C9A96A";
const GOLD_BRIGHT = "#ecd39c";

const pad = (n: number) => String(n).padStart(2, "0");

interface Props {
  /** Who the invitation goes to — shown so it's clear what's being scheduled. */
  recipient?: string;
  /** Initial value; defaults to one hour from now. */
  initial?: Date;
  busy?: boolean;
  onCancel: () => void;
  onSchedule: (when: Date) => void;
}

export function SendLaterDialog({ recipient, initial, busy, onCancel, onSchedule }: Props) {
  const start = useMemo(() => initial ?? new Date(Date.now() + 60 * 60 * 1000), [initial]);
  const [when, setWhen] = useState<Date>(start);
  // Which month the grid is showing — independent of the selected day.
  const [view, setView] = useState<{ y: number; m: number }>({ y: start.getFullYear(), m: start.getMonth() });

  const set = (fn: (d: Date) => void) => setWhen((cur) => { const d = new Date(cur); fn(d); return d; });

  // ── Month grid, Monday-first like the Apple sheet ──────────────────────────
  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7;            // Mon = 0
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const prevDays = new Date(view.y, view.m, 0).getDate();
    const cells: { d: number; other: boolean; date: Date }[] = [];
    for (let i = offset - 1; i >= 0; i--) cells.push({ d: prevDays - i, other: true, date: new Date(view.y, view.m - 1, prevDays - i) });
    for (let d = 1; d <= days; d++) cells.push({ d, other: false, date: new Date(view.y, view.m, d) });
    while (cells.length % 7 !== 0) { const d = cells.length - offset - days + 1; cells.push({ d, other: true, date: new Date(view.y, view.m + 1, d) }); }
    return cells;
  }, [view]);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = new Date();
  const isPast = when.getTime() <= Date.now();

  // ── Analogue clock — drag to set ───────────────────────────────────────────
  const R = 62, CX = 70, CY = 70;
  const hourAngle = ((when.getHours() % 12) + when.getMinutes() / 60) * 30 - 90;
  const minAngle = when.getMinutes() * 6 - 90;
  const hand = (angle: number, len: number) => ({
    x: CX + Math.cos((angle * Math.PI) / 180) * len,
    y: CY + Math.sin((angle * Math.PI) / 180) * len,
  });

  function faceDrag(e: React.MouseEvent<SVGSVGElement>) {
    if (e.buttons !== 1 && e.type !== "mousedown") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - CX, y = e.clientY - rect.top - CY;
    const dist = Math.hypot(x, y);
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    set((d) => {
      if (dist > R * 0.62) d.setHours(Math.round(deg / 30) % 12 + (when.getHours() >= 12 ? 12 : 0));
      else d.setMinutes((Math.round(deg / 6) % 60 - (Math.round(deg / 6) % 5)) % 60);
    });
  }

  // Portalled to <body> and given explicit pointer-events. This opens on top of
  // the Radix "Add member" dialog, which sets `pointer-events: none` on <body>
  // while it's open — without this the sheet renders but every click falls
  // through to the dialog underneath.
  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in"
      style={{ pointerEvents: "auto" }}
      onClick={onCancel}
    >
      <div className="ssr-tile w-full max-w-[520px] rounded-2xl p-6" style={{ pointerEvents: "auto" }} onClick={(e) => e.stopPropagation()}>
        <p className="font-sans text-sm font-medium text-strong">Send later</p>
        <p className="mt-1.5 text-xs leading-relaxed text-recessive">
          The invitation is held and sent at the time you choose. The account is created now,
          so nothing is lost if you close this.
        </p>
        {recipient && (
          <p className="mt-2 text-xs" style={{ color: GOLD_BRIGHT }}>{recipient}</p>
        )}

        {/* Date + time — type into them, or use the steppers */}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Stepper
            value={`${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()}`}
            width={98}
            onCommit={(text) => {
              const p = parseDate(text);
              if (!p) return false;
              set((d) => d.setFullYear(p.y, p.m, p.d));
              setView({ y: p.y, m: p.m });
              return true;
            }}
            onUp={() => set((d) => d.setDate(d.getDate() + 1))}
            onDown={() => set((d) => d.setDate(d.getDate() - 1))}
          />
          <Stepper
            value={`${pad(when.getHours())}:${pad(when.getMinutes())}`}
            width={54}
            onCommit={(text) => {
              const p = parseTime(text);
              if (!p) return false;
              set((d) => d.setHours(p.h, p.min, 0, 0));
              return true;
            }}
            onUp={() => set((d) => d.setMinutes(d.getMinutes() + 5))}
            onDown={() => set((d) => d.setMinutes(d.getMinutes() - 5))}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-start gap-6">
          {/* Month grid */}
          <div className="min-w-[212px] flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-sans text-xs text-strong">{MONTHS[view.m]} {view.y}</span>
              <span className="flex items-center gap-1">
                <button onClick={() => setView((v) => v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 })}
                  className="grid h-6 w-6 place-items-center rounded text-white/50 hover:bg-white/5 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /></button>
                <button onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })}
                  className="h-1.5 w-1.5 rounded-full bg-white/30 hover:bg-white/60" title="This month" />
                <button onClick={() => setView((v) => v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 })}
                  className="grid h-6 w-6 place-items-center rounded text-white/50 hover:bg-white/5 hover:text-white"><ChevronRight className="h-3.5 w-3.5" /></button>
              </span>
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {DOW.map((d) => (
                <span key={d} className="font-sans text-[9px] uppercase tracking-[0.1em] text-white/30">{d}</span>
              ))}
              {grid.map((c, i) => {
                const selected = sameDay(c.date, when);
                const isToday = sameDay(c.date, today);
                return (
                  <button
                    key={i}
                    onClick={() => { set((d) => { d.setFullYear(c.date.getFullYear(), c.date.getMonth(), c.date.getDate()); }); setView({ y: c.date.getFullYear(), m: c.date.getMonth() }); }}
                    className="mx-auto grid h-7 w-7 place-items-center rounded-md text-[11px] tabular-nums transition-colors"
                    style={{
                      background: selected ? GOLD : "transparent",
                      color: selected ? "#211a0f" : c.other ? "rgba(255,255,255,0.22)" : "var(--text-standard)",
                      boxShadow: !selected && isToday ? `inset 0 0 0 1px ${GOLD}55` : undefined,
                    }}
                  >{c.d}</button>
                );
              })}
            </div>
          </div>

          {/* Analogue clock — drag the face */}
          <svg
            width="140" height="140" viewBox="0 0 140 140"
            className="shrink-0 cursor-pointer select-none"
            onMouseDown={faceDrag} onMouseMove={faceDrag}
          >
            <circle cx={CX} cy={CY} r={R} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * 30 - 90) * Math.PI / 180;
              return (
                <text key={i} x={CX + Math.cos(a) * (R - 13)} y={CY + Math.sin(a) * (R - 13) + 3.5}
                  textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.45)" fontFamily="Montserrat, sans-serif">
                  {i === 0 ? 12 : i}
                </text>
              );
            })}
            <line x1={CX} y1={CY} {...(() => { const p = hand(hourAngle, R * 0.5); return { x2: p.x, y2: p.y }; })()}
              stroke={GOLD_BRIGHT} strokeWidth="2.5" strokeLinecap="round" />
            <line x1={CX} y1={CY} {...(() => { const p = hand(minAngle, R * 0.74); return { x2: p.x, y2: p.y }; })()}
              stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx={CX} cy={CY} r="2.5" fill={GOLD_BRIGHT} />
          </svg>
        </div>

        {isPast && (
          <p className="mt-4 text-[11px]" style={{ color: "#E4B95B" }}>
            That time has already passed — it would send immediately.
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="h-9 rounded-lg px-4 text-xs text-white/60 transition-colors hover:text-white disabled:opacity-40">Cancel</button>
          <button onClick={() => onSchedule(when)} disabled={busy}
            className="h-9 rounded-lg px-5 text-xs font-medium disabled:opacity-40"
            style={{ background: GOLD, color: "#211a0f" }}>
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Type into it, or nudge with the arrows. `onCommit` returns false if the text
 *  can't be parsed, in which case the field snaps back to the real value. */
function Stepper({ value, width, onCommit, onUp, onDown }: {
  value: string; width: number;
  onCommit: (text: string) => boolean;
  onUp: () => void; onDown: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null) { onCommit(draft); setDraft(null); } };
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-lg border border-white/12 focus-within:border-[#C9A96A]/60">
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setDraft(null); onUp(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setDraft(null); onDown(); }
        }}
        inputMode="numeric"
        style={{ width }}
        className="bg-transparent px-3 py-2 font-sans text-sm tabular-nums text-strong outline-none"
      />
      <span className="flex flex-col border-l border-white/12">
        <button type="button" onClick={onUp} className="grid h-[17px] w-6 place-items-center text-[8px] text-white/50 hover:bg-white/5 hover:text-white">▲</button>
        <button type="button" onClick={onDown} className="grid h-[17px] w-6 place-items-center border-t border-white/12 text-[8px] text-white/50 hover:bg-white/5 hover:text-white">▼</button>
      </span>
    </span>
  );
}

/** "5/8/2026", "05/08/2026" or "05/08/26" → parts. Day-first, as displayed. */
function parseDate(text: string): { y: number; m: number; d: number } | null {
  const m = text.trim().match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(y, mo, 0).getDate()) return null;   // rejects 31 February
  return { y, m: mo - 1, d };
}

/** "8:15", "08:15" or "0815" → parts. 24-hour. */
function parseTime(text: string): { h: number; min: number } | null {
  const t = text.trim();
  const m = t.match(/^(\d{1,2})\s*[:.h]?\s*(\d{2})$/) ?? t.match(/^(\d{1,2})$/);
  if (!m) return null;
  const h = +m[1], min = m[2] != null ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}
