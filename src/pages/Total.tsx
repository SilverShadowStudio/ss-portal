import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  isSameDay,
  addDays,
  isWeekend,
} from "date-fns";
import { Activity, FileText, X, Paperclip, ExternalLink, ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AdminLayout } from "@/components/AdminLayout";
import { ZoomScale } from "@/components/client/ZoomScale";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface ProjectRow {
  id: string;
  name: string;
}

interface SceneRow {
  id: string;
  name: string;
  project_id: string;
  status: string;
}

interface RoundRow {
  id: string;
  scene_id: string;
  round_number: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  instructions: string | null;
  kind: "production" | "review";
}

interface GroupedProject {
  project: ProjectRow;
  scenes: { scene: SceneRow; rounds: RoundRow[] }[];
}

interface InstructionsPopup {
  round: RoundRow;
  sceneName: string;
  x: number;
  y: number;
  uploads: { category: string; file_name: string; storage_path: string }[];
  loadingUploads: boolean;
}

/** Scene-card summary on the left rail — distilled from Index's pipeline logic. */
interface SceneCardData {
  id: string;
  name: string;
  projectName: string;
  projectId: string;
  /** 'in_production' | 'awaiting_review' | 'approved' */
  state: "in_production" | "awaiting_review" | "approved";
  currentRound: number;
  paidRounds: number;
  currentRoundStart: string | null;
  currentRoundEnd: string | null;
  /** Latest delivered round id for navigation (when awaiting review). */
  latestDeliveredRoundId?: string;
}

/** Fixed row height shared by Scenes rail card AND timeline scene row. */
const ROW_H = 96;
/** Project group header height — shared so scenes can vertically align. */
const GROUP_HEADER_H = 36;
/** Day-strip header height — shared so first scene row starts at same Y on both sides. */
const DAY_STRIP_H = 64;
/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function Total() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [visibleMonth, setVisibleMonth] = useState(format(new Date(), "MMMM yyyy"));
  const [grouped, setGrouped] = useState<GroupedProject[]>([]);
  const [sceneCards, setSceneCards] = useState<SceneCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialScrollDone = useRef(false);
  const [popup, setPopup] = useState<InstructionsPopup | null>(null);
  const dayWRef = useRef<number>(0);
  const timelineDaysLenRef = useRef<number>(0);
  const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);

  /* ------------------------------------------------------------------------ */
  /*  Data fetch — combines Timeline + Dashboard scene-summary queries        */
  /* ------------------------------------------------------------------------ */
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", user.id);
      if (!projects?.length) {
        setLoading(false);
        return;
      }

      const projectIds = projects.map((p) => p.id);
      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, name, project_id, status, current_round, paid_rounds")
        .in("project_id", projectIds);
      if (!scenes?.length) {
        setLoading(false);
        return;
      }

      const sceneIds = scenes.map((s) => s.id);
      const { data: rounds } = await supabase
        .from("scene_rounds")
        .select("id, scene_id, round_number, status, start_date, end_date, instructions, kind, delivered_at")
        .in("scene_id", sceneIds);

      /* ---- Timeline grouping (rounds with scheduled windows only) ------- */
      const timelineRounds = (rounds ?? []).filter(
        (r) => r.start_date && r.end_date,
      );

      const groups: Record<string, GroupedProject> = {};
      projects.forEach((p) => (groups[p.id] = { project: p, scenes: [] }));
      const sceneMap: Record<string, { scene: SceneRow; rounds: RoundRow[] }> = {};
      scenes.forEach((s) => {
        sceneMap[s.id] = {
          scene: { id: s.id, name: s.name, project_id: s.project_id, status: s.status },
          rounds: [],
        };
      });
      timelineRounds.forEach((r) => {
        if (sceneMap[r.scene_id]) sceneMap[r.scene_id].rounds.push(r as RoundRow);
      });
      Object.values(sceneMap).forEach((entry) => {
        if (entry.rounds.length > 0 && groups[entry.scene.project_id]) {
          groups[entry.scene.project_id].scenes.push(entry);
        }
      });
      setGrouped(
        Object.values(groups)
          .filter((g) => g.scenes.length > 0)
          .sort((a, b) => a.project.name.localeCompare(b.project.name)),
      );

      /* ---- Scene cards: derive effective status (mirrors Index logic) --- */
      const productionRounds = (rounds ?? []).filter((r) => r.kind === "production");
      const roundsByScene = new Map<string, any[]>();
      productionRounds.forEach((r) => {
        const list = roundsByScene.get(r.scene_id) ?? [];
        list.push(r);
        roundsByScene.set(r.scene_id, list);
      });

      const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

      const cards: SceneCardData[] = (scenes ?? [])
        .map((s): SceneCardData | null => {
          const sRounds = roundsByScene.get(s.id) ?? [];
          let state: SceneCardData["state"];
          if (s.status === "approved") state = "approved";
          else if (sRounds.some((r) => r.status === "delivered")) state = "awaiting_review";
          else if (sRounds.some((r) => r.status !== "delivered" && r.status !== "approved"))
            state = "in_production";
          else return null;

          const currentRoundData = sRounds.find((r) => r.round_number === s.current_round);
          const latestDelivered = sRounds
            .filter((r) => r.delivered_at)
            .sort((a, b) =>
              new Date(b.delivered_at).getTime() - new Date(a.delivered_at).getTime(),
            )[0];

          return {
            id: s.id,
            name: s.name,
            projectName: projectNameById.get(s.project_id) ?? "Project",
            projectId: s.project_id,
            state,
            currentRound: s.current_round,
            paidRounds: s.paid_rounds,
            currentRoundStart: currentRoundData?.start_date ?? null,
            currentRoundEnd: currentRoundData?.end_date ?? null,
            latestDeliveredRoundId: latestDelivered?.id,
          };
        })
        .filter((c): c is SceneCardData => c !== null)
        // Awaiting review first, then in production, then approved.
        .sort((a, b) => {
          const order = { awaiting_review: 0, in_production: 1, approved: 2 };
          return order[a.state] - order[b.state];
        });

      setSceneCards(cards);
      setLoading(false);
    })();
  }, [user]);

  /* Tick — drives now-line + live progress fills */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ------------------------------------------------------------------------ */
  /*  Timeline geometry — identical math to Timeline.tsx                      */
  /* ------------------------------------------------------------------------ */
  const timelineDays = useMemo(() => {
    const start = startOfMonth(subMonths(now, 12));
    const end = endOfMonth(addMonths(now, 12));
    const days: { date: Date; name: string; num: number; id: string }[] = [];
    let cur = start;
    while (cur <= end) {
      if (!isWeekend(cur)) {
        days.push({
          date: cur,
          name: format(cur, "EEE").toUpperCase(),
          num: cur.getDate(),
          id: format(cur, "yyyy-MM-dd"),
        });
      }
      cur = addDays(cur, 1);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dayToIndex = useMemo(() => {
    const m = new Map<string, number>();
    timelineDays.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [timelineDays]);

  /** Sidebar column inside timeline removed — labels live in left rail. */
  const SIDEBAR_W = 0;
  const DAY_W_MIN = 48;
  const DAY_W_MAX = 360;
  const DAY_W_DEFAULT = 96;
  const [DAY_W, setDayW] = useState<number>(DAY_W_DEFAULT);

  const nowPos = useMemo(() => {
    const idx = dayToIndex.get(format(now, "yyyy-MM-dd"));
    if (idx === undefined) return null;
    const progress = (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 1440;
    return SIDEBAR_W + (idx + progress) * DAY_W;
  }, [now, dayToIndex, DAY_W]);

  useEffect(() => {
    dayWRef.current = DAY_W;
  }, [DAY_W]);
  useEffect(() => {
    timelineDaysLenRef.current = timelineDays.length;
  }, [timelineDays.length]);

  const zoomAnchorRef = useRef<{ ratio: number; screenX: number } | null>(null);

  const captureZoomAnchor = useCallback(() => {
    const c = scrollRef.current;
    if (!c) return;
    const lanesWidth = timelineDays.length * DAY_W;
    if (lanesWidth <= 0) return;
    const viewLeft = c.scrollLeft;
    const viewRight = viewLeft + c.clientWidth;
    let focusContentX: number;
    let screenX: number;
    if (nowPos !== null && nowPos >= viewLeft + SIDEBAR_W && nowPos <= viewRight) {
      focusContentX = nowPos - SIDEBAR_W;
      screenX = nowPos - viewLeft;
    } else {
      const centerScreenX = c.clientWidth / 2;
      focusContentX = viewLeft + centerScreenX - SIDEBAR_W;
      screenX = centerScreenX;
    }
    const ratio = Math.max(0, Math.min(1, focusContentX / lanesWidth));
    zoomAnchorRef.current = { ratio, screenX };
  }, [nowPos, timelineDays.length, DAY_W]);

  useLayoutEffect(() => {
    const c = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!c || !anchor) return;
    const newLanesWidth = timelineDays.length * DAY_W;
    const newFocusContentX = anchor.ratio * newLanesWidth;
    const newScrollLeft = SIDEBAR_W + newFocusContentX - anchor.screenX;
    c.scrollLeft = Math.max(0, newScrollLeft);
    zoomAnchorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DAY_W]);

  const setZoom = useCallback(
    (next: number) => {
      const clamped = Math.max(DAY_W_MIN, Math.min(DAY_W_MAX, next));
      setDayW((prev) => {
        if (Math.abs(prev - clamped) < 0.5) return prev;
        captureZoomAnchor();
        return clamped;
      });
    },
    [captureZoomAnchor],
  );

  const dateToOffsetPx = (d: Date): number | null => {
    if (!d || isNaN(d.getTime())) return null;
    const id = format(d, "yyyy-MM-dd");
    const idx = dayToIndex.get(id);
    const fraction = (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) / 1440;
    if (idx !== undefined) return (idx + fraction) * DAY_W;
    let prev = addDays(d, -1);
    for (let i = 0; i < 7; i++) {
      const pid = format(prev, "yyyy-MM-dd");
      const pidx = dayToIndex.get(pid);
      if (pidx !== undefined) return (pidx + 1) * DAY_W;
      prev = addDays(prev, -1);
    }
    let next = addDays(d, 1);
    for (let i = 0; i < 7; i++) {
      const nid = format(next, "yyyy-MM-dd");
      const nidx = dayToIndex.get(nid);
      if (nidx !== undefined) return nidx * DAY_W;
      next = addDays(next, 1);
    }
    return null;
  };

  const scrollToNow = () => {
    if (!scrollRef.current || nowPos === null) return;
    const c = scrollRef.current;
    c.scrollTo({ left: nowPos - c.clientWidth / 2, behavior: "smooth" });
  };

  const monthRafRef = useRef<number | null>(null);
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onScroll = () => {
      if (monthRafRef.current !== null) return;
      monthRafRef.current = requestAnimationFrame(() => {
        monthRafRef.current = null;
        const dw = dayWRef.current;
        const len = timelineDaysLenRef.current;
        if (!dw || !len) return;
        const center = c.scrollLeft + c.clientWidth / 2;
        const idx = Math.floor((center - SIDEBAR_W) / dw);
        if (idx >= 0 && idx < len) {
          setVisibleMonth(format(timelineDays[idx].date, "MMMM yyyy"));
        }
      });
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      c.removeEventListener("scroll", onScroll);
      if (monthRafRef.current !== null) cancelAnimationFrame(monthRafRef.current);
    };
  }, [timelineDays]);

  useEffect(() => {
    if (!isInitialScrollDone.current && nowPos !== null && scrollRef.current) {
      scrollToNow();
      isInitialScrollDone.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPos]);

  const handleRoundClick = useCallback(
    async (e: React.MouseEvent, round: RoundRow, sceneName: string) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const newPopup: InstructionsPopup = {
        round,
        sceneName,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
        uploads: [],
        loadingUploads: true,
      };
      setPopup(newPopup);
      const { data } = await supabase
        .from("round_uploads")
        .select("category, file_name, storage_path")
        .eq("scene_id", round.scene_id);
      setPopup((prev) =>
        prev && prev.round.id === round.id
          ? { ...prev, uploads: data || [], loadingUploads: false }
          : prev,
      );
    },
    [],
  );

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: "Production",
      in_progress: "In production",
      client_review: "Awaiting review",
      revision: "In refinement",
      approved: "Completed",
      delivered: "Delivered",
    };
    return map[status] || status.replace(/_/g, " ");
  };

  const getRoundTemporal = (round: RoundRow): "past" | "current" | "future" => {
    if (!round.start_date || !round.end_date) return "future";
    const startTs = new Date(round.start_date).getTime();
    const endDay = new Date(round.end_date);
    if (round.kind !== "review") endDay.setHours(11, 0, 0, 0);
    const endTs = endDay.getTime();
    const nowTs = now.getTime();
    if (nowTs >= endTs) return "past";
    if (nowTs < startTs) return "future";
    return "current";
  };

  /* ------------------------------------------------------------------------ */
  /*  Render                                                                  */
  /* ------------------------------------------------------------------------ */

  return (
    <AdminLayout fullWidth>
      {/* Page header — matches Timeline / Dashboard editorial style */}
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-8 bg-gold-muted" />
          <span className="text-label-gold tracking-[0.1em]">Total</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl">
          OVERVIEW
        </h1>
        <p className="mt-3 text-sm tracking-[0.1em] uppercase text-muted-foreground">
          Scenes &amp; Production Lanes
        </p>
      </div>

      {/* Two-column split: scene cards rail + timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        {/* ===== LEFT: Scene cards ===== */}
        <ScenesRail
          loading={loading}
          cards={sceneCards}
          grouped={grouped}
          now={now}
          hoveredSceneId={hoveredSceneId}
          onHoverScene={setHoveredSceneId}
          rowH={ROW_H}
          groupHeaderH={GROUP_HEADER_H}
          dayStripH={DAY_STRIP_H}
          onOpenScene={(c) =>
            navigate("/portfolio", {
              state: {
                sceneId: c.id,
                projectId: c.projectId,
                roundId: c.latestDeliveredRoundId,
              },
            })
          }
        />

        {/* ===== RIGHT: Timeline ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden flex flex-col bg-card shadow-sm"
          style={{ borderRadius: 16, border: "0.5px solid hsl(var(--border))" }}
        >
          {/* Toolbar */}
          <header
            className="h-12 flex items-center px-6 shrink-0 bg-card"
            style={{ borderBottom: "0.5px solid hsl(var(--border))" }}
          >
            <div className="flex items-center gap-6 w-full">
              <button
                onClick={scrollToNow}
                className="px-4 py-1.5 bg-primary/15 border border-primary/40 rounded-full text-[10px] font-bold text-primary uppercase tracking-[0.18em] hover:bg-primary/25 hover:border-primary/60 transition-colors shadow-sm"
              >
                Now
              </button>
              <div className="h-4 bg-border/80" style={{ width: "0.5px" }} />
              <span className="text-[11px] font-semibold tracking-[0.12em] text-foreground/80 uppercase">
                {visibleMonth}
              </span>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[9px] font-bold tracking-[0.22em] uppercase text-muted-foreground/60 select-none">
                  Zoom
                </span>
                <ZoomScale value={DAY_W} min={DAY_W_MIN} max={DAY_W_MAX} onChange={setZoom} />
              </div>
            </div>
          </header>

          {/* Scrollable area */}
          <div className="relative">
            <div ref={scrollRef} className="overflow-x-auto scrollbar-thin">
              <div
                className="flex flex-col relative"
                style={{ minWidth: `${SIDEBAR_W + timelineDays.length * DAY_W}px` }}
              >
                {nowPos !== null && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20"
                    style={{ left: `${nowPos}px`, width: 0 }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 -translate-x-1/2 bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.35)]"
                      style={{ width: "0.5px" }}
                    />
                  </div>
                )}
                {/* Day headers */}
                <div
                  className="flex sticky top-0 z-40 bg-card backdrop-blur-sm"
                  style={{ borderBottom: "0.5px solid hsl(var(--border))" }}
                >
                  <div className="flex flex-1 relative">
                    {nowPos !== null && (
                      <div
                        className="pointer-events-none absolute bottom-0 -translate-x-1/2 z-50 px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold tracking-[0.15em] rounded-t shadow-lg whitespace-nowrap"
                        style={{ left: `${nowPos - SIDEBAR_W}px` }}
                      >
                        {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                      </div>
                    )}
                    {timelineDays.map((day) => (
                      <div
                        key={day.id}
                        className={`flex-1 flex flex-col items-center justify-center gap-0.5 ${
                          isSameDay(now, day.date) ? "bg-primary/5" : ""
                        }`}
                        style={{
                          minWidth: DAY_W,
                          height: DAY_STRIP_H,
                          borderRight: `0.5px solid hsl(var(--border) / ${
                            day.date.getDay() === 5 ? "0.5" : "0.05"
                          })`,
                        }}
                      >
                        <span
                          className={`text-[9px] font-bold tracking-[0.18em] uppercase ${
                            isSameDay(now, day.date) ? "text-primary/80" : "text-muted-foreground/70"
                          }`}
                        >
                          {day.name}
                        </span>
                        <span
                          className={`text-base font-medium tabular-nums ${
                            isSameDay(now, day.date) ? "text-primary font-bold" : "text-foreground/90"
                          }`}
                        >
                          {day.num}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Content */}
                {loading ? (
                  <div className="py-32 flex items-center justify-center">
                    <BrandLoader size="lg" />
                  </div>
                ) : grouped.length === 0 ? (
                  <div
                    className="relative opacity-30"
                    style={{ borderBottom: "0.5px solid hsl(var(--border))", height: 240 }}
                  >
                    {nowPos !== null ? (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-full pr-6 text-right flex flex-col items-end"
                        style={{ left: `${nowPos - 2 * DAY_W}px`, maxWidth: 320 }}
                      >
                        <Activity size={28} className="text-primary mb-5" />
                        <h3 className="font-serif text-base text-foreground">No active production lanes</h3>
                        <p className="mt-1 text-xs tracking-[0.1em] uppercase text-muted-foreground">
                          Scheduled rounds appear here automatically
                        </p>
                      </div>
                    ) : (
                      <div className="py-32 text-center flex flex-col items-center">
                        <Activity size={28} className="text-primary mb-5" />
                        <h3 className="font-serif text-base text-foreground">No active production lanes</h3>
                        <p className="mt-1 text-xs tracking-[0.1em] uppercase text-muted-foreground">
                          Scheduled rounds appear here automatically
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.project.id} className="contents">
                      <div
                        className="flex bg-muted/20"
                        style={{
                          borderBottom: "0.5px solid hsl(var(--border))",
                          height: GROUP_HEADER_H,
                        }}
                      >
                        <div className="flex-1 flex relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-[10px] font-bold text-primary uppercase tracking-[0.22em] truncate pr-4 bg-muted/0">
                            {group.project.name}
                          </span>
                          {timelineDays.map((d) => (
                            <div
                              key={d.id}
                              className="flex-1"
                              style={{
                                minWidth: DAY_W,
                                borderRight: `0.5px solid hsl(var(--border) / ${
                                  d.date.getDay() === 5 ? "0.4" : "0.05"
                                })`,
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      {group.scenes.map(({ scene, rounds }) => (
                        <div
                          key={scene.id}
                          data-scene-id={scene.id}
                          onMouseEnter={() => setHoveredSceneId(scene.id)}
                          onMouseLeave={() => setHoveredSceneId((cur) => (cur === scene.id ? null : cur))}
                          className={`flex transition-colors ${
                            hoveredSceneId === scene.id ? "bg-foreground/[0.03]" : "hover:bg-foreground/[0.02]"
                          }`}
                          style={{ borderBottom: "0.5px solid hsl(var(--border))", height: ROW_H }}
                        >
                          <div className="flex-1 flex relative h-full">
                            {timelineDays.map((d) => (
                              <div
                                key={d.id}
                                className="flex-1 relative"
                                style={{
                                  minWidth: DAY_W,
                                  borderRight: `0.5px solid hsl(var(--border) / ${
                                    d.date.getDay() === 5 ? "0.4" : "0.05"
                                  })`,
                                  backgroundImage: [
                                    "linear-gradient(to right, transparent calc(25% - 1px), hsl(var(--border) / 0.05) calc(25% - 1px), hsl(var(--border) / 0.05) 25%, transparent 25%)",
                                    "linear-gradient(to right, transparent calc(50% - 1px), hsl(var(--border) / 0.1) calc(50% - 1px), hsl(var(--border) / 0.1) 50%, transparent 50%)",
                                    "linear-gradient(to right, transparent calc(75% - 1px), hsl(var(--border) / 0.05) calc(75% - 1px), hsl(var(--border) / 0.05) 75%, transparent 75%)",
                                  ].join(", "),
                                }}
                              />
                            ))}
                            {rounds.map((round) => {
                              if (!round.start_date || !round.end_date) return null;
                              const startDate = new Date(round.start_date);
                              const rawEnd = new Date(round.end_date);
                              if (isNaN(startDate.getTime()) || isNaN(rawEnd.getTime())) return null;
                              const endDate =
                                round.kind === "review"
                                  ? rawEnd
                                  : (() => {
                                      const d = new Date(rawEnd);
                                      d.setHours(11, 0, 0, 0);
                                      return d;
                                    })();
                              if (endDate.getTime() <= startDate.getTime()) return null;

                              const startPx = dateToOffsetPx(startDate);
                              const endPx = dateToOffsetPx(endDate);
                              if (startPx === null || endPx === null || endPx <= startPx) return null;

                              const barLeftPx = startPx;
                              const barWidthPx = endPx - startPx;
                              const totalLanesPx = timelineDays.length * DAY_W;
                              const leftPct = (barLeftPx / totalLanesPx) * 100;
                              const widthPct = (barWidthPx / totalLanesPx) * 100;

                              const temporal = getRoundTemporal(round);
                              const nowOffsetWithinLanes = nowPos !== null ? nowPos - SIDEBAR_W : null;
                              let fillPx = 0;
                              if (temporal === "past") {
                                fillPx = barWidthPx;
                              } else if (temporal === "current" && nowOffsetWithinLanes !== null) {
                                fillPx = Math.max(
                                  0,
                                  Math.min(barWidthPx, nowOffsetWithinLanes - barLeftPx),
                                );
                              }
                              const isReview = round.kind === "review";
                              const blockClasses = temporal === "past"
                                ? "bg-muted/40 border-border/70 opacity-50"
                                : temporal === "current"
                                  ? "bg-secondary border-gold/50 shadow-md"
                                  : "bg-card/60 border-border border-dashed opacity-90";
                              return (
                                <div
                                  key={round.id}
                                  onClick={(e) => handleRoundClick(e, round, scene.name)}
                                  className={`absolute inset-y-3 rounded-lg z-10 overflow-hidden cursor-pointer hover:border-primary/70 transition-all border ${blockClasses}`}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                >
                                  {temporal === "current" && (
                                    <>
                                      <div
                                        className={`absolute inset-y-0 left-0 ${
                                          "bg-[#1C1A17]"
                                        }`}
                                        style={{ width: `${fillPx}px` }}
                                      />
                                      <div
                                        className={`absolute inset-y-0 w-px ${
                                          "bg-gold/60"
                                        }`}
                                        style={{ left: `${fillPx - 0.5}px` }}
                                      />
                                    </>
                                  )}
                                  <div
                                    className={`absolute inset-y-0 left-0 w-px ${
                                      temporal === "past"
                                        ? "bg-border"
                                        : isReview
                                          ? "bg-gold/60"
                                          : "bg-gold/50"
                                    }`}
                                  />
                                  <div
                                    className={`absolute inset-y-0 right-0 w-px ${
                                      temporal === "past"
                                        ? "bg-border"
                                        : temporal === "current"
                                          ? isReview
                                            ? "bg-gold/50"
                                            : "bg-gold/40"
                                          : "bg-border/80"
                                    }`}
                                  />
                                  <div className="relative px-3 py-2.5 h-full flex flex-col justify-center gap-0.5">
                                    <div className="flex items-center gap-2">
                                      {temporal === "current" && (
                                        <div
                                          className={`h-1.5 w-1.5 rounded-full shrink-0 animate-pulse ${
                                            "bg-gold"
                                          }`}
                                        />
                                      )}
                                      <p
                                        className={`text-[11px] font-bold truncate uppercase tracking-wide ${
                                          temporal === "past" ? "text-muted-foreground" : "text-foreground"
                                        }`}
                                      >
                                        {scene.name}
                                      </p>
                                    </div>
                                    <p
                                      className={`text-[10px] truncate tracking-[0.05em] font-medium ${
                                        temporal === "past"
                                          ? "text-muted-foreground/60"
                                          : temporal === "current"
                                            ? "text-foreground/80"
                                            : "text-muted-foreground"
                                      }`}
                                    >
                                      Round {round.round_number.toString().padStart(2, "0")} ·{" "}
                                      {isReview ? "Review" : statusLabel(round.status)}
                                    </p>
                                    {round.instructions && (
                                      <FileText
                                        size={9}
                                        className="absolute bottom-2 right-2.5 text-muted-foreground/40"
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Instructions Popup — identical to Timeline */}
      <AnimatePresence>
        {popup && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPopup(null)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="fixed z-[70] w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden"
              style={{
                left: Math.min(popup.x - 160, window.innerWidth - 340),
                top: Math.min(popup.y, window.innerHeight - 300),
              }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <FileText size={12} className="text-primary" />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Round {popup.round.round_number.toString().padStart(2, "0")} — Instructions
                  </span>
                </div>
                <button
                  onClick={() => setPopup(null)}
                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="px-4 py-3 max-h-80 overflow-y-auto">
                <p className="text-[10px] font-medium text-primary/60 uppercase tracking-widest mb-1">
                  {popup.sceneName}
                </p>
                {popup.round.instructions ? (
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {popup.round.instructions}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No instructions provided for this round.
                  </p>
                )}

                {popup.loadingUploads ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <BrandLoader size="sm" className="h-3 w-3" />
                    Loading files…
                  </div>
                ) : popup.uploads.length > 0 ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Paperclip size={10} className="text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Attachments
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {popup.uploads.map((file, i) => {
                        const { data: urlData } = supabase.storage
                          .from("round-uploads")
                          .getPublicUrl(file.storage_path);
                        const categoryLabel = file.category.replace(/_/g, " ");
                        return (
                          <a
                            key={i}
                            href={urlData.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                          >
                            <span className="text-[9px] font-bold text-primary/40 uppercase tracking-wider w-16 shrink-0 truncate">
                              {categoryLabel}
                            </span>
                            <span className="truncate flex-1">{file.file_name}</span>
                            <ExternalLink
                              size={10}
                              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scenes rail — left column                                                 */
/* -------------------------------------------------------------------------- */

function ScenesRail({
  loading,
  cards,
  grouped,
  now,
  hoveredSceneId,
  onHoverScene,
  rowH,
  groupHeaderH,
  dayStripH,
  onOpenScene,
}: {
  loading: boolean;
  cards: SceneCardData[];
  grouped: GroupedProject[];
  now: Date;
  hoveredSceneId: string | null;
  onHoverScene: (id: string | null) => void;
  rowH: number;
  groupHeaderH: number;
  dayStripH: number;
  onOpenScene: (c: SceneCardData) => void;
}) {
  const reviewCount = cards.filter((c) => c.state === "awaiting_review").length;
  const cardById = useMemo(() => {
    const m = new Map<string, SceneCardData>();
    cards.forEach((c) => m.set(c.id, c));
    return m;
  }, [cards]);

  return (
    <div
      className="bg-card shadow-sm flex flex-col"
      style={{ borderRadius: 16, border: "0.5px solid hsl(var(--border))" }}
    >
      {/* Header — mirrors timeline toolbar height for visual symmetry */}
      <header
        className="h-12 flex items-center px-6 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--border))" }}
      >
        <div className="flex items-center gap-3 w-full">
          <div className="h-px w-6 bg-gold-muted" />
          <span className="text-[10px] font-bold text-foreground/80 uppercase tracking-[0.22em]">
            Scenes
          </span>
          {reviewCount > 0 && (
            <span className="ml-auto text-[10px] tracking-[0.1em] text-gold">
              {reviewCount} {reviewCount === 1 ? "TO REVIEW" : "TO REVIEW"}
            </span>
          )}
        </div>
      </header>

      {/* Day-headers spacer — matches timeline date-strip height (py-5 + content ≈ 58px). */}
      <div
        className="shrink-0"
        style={{ height: dayStripH, borderBottom: "0.5px solid hsl(var(--border))" }}
      />

      <div>
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <BrandLoader size="md" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center opacity-30">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground mx-auto mb-3" />
            <p className="font-serif text-sm text-muted-foreground">No active scenes</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.project.id}>
              {/* Project group header — same height as timeline group header */}
              <div
                className="flex items-center px-5 bg-muted/20"
                style={{ height: groupHeaderH, borderBottom: "0.5px solid hsl(var(--border))" }}
              >
                <span className="text-[10px] font-bold text-primary uppercase tracking-[0.22em] truncate">
                  {group.project.name}
                </span>
              </div>
              {group.scenes.map(({ scene }) => {
                const card = cardById.get(scene.id);
                return (
                  <div
                    key={scene.id}
                    onMouseEnter={() => onHoverScene(scene.id)}
                    onMouseLeave={() =>
                      onHoverScene(hoveredSceneId === scene.id ? null : hoveredSceneId)
                    }
                    className={`transition-colors ${
                      hoveredSceneId === scene.id ? "bg-foreground/[0.03]" : ""
                    }`}
                    style={{ height: rowH, borderBottom: "0.5px solid hsl(var(--border))" }}
                  >
                    {card ? (
                      <SceneCard card={card} now={now} onOpen={onOpenScene} />
                    ) : (
                      <SceneRowMinimal scene={scene} />
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SceneRowMinimal({ scene }: { scene: SceneRow }) {
  return (
    <div className="h-full px-5 flex items-center">
      <span className="font-serif text-sm uppercase tracking-[0.1em] text-muted-foreground/70 truncate">
        {scene.name}
      </span>
    </div>
  );
}

function SceneCard({
  card,
  now,
  onOpen,
}: {
  card: SceneCardData;
  now: Date;
  onOpen: (c: SceneCardData) => void;
}) {
  // Live progress for in-production; full bar for awaiting review/approved.
  let progress = 0;
  if (card.state === "approved") progress = 100;
  else if (card.state === "awaiting_review") progress = 100;
  else if (card.currentRoundStart && card.currentRoundEnd) {
    const start = new Date(card.currentRoundStart);
    const end = new Date(card.currentRoundEnd);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end.getTime() > start.getTime()) {
      if (now <= start) progress = 0;
      else if (now >= end) progress = 100;
      else {
        const total = end.getTime() - start.getTime();
        const elapsed = now.getTime() - start.getTime();
        progress = Math.min(100, Math.max(0, (elapsed / total) * 100));
      }
    }
  }

  const stateMeta =
    card.state === "awaiting_review"
      ? { label: "Review", tone: "text-gold", dot: "bg-gold animate-pulse-gold", bar: "bg-gold" }
      : card.state === "approved"
        ? { label: "Approved", tone: "text-muted-foreground/60", dot: "bg-muted-foreground/40", bar: "bg-muted-foreground/40" }
        : { label: "In Production", tone: "text-foreground", dot: "bg-gold", bar: "bg-gold" };

  const readyOn =
    card.state === "in_production" && card.currentRoundEnd
      ? (() => {
          const d = new Date(card.currentRoundEnd);
          if (isNaN(d.getTime())) return null;
          return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        })()
      : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group w-full h-full text-left px-5 py-3 flex flex-col justify-center overflow-hidden transition-colors hover:bg-foreground/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/40 focus-visible:ring-inset"
    >
      {/* Top: project name + status dot */}
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${stateMeta.dot}`} />
        <h3 className="font-serif text-[13px] uppercase tracking-[0.1em] text-foreground group-hover:text-gold transition-colors leading-tight truncate">
          {card.name}
        </h3>
      </div>

      {/* Progress line */}
      <div className="relative flex items-center mb-2">
        <div className="absolute inset-x-0 h-px bg-border/80" />
        <div
          className={`absolute left-0 h-px transition-all duration-700 ease-out ${stateMeta.bar}`}
          style={{ width: `${progress}%` }}
        />
        <div className="absolute transition-all duration-700 ease-out" style={{ left: `${progress}%` }}>
          <div className={`h-[7px] w-[7px] -translate-x-1/2 rounded-full border ${
            card.state === "approved" ? "border-muted-foreground/40 bg-card" : "border-gold bg-card"
          }`} />
        </div>
        <div className="h-3" />
      </div>

      {/* Footer meta */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-serif text-xs tabular-nums text-muted-foreground">
            R{card.currentRound.toString().padStart(2, "0")}
            <span className="opacity-40"> / {card.paidRounds.toString().padStart(2, "0")}</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className={`text-[10px] uppercase tracking-[0.1em] truncate ${stateMeta.tone}`}>
            {stateMeta.label}
          </span>
        </div>
        {readyOn ? (
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground shrink-0 inline-flex items-center gap-1.5">
            <Clock className="h-3 w-3" strokeWidth={1.5} />
            {readyOn}
          </span>
        ) : card.state === "awaiting_review" ? (
          <span className="text-[10px] uppercase tracking-[0.1em] text-gold shrink-0 inline-flex items-center gap-1.5">
            View
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </span>
        ) : null}
      </div>
    </button>
  );
}