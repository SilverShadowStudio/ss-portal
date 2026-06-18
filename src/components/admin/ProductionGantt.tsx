import { useEffect } from "react";

// ─── Gantt-scoped warm background constants ───────────────────────────────────
const GANTT_CARD_BG   = '#14110d';
const GANTT_HEADER_BG = '#171410';
const GANTT_GROUP_BG  = '#1a1611';

// ─── Geometry constants (reproduce design spec exactly) ───────────────────────
const CELL_W        = 34;
const N_DAYS        = 49;
const TRACK_W       = N_DAYS * CELL_W;        // 1666
const SCENE_COL_W   = 248;
const MANAGER_COL_W = 132;
const FROZEN_W      = SCENE_COL_W + MANAGER_COL_W; // 380
const CONTENT_W     = FROZEN_W + TRACK_W;           // 2046
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

// ─── Date generation ──────────────────────────────────────────────────────────
function buildDates(): Date[] {
  const dates: Date[] = [];
  const cur = new Date(2025, 4, 19); // Mon 19 May 2025
  while (dates.length < N_DAYS) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

const DATES = buildDates();

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDay(d: Date): string {
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

// ─── Segment types ────────────────────────────────────────────────────────────
type BandSeg  = { kind: 'band';  col: number; span: number; bg: string };
type CellSeg  = { kind: 'cell';  col: number; num: number;  bg: string };
type LabelSeg = { kind: 'label'; col: number; text: string; color: string };
type Seg = BandSeg | CellSeg | LabelSeg;

function band(col: number, span: number, bg: string): BandSeg   { return { kind: 'band',  col, span, bg }; }
function cell(col: number, num: number,  bg: string): CellSeg   { return { kind: 'cell',  col, num,  bg }; }
function lbl (col: number, text: string, color: string): LabelSeg { return { kind: 'label', col, text, color }; }

// ─── Scene segment builders ───────────────────────────────────────────────────
type SegFn = (prod: string, fb: string, showLabels: boolean) => Seg[];

function c88Scene(num: number, hasFeedback: boolean): SegFn {
  return (prod, fb, show) => {
    const prodBand  = withAlpha(prod, 0.20);
    const fbBand    = withAlpha(fb,   0.18);
    const prodLbl   = lighten(prod, 0.5);
    const fbLbl     = lighten(fb,   0.5);
    const segs: Seg[] = [
      band(1, 19, prodBand),
      cell(1, num, prod),
      ...(show ? [lbl(2, 'Production', prodLbl)] : []),
      cell(20, num, fb),
      cell(25, num, fb),
    ];
    if (hasFeedback) {
      segs.push(band(26, 13, fbBand));
      if (show) segs.push(lbl(26, 'Feedback', fbLbl));
    }
    return segs;
  };
}

function c101Scene(empty: boolean): SegFn {
  if (empty) return () => [];
  return (prod, fb, show) => {
    const fbBand  = withAlpha(fb, 0.18);
    const prodLbl = lighten(prod, 0.5);
    const fbLbl   = lighten(fb,  0.5);
    return [
      cell(16, 1, prod),
      ...(show ? [lbl(17, 'Production', prodLbl)] : []),
      cell(19, 1, fb),
      band(20, 18, fbBand),
      ...(show ? [lbl(20, 'Feedback', fbLbl)] : []),
    ];
  };
}

function c104Scene(): SegFn {
  return (prod, fb, show) => {
    const prodBand = withAlpha(prod, 0.20);
    const fbBand   = withAlpha(fb,   0.18);
    const prodLbl  = lighten(prod, 0.5);
    const fbLbl    = lighten(fb,   0.5);
    return [
      band(9,  3,  prodBand), cell(9,  1, prod), ...(show ? [lbl(10, 'Production', prodLbl)] : []),
      cell(12, 1,  fb),       band(13, 17, fbBand), ...(show ? [lbl(13, 'Feedback', fbLbl)] : []),
      band(30, 18, prodBand), cell(30, 2, prod), ...(show ? [lbl(31, 'Production', prodLbl)] : []),
      cell(48, 2, fb),
    ];
  };
}

// ─── Static data ──────────────────────────────────────────────────────────────
interface Manager { name: string; color: string }
const MGR: Record<string, Manager> = {
  katerina: { name: 'Katerina', color: '#8a76ad' },
  fiodor:   { name: 'Fiodor',   color: '#4f9aa3' },
  may:      { name: 'May',      color: '#b0604f' },
};

interface SceneDef { name: string; segFn: SegFn }
interface ProjectDef { code: string; place: string; mgr: keyof typeof MGR; scenes: SceneDef[] }

const PROJECTS: ProjectDef[] = [
  {
    code: 'C88', place: 'Walnut Street', mgr: 'katerina',
    scenes: [
      { name: 'Kitchen (OWE 1 Round)', segFn: c88Scene(3, false) },
      { name: 'Garden Room',           segFn: c88Scene(2, true)  },
      { name: 'Dining Room',           segFn: c88Scene(2, true)  },
      { name: 'Entrance',              segFn: c88Scene(3, false) },
      { name: 'Drawing Room',          segFn: c88Scene(2, true)  },
    ],
  },
  {
    code: 'C101', place: 'Bleecker Street', mgr: 'fiodor',
    scenes: [
      { name: 'Facade A',  segFn: c101Scene(false) },
      { name: 'Facade B',  segFn: c101Scene(false) },
      { name: 'Facade C',  segFn: c101Scene(true)  },
      { name: 'Entrance',  segFn: c101Scene(true)  },
    ],
  },
  {
    code: 'C104', place: 'Ottawa', mgr: 'may',
    scenes: [
      { name: 'Goldenrod Driveway', segFn: c104Scene() },
      { name: 'Block 5 Courtyard', segFn: c104Scene() },
      { name: 'Boulevard Street',  segFn: c104Scene() },
      { name: 'River View',        segFn: c104Scene() },
      { name: 'Aerial',            segFn: c104Scene() },
    ],
  },
];

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

// ─── Scrollbar CSS ────────────────────────────────────────────────────────────
const SCROLLBAR_CSS = `
.gantt-scroll::-webkit-scrollbar { height: 8px; }
.gantt-scroll::-webkit-scrollbar-track { background: #0c0a08; border-radius: 6px; }
.gantt-scroll::-webkit-scrollbar-thumb { background: #2c2620; border-radius: 6px; border: 2px solid #0c0a08; }
.gantt-scroll::-webkit-scrollbar-thumb:hover { background: #3c352b; }
`;

// ─── Component ────────────────────────────────────────────────────────────────
interface ProductionGanttProps {
  productionColor?: string;
  feedbackColor?:   string;
  showPhaseLabels?: boolean;
}

export function ProductionGantt({
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

  return (
    <div
      style={{
        background: GANTT_CARD_BG,
        border: '1px solid rgba(197,165,114,0.13)',
        borderRadius: 16,
        overflow: 'hidden',
        marginTop: 28,
      }}
    >
      <div className="gantt-scroll" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ width: CONTENT_W }}>

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
              <div
                style={{
                  width: SCENE_COL_W,
                  paddingLeft: 34,
                  paddingBottom: 12,
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: "'Jost', sans-serif",
                  letterSpacing: '2.5px',
                  textTransform: 'uppercase',
                  color: '#8c8478',
                }}
              >
                Scene
              </div>
              <div
                style={{
                  width: MANAGER_COL_W,
                  paddingBottom: 12,
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: "'Jost', sans-serif",
                  letterSpacing: '2.5px',
                  textTransform: 'uppercase',
                  color: '#8c8478',
                }}
              >
                Manager
              </div>
            </div>

            {/* Day columns */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {DATES.map((d, i) => {
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
          {PROJECTS.map((proj) => {
            const mgr = MGR[proj.mgr];
            return (
              <div key={proj.code}>
                {/* Group header row */}
                <div style={{ display: 'flex', height: GROUP_H, background: GANTT_GROUP_BG }}>
                  {/* Frozen group header left */}
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
                    <span
                      style={{
                        fontFamily: "'Cormorant Garamond', serif",
                        fontSize: 16,
                        fontWeight: 600,
                        color: '#d8c39a',
                      }}
                    >
                      {proj.code}
                    </span>
                    <span
                      style={{
                        fontFamily: "'Cormorant Garamond', serif",
                        fontSize: 15,
                        fontWeight: 400,
                        color: '#a89c86',
                      }}
                    >
                      {proj.place}
                    </span>
                  </div>
                  {/* Track gradient divider */}
                  <div
                    style={{
                      width: TRACK_W,
                      height: GROUP_H,
                      padding: '0 24px',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        height: 1,
                        width: '100%',
                        background: 'linear-gradient(90deg, rgba(197,165,114,0.20), rgba(197,165,114,0))',
                      }}
                    />
                  </div>
                </div>

                {/* Scene rows */}
                {proj.scenes.map((scene) => {
                  const segs = scene.segFn(productionColor, feedbackColor, showPhaseLabels);
                  return (
                    <div key={scene.name} style={{ display: 'flex', height: SCENE_H }}>
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
                        <div
                          style={{
                            width: MANAGER_COL_W,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: mgr.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 500,
                              fontFamily: "'Jost', sans-serif",
                              letterSpacing: '1.5px',
                              textTransform: 'uppercase',
                              color: '#a89e8c',
                            }}
                          >
                            {mgr.name}
                          </span>
                        </div>
                      </div>

                      {/* Track lane */}
                      <div
                        style={{
                          width: TRACK_W,
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
            );
          })}

        </div>
      </div>
    </div>
  );
}
