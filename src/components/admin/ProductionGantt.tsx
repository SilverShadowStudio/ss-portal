import { useEffect, useMemo } from "react";

// ─── Gantt-scoped warm background constants ───────────────────────────────────
const GANTT_CARD_BG   = '#14110d';
const GANTT_HEADER_BG = '#171410';
const GANTT_GROUP_BG  = '#1a1611';

// ─── Fixed geometry constants ─────────────────────────────────────────────────
const CELL_W        = 34;
const SCENE_COL_W   = 248;
const MANAGER_COL_W = 132;
const FROZEN_W      = SCENE_COL_W + MANAGER_COL_W; // 380
const HEADER_H      = 132;
const GROUP_H       = 46;
const SCENE_H       = 38;
const BAR_TOP       = 5;
const BAR_H         = 28;
const CELL_BAR_W    = 31;

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function lighten(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

// ─── Date utilities ───────────────────────────────────────────────────────────
// Convert a UTC ISO string to the UK calendar date at local midnight.
// Uses Europe/London timezone so getDay()/getDate() reflect UK time, not the
// viewer's browser timezone. This matters for rounds stored at midnight UTC
// which would read as the previous day in UTC-based getDay() calls.
function toUKCalendarDate(iso: string): Date {
  const ukStr = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [y, m, d] = ukStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWeekend(d: Date): boolean { return d.getDay() === 0 || d.getDay() === 6; }

function shiftDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Weekend snap: Saturday → Friday (−1), Sunday → Monday (+1).
// Applied consistently to all bar dates. A Sat start appears 1 day earlier;
// a Sun start appears 1 day later — at most 1-day visual shift per date.
function snapWeekday(d: Date): Date {
  if (d.getDay() === 6) return shiftDays(d, -1);
  if (d.getDay() === 0) return shiftDays(d, 1);
  return d;
}

function prevWeekday(d: Date): Date {
  let r = shiftDays(d, -1);
  while (isWeekend(r)) r = shiftDays(r, -1);
  return r;
}

function nextWeekday(d: Date): Date {
  let r = shiftDays(d, 1);
  while (isWeekend(r)) r = shiftDays(r, 1);
  return r;
}

// Build an ordered Mon–Fri Date array covering all supplied dates,
// padded by one weekday on each side.
function buildWindowDates(rawDates: Date[]): Date[] {
  if (!rawDates.length) return [];
  let min = rawDates[0], max = rawDates[0];
  for (const d of rawDates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const start = prevWeekday(snapWeekday(new Date(min)));
  const end   = nextWeekday(snapWeekday(new Date(max)));
  const dates: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (!isWeekend(cur)) dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Map a UTC ISO string to the nearest column index. Weekend snap applied.
function dateToCol(iso: string, dateMap: Map<string, number>): number | null {
  const snapped = snapWeekday(toUKCalendarDate(iso));
  return dateMap.get(toDateKey(snapped)) ?? null;
}

// ─── Segment types ────────────────────────────────────────────────────────────
type BandSeg  = { kind: 'band';  col: number; span: number; bg: string };
type CellSeg  = { kind: 'cell';  col: number; num: number;  bg: string };
type LabelSeg = { kind: 'label'; col: number; text: string; color: string };
type Seg = BandSeg | CellSeg | LabelSeg;

function band(col: number, span: number, bg: string): BandSeg   { return { kind: 'band',  col, span, bg }; }
function cell(col: number, num: number,  bg: string): CellSeg   { return { kind: 'cell',  col, num,  bg }; }
function lbl (col: number, text: string, color: string): LabelSeg { return { kind: 'label', col, text, color }; }

// ─── Data types (exported — imported by AdminTimeline for fetch + shaping) ────
export interface GanttRound {
  id: string;
  roundNumber: number;
  kind: 'production' | 'review';
  startDate:   string | null;
  endDate:     string | null;
  deliveredAt: string | null;
}

export interface GanttScene {
  id: string;
  name: string;
  rounds: GanttRound[];
}

export interface GanttProject {
  id: string;
  code: string;
  name: string;
  scenes: GanttScene[];
}

// ─── Segment builder ──────────────────────────────────────────────────────────
function buildSegsForRound(
  round: GanttRound,
  dateMap: Map<string, number>,
  prod: string,
  fb: string,
  showLabels: boolean,
): Seg[] {
  const isProd     = round.kind !== 'review';
  const color      = isProd ? prod : fb;
  const bandBg     = withAlpha(color, isProd ? 0.20 : 0.18);
  const labelColor = lighten(color, 0.5);
  const labelText  = isProd ? 'Production' : 'Feedback';

  // Delivery milestone: no start_date but has delivered_at — legacy and non-BA
  // Dropbox-delivered rounds that the old timeline filtered out with IS NOT NULL.
  if (!round.startDate && round.deliveredAt) {
    const col = dateToCol(round.deliveredAt, dateMap);
    if (col === null) return [];
    return [cell(col, round.roundNumber, color)];
  }

  // Duration band: start_date is set (BA-booked or manually scheduled)
  if (round.startDate) {
    const startCol = dateToCol(round.startDate, dateMap);
    if (startCol === null) return [];
    let endCol = startCol; // fallback: point event if end_date absent/null
    if (round.endDate) {
      const c = dateToCol(round.endDate, dateMap);
      if (c !== null && c > startCol) endCol = c;
    }
    const span = endCol - startCol;
    const segs: Seg[] = [];
    if (span > 0) segs.push(band(startCol, span, bandBg));
    segs.push(cell(startCol, round.roundNumber, color));
    // Label only when there's room (span > 1 clears the cell marker)
    if (showLabels && span > 1) segs.push(lbl(startCol + 1, labelText, labelColor));
    return segs;
  }

  return [];
}

// ─── Segment renderer ─────────────────────────────────────────────────────────
function renderSeg(seg: Seg, i: number) {
  if (seg.kind === 'band') {
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          top: BAR_TOP,
          left: seg.col * CELL_W,
          width: seg.span * CELL_W - 3,
          height: BAR_H,
          borderRadius: 5,
          zIndex: 1,
          background: seg.bg,
        }}
      />
    );
  }
  if (seg.kind === 'cell') {
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          top: BAR_TOP,
          left: seg.col * CELL_W,
          width: CELL_BAR_W,
          height: BAR_H,
          borderRadius: 5,
          zIndex: 3,
          background: seg.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
          color: '#f4efe5',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "'Jost', sans-serif",
        }}
      >
        {seg.num}
      </div>
    );
  }
  return (
    <div
      key={i}
      style={{
        position: 'absolute',
        top: 12,
        left: seg.col * CELL_W + 6,
        zIndex: 4,
        fontSize: 9,
        fontWeight: 600,
        fontFamily: "'Jost', sans-serif",
        letterSpacing: '1.5px',
        textTransform: 'uppercase' as const,
        color: seg.color,
        whiteSpace: 'nowrap',
      }}
    >
      {seg.text}
    </div>
  );
}

// ─── Scrollbar + font injection ───────────────────────────────────────────────
const SCROLLBAR_CSS = `
.gantt-scroll::-webkit-scrollbar { height: 8px; }
.gantt-scroll::-webkit-scrollbar-track { background: #0c0a08; border-radius: 6px; }
.gantt-scroll::-webkit-scrollbar-thumb { background: #2c2620; border-radius: 6px; border: 2px solid #0c0a08; }
.gantt-scroll::-webkit-scrollbar-thumb:hover { background: #3c352b; }
`;

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDay(d: Date): string {
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface ProductionGanttProps {
  projects:         GanttProject[];
  loading:          boolean;
  showSupabase?:    boolean;
  productionColor?: string;
  feedbackColor?:   string;
  showPhaseLabels?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ProductionGantt({
  projects,
  loading,
  showSupabase    = true,
  productionColor = '#4f6c99',
  feedbackColor   = '#a8493c',
  showPhaseLabels = true,
}: ProductionGanttProps) {

  useEffect(() => {
    const fontId = 'gantt-gfonts';
    if (!document.getElementById(fontId)) {
      const link = document.createElement('link');
      link.id = fontId;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Jost:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }
    const cssId = 'gantt-scrollbar-css';
    if (!document.getElementById(cssId)) {
      const style = document.createElement('style');
      style.id = cssId;
      style.textContent = SCROLLBAR_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Derive date window from real data
  const { dates, dateMap } = useMemo(() => {
    if (!showSupabase || !projects.length) {
      return { dates: [] as Date[], dateMap: new Map<string, number>() };
    }
    const all: Date[] = [];
    for (const proj of projects) {
      for (const scene of proj.scenes) {
        for (const round of scene.rounds) {
          if (round.startDate)   all.push(toUKCalendarDate(round.startDate));
          if (round.endDate)     all.push(toUKCalendarDate(round.endDate));
          if (round.deliveredAt) all.push(toUKCalendarDate(round.deliveredAt));
        }
      }
    }
    const d = buildWindowDates(all);
    const m = new Map<string, number>();
    d.forEach((date, i) => m.set(toDateKey(date), i));
    return { dates: d, dateMap: m };
  }, [projects, showSupabase]);

  const TRACK_W_DYN   = dates.length * CELL_W;
  const CONTENT_W_DYN = FROZEN_W + TRACK_W_DYN;

  const cardStyle: React.CSSProperties = {
    background: GANTT_CARD_BG,
    border: '1px solid rgba(197,165,114,0.13)',
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 28,
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ ...cardStyle, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#8c8478', fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '2.5px', textTransform: 'uppercase' }}>
          Loading schedule…
        </span>
      </div>
    );
  }

  // Empty / hidden state
  if (!showSupabase || !projects.length || !dates.length) {
    return (
      <div style={{ ...cardStyle, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6a6258', fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase' }}>
          {!showSupabase ? 'Supabase data hidden' : 'No scheduled rounds found'}
        </span>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div className="gantt-scroll" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ width: CONTENT_W_DYN }}>

          {/* ── Date header row ── */}
          <div style={{ display: 'flex', height: HEADER_H }}>
            {/* Frozen header left */}
            <div
              style={{
                width: FROZEN_W,
                height: HEADER_H,
                background: GANTT_HEADER_BG,
                position: 'sticky',
                left: 0,
                zIndex: 7,
                borderRight: '1px solid rgba(197,165,114,0.16)',
                display: 'flex',
                alignItems: 'flex-end',
                flexShrink: 0,
              }}
            >
              <div style={{ width: SCENE_COL_W, paddingLeft: 34, paddingBottom: 12, fontSize: 11, fontWeight: 500, fontFamily: "'Jost', sans-serif", letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8c8478' }}>
                Scene
              </div>
              <div style={{ width: MANAGER_COL_W, paddingBottom: 12, fontSize: 11, fontWeight: 500, fontFamily: "'Jost', sans-serif", letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8c8478' }}>
                Manager
              </div>
            </div>

            {/* Day columns */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {dates.map((d, i) => {
                const isMon = d.getDay() === 1;
                return (
                  <div
                    key={i}
                    style={{
                      width: CELL_W,
                      height: HEADER_H,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      paddingBottom: 10,
                      borderRight: '1px solid rgba(197,165,114,0.05)',
                      borderLeft: isMon ? '1px solid rgba(197,165,114,0.14)' : undefined,
                      boxSizing: 'border-box',
                    }}
                  >
                    <span
                      style={{
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        fontSize: 10,
                        fontWeight: 500,
                        fontFamily: "'Jost', sans-serif",
                        letterSpacing: '0.8px',
                        color: isMon ? '#c7a06a' : '#8c8478',
                        userSelect: 'none',
                      }}
                    >
                      {fmtDay(d)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Projects ── */}
          {projects.map((proj) => (
            <div key={proj.id}>
              {/* Group header row */}
              <div style={{ display: 'flex', height: GROUP_H, background: GANTT_GROUP_BG }}>
                <div
                  style={{
                    width: FROZEN_W,
                    height: GROUP_H,
                    background: GANTT_GROUP_BG,
                    position: 'sticky',
                    left: 0,
                    zIndex: 6,
                    borderRight: '1px solid rgba(197,165,114,0.16)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    paddingLeft: 22,
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontWeight: 600, color: '#d8c39a' }}>
                    {proj.code || proj.name}
                  </span>
                  {proj.code && (
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontWeight: 400, color: '#a89c86' }}>
                      {proj.name}
                    </span>
                  )}
                </div>
                <div style={{ width: TRACK_W_DYN, height: GROUP_H, padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ height: 1, width: '100%', background: 'linear-gradient(90deg, rgba(197,165,114,0.20), rgba(197,165,114,0))' }} />
                </div>
              </div>

              {/* Scene rows */}
              {proj.scenes.map((scene) => {
                const segs = showSupabase
                  ? scene.rounds.flatMap((r) =>
                      buildSegsForRound(r, dateMap, productionColor, feedbackColor, showPhaseLabels)
                    )
                  : [];
                return (
                  <div key={scene.id} style={{ display: 'flex', height: SCENE_H }}>
                    {/* Frozen scene left */}
                    <div
                      style={{
                        width: FROZEN_W,
                        height: SCENE_H,
                        background: GANTT_CARD_BG,
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                        borderRight: '1px solid rgba(197,165,114,0.16)',
                        borderBottom: '1px solid rgba(197,165,114,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: SCENE_COL_W,
                          paddingLeft: 34,
                          fontSize: 12.5,
                          fontFamily: "'Jost', sans-serif",
                          color: '#cfc7b8',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {scene.name}
                      </div>
                      {/* Manager placeholder — real names from Airtable in Stage 3 */}
                      <div style={{ width: MANAGER_COL_W, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                        <span style={{ fontSize: 10, fontFamily: "'Jost', sans-serif", color: '#3a332c' }}>—</span>
                      </div>
                    </div>

                    {/* Track lane */}
                    <div
                      style={{
                        width: TRACK_W_DYN,
                        height: SCENE_H,
                        position: 'relative',
                        borderBottom: '1px solid rgba(197,165,114,0.05)',
                        flexShrink: 0,
                        backgroundImage: [
                          'repeating-linear-gradient(90deg, rgba(197,165,114,0.035) 0 1px, transparent 1px 34px)',
                          'repeating-linear-gradient(90deg, rgba(197,165,114,0.09)  0 1px, transparent 1px 170px)',
                        ].join(', '),
                      }}
                    >
                      {segs.map((seg, i) => renderSeg(seg, i))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

        </div>
      </div>
    </div>
  );
}
