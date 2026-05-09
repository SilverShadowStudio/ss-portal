import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { Activity, FileText, Paperclip, ExternalLink, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { ZoomScale } from "@/components/client/ZoomScale";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProjectRow {
  id: string;
  name: string;
  user_id: string;
  account_id: string | null;
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

interface ClientGroup {
  clientId: string;
  clientName: string;
  projects: {
    project: ProjectRow;
    scenes: { scene: SceneRow; rounds: RoundRow[] }[];
  }[];
}

interface InstructionsPopup {
  round: RoundRow;
  sceneName: string;
  x: number;
  y: number;
  uploads: { category: string; file_name: string; storage_path: string }[];
  loadingUploads: boolean;
}

function SortableSceneRow({
  scene,
  onOpenScene,
  sidebarW,
  children,
}: {
  scene: SceneRow;
  onOpenScene: () => void;
  sidebarW: number;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scene.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 30 : "auto",
    position: "relative",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex border-b border-border hover:bg-muted/15 transition-colors"
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenScene}
              {...attributes}
              {...listeners}
              className="group/scene shrink-0 border-r border-border px-5 flex items-center justify-center text-center sticky left-0 z-[55] bg-card cursor-grab active:cursor-grabbing transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-gold/40 relative touch-none"
              style={{ width: sidebarW }}
              aria-label={`Open scene ${scene.name}`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gold/0 transition-colors group-hover/scene:bg-gold/40 group-focus-visible/scene:bg-gold/40"
              />
              <p className="text-[11px] font-bold text-foreground/85 group-hover/scene:text-foreground line-clamp-2 uppercase tracking-[0.08em] leading-snug transition-colors">
                {scene.name}
              </p>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="font-semibold">{scene.name}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Click to open · Long-press to drag
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {children}
    </div>
  );
}

export default function AdminTimeline() {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [visibleMonth, setVisibleMonth] = useState(format(new Date(), "MMMM yyyy"));
  const [grouped, setGrouped] = useState<ClientGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialScrollDone = useRef(false);
  const [popup, setPopup] = useState<InstructionsPopup | null>(null);
  const dayWRef = useRef<number>(0);
  const timelineDaysLenRef = useRef<number>(0);

  // ---- Pending lane task requests ----
  interface AttachmentRef {
    name: string;
    path: string;
    size?: number;
    type?: string;
  }
  interface PendingRequest {
    id: string;
    account_id: string;
    title: string;
    description: string | null;
    project_id: string | null;
    project_name: string | null;
    client_name: string;
    requested_delivery_date: string | null;
    created_at: string;
    attachments: AttachmentRef[];
  }
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [validating, setValidating] = useState<PendingRequest | null>(null);
  const [validateForm, setValidateForm] = useState({
    laneIndex: 1,
    startDate: format(new Date(), "yyyy-MM-dd"),
    durationDays: 3,
  });

  const loadPendingRequests = useCallback(async () => {
    const { data: rows } = await supabase
      .from("lane_tasks")
      .select("id, account_id, title, description, project_id, requested_delivery_date, created_at, attachments")
      .is("lane_index", null)
      .order("created_at", { ascending: true });
    if (!rows?.length) {
      setPendingRequests([]);
      return;
    }
    const accIds = Array.from(new Set(rows.map((r) => r.account_id)));
    const projIds = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean) as string[]));
    const [{ data: accs }, { data: projs }] = await Promise.all([
      supabase.from("accounts").select("id, company_name").in("id", accIds),
      projIds.length
        ? supabase.from("projects").select("id, name").in("id", projIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const accMap = new Map((accs ?? []).map((a) => [a.id, a.company_name]));
    const projMap = new Map((projs ?? []).map((p) => [p.id, p.name]));
    setPendingRequests(
      rows.map((r: any) => ({
        ...r,
        client_name: accMap.get(r.account_id) ?? "Unknown",
        project_name: r.project_id ? projMap.get(r.project_id) ?? null : null,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
      })),
    );
  }, []);

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("scene-assets")
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  useEffect(() => {
    loadPendingRequests();
  }, [loadPendingRequests]);

  const validateRequest = async () => {
    if (!validating) return;
    const { error } = await supabase
      .from("lane_tasks")
      .update({
        lane_index: validateForm.laneIndex,
        position: 0,
        start_date: validateForm.startDate,
        duration_days: validateForm.durationDays,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .eq("id", validating.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Request validated and scheduled");
    setValidating(null);
    loadPendingRequests();
  };

  const declineRequest = async (id: string) => {
    const { error } = await supabase
      .from("lane_tasks")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Request declined");
    loadPendingRequests();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const handleSceneDragEnd = useCallback(async (
    clientId: string,
    projectId: string,
    ev: DragEndEvent,
  ) => {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    let updatedScenes: { scene: SceneRow; rounds: RoundRow[] }[] = [];
    setGrouped((prev) =>
      prev.map((c) => {
        if (c.clientId !== clientId) return c;
        return {
          ...c,
          projects: c.projects.map((g) => {
            if (g.project.id !== projectId) return g;
            const ids = g.scenes.map((s) => s.scene.id);
            const oldIdx = ids.indexOf(active.id as string);
            const newIdx = ids.indexOf(over.id as string);
            if (oldIdx < 0 || newIdx < 0) return g;
            const reordered = arrayMove(g.scenes, oldIdx, newIdx);
            updatedScenes = reordered;
            return { ...g, scenes: reordered };
          }),
        };
      }),
    );
    if (!updatedScenes.length) return;
    try {
      await Promise.all(
        updatedScenes.map((entry, i) =>
          supabase.from("scenes").update({ sort_order: i }).eq("id", entry.scene.id),
        ),
      );
    } catch (err) {
      console.error("Failed to persist scene order", err);
      toast.error("Couldn't save new order");
    }
  }, []);

  // Fetch — admin scope: all clients' projects with rounds
  useEffect(() => {
    (async () => {
      // Use the same source of truth as the Clients page: accounts table
      // (company_name) filtered to non-admin owners.
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, company_name, owner_user_id");
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const adminIds = new Set((adminRoles ?? []).map((r) => r.user_id));
      const accountMap = new Map(
        (accounts ?? [])
          .filter((a) => !adminIds.has(a.owner_user_id))
          .map((a) => [a.id, a.company_name || "Unknown Client"])
      );

      const { data: projects } = await supabase
        .from("projects")
        .select("id, name, user_id, account_id")
        .is("archived_at", null);
      if (!projects?.length) {
        setLoading(false);
        return;
      }

      const projectIds = projects.map((p) => p.id);
      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, name, project_id, status, sort_order")
        .in("project_id", projectIds)
        .order("sort_order", { ascending: true });
      if (!scenes?.length) {
        setLoading(false);
        return;
      }

      const sceneIds = scenes.map((s) => s.id);
      const { data: rounds } = await supabase
        .from("scene_rounds")
        .select("id, scene_id, round_number, status, start_date, end_date, instructions, kind")
        .in("scene_id", sceneIds)
        .not("start_date", "is", null)
        .not("end_date", "is", null);

      // Build scene→rounds map
      const sceneMap: Record<string, { scene: SceneRow; rounds: RoundRow[] }> = {};
      scenes.forEach((s) => {
        sceneMap[s.id] = { scene: s as SceneRow, rounds: [] };
      });
      (rounds ?? []).forEach((r) => {
        if (sceneMap[r.scene_id]) sceneMap[r.scene_id].rounds.push(r as RoundRow);
      });

      // Build project→scenes map (only scenes with rounds)
      const projectScenes = new Map<string, { scene: SceneRow; rounds: RoundRow[] }[]>();
      Object.values(sceneMap).forEach((entry) => {
        if (entry.rounds.length > 0) {
          const arr = projectScenes.get(entry.scene.project_id) || [];
          arr.push(entry);
          projectScenes.set(entry.scene.project_id, arr);
        }
      });

      // Build client→projects (only projects with scenes that have rounds).
      // Group by account_id so the list mirrors the Clients page exactly,
      // and skip projects belonging to admin-owned (internal) accounts.
      const clientGroups = new Map<string, ClientGroup>();
      projects.forEach((p) => {
        const ps = projectScenes.get(p.id);
        if (!ps || ps.length === 0) return;
        if (!p.account_id || !accountMap.has(p.account_id)) return;
        const clientName = accountMap.get(p.account_id)!;
        const existing = clientGroups.get(p.account_id) || {
          clientId: p.account_id,
          clientName,
          projects: [],
        };
        existing.projects.push({ project: p as ProjectRow, scenes: ps });
        clientGroups.set(p.account_id, existing);
      });

      const groupedList = Array.from(clientGroups.values())
        .map((c) => ({
          ...c,
          projects: c.projects.sort((a, b) => a.project.name.localeCompare(b.project.name)),
        }))
        .sort((a, b) => a.clientName.localeCompare(b.clientName));

      setGrouped(groupedList);
      setLoading(false);
    })();
  }, []);

  // Tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Working days (no weekends) over 24 months
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
  }, []);

  const dayToIndex = useMemo(() => {
    const m = new Map<string, number>();
    timelineDays.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [timelineDays]);

  const SIDEBAR_W = 200;
  const DAY_W_MIN = 48;
  const DAY_W_MAX = 360;
  const DAY_W_DEFAULT = 120;
  const [DAY_W, setDayW] = useState<number>(DAY_W_DEFAULT);

  const nowPos = useMemo(() => {
    const idx = dayToIndex.get(format(now, "yyyy-MM-dd"));
    if (idx === undefined) return null;
    const progress = (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 1440;
    return SIDEBAR_W + (idx + progress) * DAY_W;
  }, [now, dayToIndex, timelineDays]);

  useEffect(() => { dayWRef.current = DAY_W; }, [DAY_W]);
  useEffect(() => { timelineDaysLenRef.current = timelineDays.length; }, [timelineDays.length]);

  // Zoom anchor
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
      focusContentX = (viewLeft + centerScreenX) - SIDEBAR_W;
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

  const setZoom = useCallback((next: number) => {
    const clamped = Math.max(DAY_W_MIN, Math.min(DAY_W_MAX, next));
    setDayW((prev) => {
      if (Math.abs(prev - clamped) < 0.5) return prev;
      captureZoomAnchor();
      return clamped;
    });
  }, [captureZoomAnchor]);

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
    let nxt = addDays(d, 1);
    for (let i = 0; i < 7; i++) {
      const nid = format(nxt, "yyyy-MM-dd");
      const nidx = dayToIndex.get(nid);
      if (nidx !== undefined) return nidx * DAY_W;
      nxt = addDays(nxt, 1);
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
  }, [nowPos]);

  const handleRoundHover = useCallback(async (e: React.MouseEvent, round: RoundRow, sceneName: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const newPopup: InstructionsPopup = {
      round, sceneName,
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
        : prev
    );
  }, []);

  const handleRoundClick = useCallback((e: React.MouseEvent, round: RoundRow, scene: SceneRow) => {
    e.stopPropagation();
    setPopup(null);
    navigate("/admin/projects", {
      state: {
        sceneId: scene.id,
        projectId: scene.project_id,
        roundId: round.id,
      },
    });
  }, [navigate]);

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
    if (round.kind !== "review") {
      endDay.setHours(11, 0, 0, 0);
    }
    const endTs = endDay.getTime();
    const nowTs = now.getTime();
    if (nowTs >= endTs) return "past";
    if (nowTs < startTs) return "future";
    return "current";
  };

  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-8 bg-gold" />
          <span className="text-label-gold">Studio Timeline</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          PRODUCTION LANES
        </h1>
        <p className="text-sm text-muted-foreground">
          Live production schedule across all clients and projects.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border bg-card overflow-hidden flex flex-col shadow-sm"
      >
        {/* Toolbar */}
        <header className="h-12 border-b border-border flex items-center px-6 shrink-0 bg-card">
          <div className="flex items-center gap-6 w-full">
            <button
              onClick={scrollToNow}
              className="px-4 py-1.5 bg-gold/15 border border-gold/40 rounded-full text-[10px] font-bold text-gold uppercase tracking-[0.18em] hover:bg-gold/25 hover:border-gold/60 transition-colors shadow-sm"
            >
              Now
            </button>
            <div className="h-4 w-px bg-border/80" />
            <span className="text-[11px] font-semibold tracking-[0.12em] text-foreground/80 uppercase">{visibleMonth}</span>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[9px] font-bold tracking-[0.22em] uppercase text-muted-foreground/60 select-none">Zoom</span>
              <ZoomScale
                value={DAY_W}
                min={DAY_W_MIN}
                max={DAY_W_MAX}
                onChange={setZoom}
              />
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
              {/* Now indicator */}
              {nowPos !== null && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20"
                  style={{ left: `${nowPos}px`, width: 0 }}
                >
                  <div className="absolute inset-y-0 left-0 w-[1.5px] -translate-x-1/2 bg-gold shadow-[0_0_8px_hsl(var(--gold)/0.35)]" />
                </div>
              )}

              {/* Day headers */}
              <div className="flex border-b border-border sticky top-0 z-40 bg-card backdrop-blur-sm">
                <div className="shrink-0 border-r border-border sticky left-0 z-[55] bg-card" style={{ width: SIDEBAR_W }} />
                <div className="flex flex-1 relative">
                  {nowPos !== null && (
                    <div
                      className="pointer-events-none absolute bottom-0 -translate-x-1/2 z-50 px-1.5 py-0.5 bg-gold text-primary-foreground text-[10px] font-bold tracking-[0.15em] rounded-t shadow-lg whitespace-nowrap"
                      style={{ left: `${nowPos - SIDEBAR_W}px` }}
                    >
                      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  )}
                  {timelineDays.map((day) => (
                    <div
                      key={day.id}
                      className={`flex-1 py-3 border-r flex flex-col items-center justify-center gap-0.5 ${
                        day.date.getDay() === 5 ? "border-foreground/40" : "border-border"
                      } ${isSameDay(now, day.date) ? "bg-gold/5" : ""}`}
                      style={{ minWidth: DAY_W }}
                    >
                      <span className={`text-[9px] font-bold tracking-[0.18em] uppercase ${isSameDay(now, day.date) ? "text-gold/80" : "text-muted-foreground/70"}`}>{day.name}</span>
                      <span className={`text-base font-medium tabular-nums ${isSameDay(now, day.date) ? "text-gold font-bold" : "text-foreground/90"}`}>{day.num}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Content */}
              {loading ? (
                <div className="py-32 flex items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                </div>
              ) : grouped.length === 0 ? (
                <div className="relative border-b border-border" style={{ height: 240 }}>
                  {nowPos !== null ? (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-full pr-6 text-right flex flex-col items-end"
                      style={{ left: `${nowPos - 2 * DAY_W}px`, maxWidth: 320 }}
                    >
                      <Activity size={32} className="text-gold mb-6 opacity-40" />
                      <h3 className="text-lg font-medium text-foreground">No active production lanes</h3>
                      <p className="text-sm text-muted-foreground">Scheduled rounds appear here automatically.</p>
                    </div>
                  ) : (
                    <div className="py-32 text-center flex flex-col items-center">
                      <Activity size={32} className="text-gold mb-6 opacity-40" />
                      <h3 className="text-lg font-medium text-foreground">No active production lanes</h3>
                      <p className="text-sm text-muted-foreground">Scheduled rounds appear here automatically.</p>
                    </div>
                  )}
                </div>
              ) : (
                grouped.map((client) => (
                  <div key={client.clientId} className="contents">
                    {/* Client header row */}
                    <div className="flex border-b border-border bg-gold/10 sticky top-0 z-30">
                      <div
                        className="shrink-0 border-r border-border px-5 py-3 flex items-center justify-center text-center sticky left-0 z-[55] bg-card"
                        style={{ width: SIDEBAR_W }}
                      >
                        <span className="text-[10px] font-bold text-gold uppercase tracking-[0.22em] truncate">
                          {client.clientName}
                        </span>
                      </div>
                      <div className="flex-1 flex h-9">
                        {timelineDays.map((d) => (
                          <div
                            key={d.id}
                            className={`flex-1 border-r ${d.date.getDay() === 5 ? "border-border" : "border-border/60"}`}
                            style={{ minWidth: DAY_W }}
                          />
                        ))}
                      </div>
                    </div>

                    {client.projects.map((group) => (
                      <div key={group.project.id} className="contents">
                        {/* Project header row */}
                        <div className="flex border-b border-border bg-muted/30">
                          <div
                            className="shrink-0 border-r border-border px-5 py-3 flex items-center justify-center text-center sticky left-0 z-[55] bg-card"
                            style={{ width: SIDEBAR_W }}
                          >
                            <span className="text-[10px] font-bold text-foreground uppercase tracking-[0.22em] truncate">
                              {group.project.name}
                            </span>
                          </div>
                          <div className="flex-1 flex h-9">
                            {timelineDays.map((d) => (
                              <div
                                key={d.id}
                                className={`flex-1 border-r ${d.date.getDay() === 5 ? "border-border" : "border-border/60"}`}
                                style={{ minWidth: DAY_W }}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Scene rows */}
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(ev) => handleSceneDragEnd(client.clientId, group.project.id, ev)}
                        >
                          <SortableContext
                            items={group.scenes.map((s) => s.scene.id)}
                            strategy={verticalListSortingStrategy}
                          >
                        {group.scenes.map(({ scene, rounds }) => (
                          <SortableSceneRow
                            key={scene.id}
                            scene={scene}
                            sidebarW={SIDEBAR_W}
                            onOpenScene={() =>
                              navigate("/admin/projects", {
                                state: { sceneId: scene.id, projectId: scene.project_id },
                              })
                            }
                          >
                            <div className="flex-1 flex relative h-24">
                              {timelineDays.map((d) => (
                                <div
                                  key={d.id}
                                  className={`flex-1 border-r relative ${d.date.getDay() === 5 ? "border-border" : "border-border/60"}`}
                                  style={{
                                    minWidth: DAY_W,
                                    backgroundImage: [
                                      "linear-gradient(to right, transparent calc(25% - 1px), hsl(var(--border) / 0.175) calc(25% - 1px), hsl(var(--border) / 0.175) 25%, transparent 25%)",
                                      "linear-gradient(to right, transparent calc(50% - 1px), hsl(var(--border) / 0.35) calc(50% - 1px), hsl(var(--border) / 0.35) 50%, transparent 50%)",
                                      "linear-gradient(to right, transparent calc(75% - 1px), hsl(var(--border) / 0.175) calc(75% - 1px), hsl(var(--border) / 0.175) 75%, transparent 75%)",
                                    ].join(", "),
                                  }}
                                />
                              ))}
                              {rounds.map((round) => {
                                if (!round.start_date || !round.end_date) return null;
                                const startDate = new Date(round.start_date);
                                const rawEnd = new Date(round.end_date);
                                if (isNaN(startDate.getTime()) || isNaN(rawEnd.getTime())) return null;
                                // Review rounds use their stored end timestamp
                                // verbatim (already pinned to 14:00). Production
                                // rounds snap to 11:00am of the delivery day.
                                const endDate = round.kind === "review"
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
                                  fillPx = Math.max(0, Math.min(barWidthPx, nowOffsetWithinLanes - barLeftPx));
                                }
                                const isReview = round.kind === "review";
                                // Status-driven colors apply at full opacity
                                // for ALL rounds (past/current/future) so every
                                // round stays visible:
                                //   in_progress         → yellow
                                //   client_review       → red
                                //   approved/delivered  → green
                                const isApprovedLike =
                                  !isReview &&
                                  (round.status === "approved" ||
                                    round.status === "delivered");
                                const statusOverride =
                                  !isReview && round.status === "in_progress"
                                    ? "bg-yellow-400/20 border-yellow-400/70 shadow-sm"
                                    : !isReview && round.status === "client_review"
                                    ? "bg-red-500/20 border-red-500/70 shadow-sm"
                                    : isApprovedLike
                                    ? "bg-emerald-500/20 border-emerald-500/70 shadow-sm"
                                    : null;
                                const blockClasses = statusOverride
                                  ? statusOverride
                                  : isReview
                                  ? temporal === "current"
                                    ? "bg-amber-500/15 border-amber-500/60 shadow-md"
                                    : "bg-amber-500/10 border-amber-500/40"
                                  : temporal === "current"
                                    ? "bg-secondary border-gold/50 shadow-md"
                                    : "bg-card/70 border-border";
                                return (
                                  <div
                                    key={round.id}
                                    onClick={(e) => handleRoundClick(e, round, scene)}
                                    onMouseEnter={(e) => handleRoundHover(e, round, scene.name)}
                                    onMouseLeave={() => setPopup(null)}
                                    className={`absolute inset-y-3 rounded-lg z-10 overflow-hidden cursor-pointer hover:border-gold/70 transition-all border ${blockClasses}`}
                                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  >
                                    {temporal === "current" && (
                                      <>
                                        <div
                                          className={`absolute inset-y-0 left-0 ${
                                            isReview ? "bg-amber-500/25" : "bg-gold/[0.18]"
                                          }`}
                                          style={{ width: `${fillPx}px` }}
                                        />
                                        <div
                                          className={`absolute inset-y-0 w-px ${
                                            isReview ? "bg-amber-500/70" : "bg-gold/60"
                                          }`}
                                          style={{ left: `${fillPx - 0.5}px` }}
                                        />
                                      </>
                                    )}
                                    <div className={`absolute inset-y-0 left-0 w-px ${
                                      temporal === "past"
                                        ? "bg-border"
                                        : isReview ? "bg-amber-500/60" : "bg-gold/50"
                                    }`} />
                                    <div className={`absolute inset-y-0 right-0 w-px ${
                                      temporal === "past"
                                        ? "bg-border"
                                        : temporal === "current"
                                        ? isReview ? "bg-amber-500/50" : "bg-gold/40"
                                        : "bg-border/80"
                                    }`} />
                                    <div className="relative px-3 py-2.5 h-full flex flex-col justify-center gap-0.5">
                                      <div className="flex items-center gap-2">
                                        {temporal === "current" && (
                                          <div className={`h-1.5 w-1.5 rounded-full shrink-0 animate-pulse ${
                                            isReview ? "bg-amber-500" : "bg-gold"
                                          }`} />
                                        )}
                                        <p className={`text-[11px] font-bold truncate uppercase tracking-wide ${
                                          temporal === "past" ? "text-muted-foreground" : "text-foreground"
                                        }`}>{scene.name}</p>
                                      </div>
                                      <p className={`text-[10px] truncate tracking-[0.05em] font-medium ${
                                        temporal === "past" ? "text-muted-foreground/60" : temporal === "current" ? "text-foreground/80" : "text-muted-foreground"
                                      }`}>
                                        Round {round.round_number.toString().padStart(2, "0")} · {isReview ? "Review" : statusLabel(round.status)}
                                      </p>
                                      {round.instructions && (
                                        <FileText size={9} className="absolute bottom-2 right-2.5 text-muted-foreground/40" />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </SortableSceneRow>
                        ))}
                          </SortableContext>
                        </DndContext>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Instructions Popup */}
      <AnimatePresence>
        {popup && (
          <>
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
              onMouseLeave={() => setPopup(null)}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <FileText size={12} className="text-gold" />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Round {popup.round.round_number.toString().padStart(2, "0")} — Instructions
                  </span>
                </div>
              </div>
              <div className="px-4 py-3 max-h-80 overflow-y-auto">
                <p className="text-[10px] font-medium text-gold/70 uppercase tracking-widest mb-1">
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
                    <div className="h-3 w-3 animate-spin rounded-full border border-gold border-t-transparent" />
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
                            <span className="text-[9px] font-bold text-gold/50 uppercase tracking-wider w-16 shrink-0 truncate">
                              {categoryLabel}
                            </span>
                            <span className="truncate flex-1">{file.file_name}</span>
                            <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
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

      {/* Pending Lane Task Requests */}
      {pendingRequests.length > 0 && (
        <div className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-6 py-4 border-b border-border flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-gold">
              Pending Requests
            </span>
            <span className="text-xs text-muted-foreground">
              {pendingRequests.length} awaiting validation
            </span>
          </header>
          <ul className="divide-y divide-border">
            {pendingRequests.map((r) => (
              <li key={r.id} className="px-6 py-4 flex items-center gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold/80">
                      {r.client_name}
                    </span>
                    {r.project_name && (
                      <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        · {r.project_name}
                      </span>
                    )}
                  </div>
                  <p className="font-serif text-sm text-foreground mt-1 truncate">
                    {r.title}
                  </p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {r.description}
                    </p>
                  )}
                  {r.attachments && r.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {r.attachments.map((a, i) => (
                        <button
                          key={i}
                          onClick={() => openAttachment(a.path)}
                          className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded border border-border/60 hover:border-gold/60 hover:text-gold transition-colors text-muted-foreground"
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70">
                    Requested delivery
                  </p>
                  <p className="text-xs text-foreground mt-1">
                    {r.requested_delivery_date
                      ? format(new Date(r.requested_delivery_date), "MMM d, yyyy")
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => {
                      setValidating(r);
                      setValidateForm({
                        laneIndex: 1,
                        startDate: format(new Date(), "yyyy-MM-dd"),
                        durationDays: 3,
                      });
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Validate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => declineRequest(r.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Validate Request Modal */}
      <Dialog open={!!validating} onOpenChange={(o) => !o && setValidating(null)}>
        <DialogContent className="z-[100] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Validate request
            </DialogTitle>
          </DialogHeader>
          {validating && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 p-3 border border-border">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {validating.client_name}
                  {validating.project_name ? ` · ${validating.project_name}` : ""}
                </p>
                <p className="font-serif text-sm mt-1">{validating.title}</p>
                {validating.requested_delivery_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested by{" "}
                    {format(
                      new Date(validating.requested_delivery_date),
                      "MMM d, yyyy",
                    )}
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">
                  Lane
                </label>
                <select
                  value={validateForm.laneIndex}
                  onChange={(e) =>
                    setValidateForm((p) => ({
                      ...p,
                      laneIndex: Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Lane {n.toString().padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">
                    Start date
                  </label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={validateForm.startDate}
                    onChange={(e) =>
                      setValidateForm((p) => ({
                        ...p,
                        startDate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">
                    Duration (days)
                  </label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    className="mt-1.5"
                    value={validateForm.durationDays}
                    onChange={(e) =>
                      setValidateForm((p) => ({
                        ...p,
                        durationDays: Math.max(
                          0.5,
                          Number(e.target.value) || 1,
                        ),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setValidating(null)}>
              Cancel
            </Button>
            <Button onClick={validateRequest}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}