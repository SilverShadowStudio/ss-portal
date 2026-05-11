import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  isSameDay,
  addDays,
  isWeekend,
  parseISO,
} from "date-fns";
import {
  Plus,
  Minus,
  Trash2,
  
  Layout,
  Settings,
  Pencil,
  X,
  Eraser,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Lightbox } from "@/components/client/AssetViewer";
import { useAuth } from "@/contexts/AuthContext";
import { ClientLayout } from "@/components/ClientLayout";
import { ZoomScale } from "@/components/client/ZoomScale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

const LANE_PRICES_PENCE = [
  395000, 380000, 370000, 360000, 350000, 335000, 325000, 320000, 310000, 300000,
];

interface ProjectRow {
  id: string;
  name: string;
}

interface LaneTaskRow {
  id: string;
  account_id: string;
  lane_index: number | null;
  position: number | null;
  title: string;
  description: string | null;
  status: "queued" | "in_progress" | "completed" | "cancelled";
  start_date: string | null;
  duration_days: number | null;
  requested_delivery_date: string | null;
  project_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface SubscriptionRow {
  id: string;
  account_id: string;
  active_lanes: number;
  monthly_cost_pence: number;
  status: string;
  pending_lane_count: number | null;
  pending_monthly_cost_pence: number | null;
  lane_change_effective_at: string | null;
  lane_change_requested_at: string | null;
}

const DEFAULT_PROJECT_PALETTE = [
  "#BCA88E",
  "#10b981",
  "#6366f1",
  "#f43f5e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
];

function paletteFor(id: string, idx: number): string {
  return DEFAULT_PROJECT_PALETTE[idx % DEFAULT_PROJECT_PALETTE.length];
}

// ── Sketch Overlay ────────────────────────────────────────────────────────────
function SketchOverlay({
  imageUrl,
  initialSketch,
  onSave,
  onClose,
}: {
  imageUrl: string;
  initialSketch: string | null;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const [color, setColor] = useState("#E8C97A");
  const [lineWidth, setLineWidth] = useState(3);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Load image + any previous sketch onto canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const container = containerRef.current;
      if (!container) return;
      const cw = container.clientWidth;
      const ratio = img.naturalHeight / img.naturalWidth;
      canvas.width = cw;
      canvas.height = cw * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (initialSketch) {
        const overlay = new Image();
        overlay.onload = () => {
          ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
          setImgLoaded(true);
        };
        overlay.src = initialSketch;
      } else {
        setImgLoaded(true);
      }
    };
    img.src = imageUrl;
  }, [imageUrl, initialSketch]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    if (!lastPos.current) { lastPos.current = pos; return; }
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = eraseMode ? "#00000000" : color;
    ctx.lineWidth = eraseMode ? lineWidth * 6 : lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (eraseMode) {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    lastPos.current = pos;
  };

  const endDraw = () => {
    setDrawing(false);
    lastPos.current = null;
  };

  const clearSketch = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    if (imgRef.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current!;
    onSave(canvas.toDataURL("image/png"));
    onClose();
  };

  const colors = ["#E8C97A", "#FFFFFF", "#E04F4F", "#4FD1C5", "#000000"];

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background/95 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border/30 shrink-0">
        <div>
          <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-foreground/40">
            Annotate scene
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Colour palette */}
          <div className="flex items-center gap-2 mr-2">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c); setEraseMode(false); }}
                className="transition-all"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: c,
                  border: color === c && !eraseMode ? "2px solid white" : "1px solid rgba(255,255,255,0.2)",
                  transform: color === c && !eraseMode ? "scale(1.25)" : "scale(1)",
                }}
              />
            ))}
          </div>
          {/* Line width */}
          <input
            type="range"
            min={1}
            max={10}
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            className="w-16 accent-gold"
          />
          {/* Erase */}
          <button
            type="button"
            onClick={() => setEraseMode((v) => !v)}
            className={`p-2 transition-colors ${eraseMode ? "text-gold" : "text-foreground/40 hover:text-foreground/70"}`}
            title="Erase"
          >
            <Eraser size={15} strokeWidth={1.5} />
          </button>
          {/* Clear */}
          <button
            type="button"
            onClick={clearSketch}
            className="p-2 text-foreground/40 hover:text-foreground/70 transition-colors"
            title="Clear"
          >
            <RotateCcw size={15} strokeWidth={1.5} />
          </button>
          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-foreground/30 hover:text-foreground/70 transition-colors ml-2"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden p-6"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          className="max-w-full max-h-full object-contain"
          style={{
            cursor: eraseMode ? "cell" : "crosshair",
            display: imgLoaded ? "block" : "none",
            borderRadius: 4,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        />
        {!imgLoaded && (
          <div className="text-foreground/30 text-sm tracking-widest uppercase">Loading…</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-8 py-5 border-t border-border/30 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-3 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/35 border border-border/35 hover:text-foreground/55 transition-all"
          style={{ borderRadius: 2 }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-8 py-3 text-[10px] font-sans uppercase tracking-[0.24em] bg-foreground text-background hover:bg-foreground/90 transition-all"
          style={{ borderRadius: 2 }}
        >
          Save annotation
        </button>
      </div>
    </div>
  );
}

export default function Timeline() {
  const { user } = useAuth();
  const [now, setNow] = useState(new Date());
  const [visibleMonth, setVisibleMonth] = useState(format(new Date(), "MMMM yyyy"));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [tasks, setTasks] = useState<LaneTaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lanesPlanOpen, setLanesPlanOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    projectId: "",
    sceneId: "",
    requestedDeliveryDate: "",
  });
  const [projectScenes, setProjectScenes] = useState<{ id: string; name: string; thumbnailUrl?: string }[]>([]);
  const [sceneThumbnail, setSceneThumbnail] = useState<string | null>(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchDataUrl, setSketchDataUrl] = useState<string | null>(null);
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const [interactionMode, setInteractionMode] = useState<"annotate" | "dictate" | "type" | null>(null);

  useEffect(() => {
    const el = briefRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [newTask.description, addOpen]);

  // Fetch scenes + thumbnails for selected project
  useEffect(() => {
    if (!newTask.projectId) {
      setProjectScenes([]);
      setNewTask((p) => ({ ...p, sceneId: "" }));
      setSceneThumbnail(null);
      return;
    }
    supabase
      .from("scenes")
      .select("id, name")
      .eq("project_id", newTask.projectId)
      .order("name")
      .then(async ({ data }) => {
        const scenes = data || [];
        // Fetch latest round asset for each scene
        const withThumbs = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const { data: rounds } = await supabase
                .from("scene_rounds")
                .select("id, round_number")
                .eq("scene_id", scene.id)
                .order("round_number", { ascending: false })
                .limit(1);
              if (!rounds || rounds.length === 0) return { ...scene };
              const latestRoundId = rounds[0].id;
              const { data: assets, error: assetsErr } = await supabase
                .from("round_assets")
                .select("storage_path, created_at")
                .eq("scene_round_id", latestRoundId)
                .eq("is_current", true)
                .eq("source", "upload")
                .not("storage_path", "is", null)
                .order("created_at", { ascending: false })
                .limit(1);
              console.log("[Timeline] highest round_assets for scene", scene.name, { latestRoundId, assets, assetsErr });
              if (!assets || assets.length === 0) return { ...scene };
              const rawPath = String(assets[0].storage_path).replace(/^\/+/, "");
              const { data: urlData } = supabase.storage
                .from("round-uploads")
                .getPublicUrl(rawPath);
              return { ...scene, thumbnailUrl: urlData.publicUrl };
            } catch (e) {
              console.error("[Timeline] thumbnail fetch failed for", scene.name, e);
              return { ...scene };
            }
          })
        );
        setProjectScenes(withThumbs);
        const lastScene = localStorage.getItem("lastTaskSceneId_" + newTask.projectId) || "";
        const validLast = withThumbs.some((s) => s.id === lastScene) ? lastScene : "";
        const defaultScene = validLast || (withThumbs.length > 0 ? withThumbs[0].id : "");
        setNewTask((p) => ({ ...p, sceneId: defaultScene }));
        if (defaultScene) {
          const thumb = (withThumbs.find((s) => s.id === defaultScene) as { thumbnailUrl?: string } | undefined)?.thumbnailUrl || null;
          setSceneThumbnail(thumb);
        }
      });
  }, [newTask.projectId]);

  const polishDictation = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;
    setIsPolishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("polish-task", {
        body: { transcript },
      });
      if (error) throw error;
      if (data?.title && data?.description) {
        const validDate =
          typeof data.deliveryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.deliveryDate)
            ? data.deliveryDate
            : "";
        setNewTask((p) => ({
          ...p,
          title: data.title,
          description: data.description,
          ...(validDate ? { requestedDeliveryDate: validDate } : {}),
        }));
        toast.success(
          validDate
            ? `Dictation polished — delivery set to ${validDate}`
            : "Dictation polished — review and request",
        );
      } else {
        throw new Error("No output");
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Could not polish dictation");
    } finally {
      setIsPolishing(false);
    }
  }, []);

  const startDictation = useCallback(async () => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Dictation not supported in this browser");
      return;
    }
    // Explicitly trigger the browser's mic permission prompt
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      console.error("mic permission error", err);
      const inIframe = window.self !== window.top;
      if (err?.name === "NotAllowedError" && inIframe) {
        toast.error(
          "Mic blocked inside the preview iframe. Open the app in a new tab to dictate.",
          {
            action: {
              label: "Open in new tab",
              onClick: () => window.open(window.location.href, "_blank"),
            },
            duration: 10000,
          },
        );
      } else if (err?.name === "NotAllowedError") {
        toast.error("Microphone access blocked. Click the 🎤 icon in your browser's address bar to allow it.");
      } else if (err?.name === "NotFoundError") {
        toast.error("No microphone found");
      } else {
        toast.error("Could not access microphone");
      }
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    transcriptRef.current = "";
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        finalText += e.results[i][0].transcript + " ";
      }
      transcriptRef.current = finalText;
    };
    rec.onerror = (e: any) => {
      console.error("speech error", e?.error || e);
      const err = e?.error;
      if (err === "no-speech") {
        toast.error("No speech detected — try again");
      } else if (err === "not-allowed" || err === "service-not-allowed") {
        toast.error("Microphone access blocked. Click the 🎤 icon in your browser's address bar to allow it.");
      } else if (err === "audio-capture") {
        toast.error("No microphone found");
      } else if (err === "network") {
        toast.error("Speech recognition unavailable (network). Try Chrome/Edge over HTTPS.");
      } else if (err === "aborted") {
        // user stopped — silent
      } else {
        toast.error(`Dictation error: ${err || "unknown"}`);
      }
      setIsRecording(false);
    };
    rec.onend = () => {
      setIsRecording(false);
      const text = transcriptRef.current.trim();
      if (text) polishDictation(text);
    };
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, [polishDictation]);

  const stopDictation = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
  }, []);

  const [hovered, setHovered] = useState<{
    task: LaneTaskRow;
    rect: DOMRect;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(() => {
      setHeaderH(headerRef.current?.offsetHeight ?? 0);
    });
    ro.observe(headerRef.current);
    setHeaderH(headerRef.current.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // ---- Load account / subscription / tasks / projects ----
  useEffect(() => {
    if (!user) return;
    supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.account_id) setAccountId(data.account_id);
        else setLoading(false);
      });
  }, [user]);

  const loadAll = useCallback(async (acc: string) => {
    setLoading(true);
    const [{ data: s }, { data: t }, { data: p }] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("account_id", acc).maybeSingle(),
      supabase
        .from("lane_tasks")
        .select("*")
        .eq("account_id", acc)
        .order("lane_index")
        .order("position"),
      supabase
        .from("projects")
        .select("id, name")
        .eq("account_id", acc)
        .is("archived_at", null),
    ]);
    setSub(s as SubscriptionRow | null);
    setTasks((t as LaneTaskRow[]) ?? []);
    setProjects((p as ProjectRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (accountId) loadAll(accountId);
  }, [accountId, loadAll]);

  // ---- Tick the now-line ----
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- Timeline geometry ----
  const SIDEBAR_W = 200;
  const DAY_W_MIN = 48;
  const DAY_W_MAX = 360;
  const DAY_W_DEFAULT = 120;
  const [DAY_W, setDayW] = useState(DAY_W_DEFAULT);

  const timelineDays = useMemo(() => {
    const start = startOfMonth(subMonths(now, 6));
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

  const dateToOffsetPx = useCallback(
    (d: Date): number | null => {
      if (!d || isNaN(d.getTime())) return null;
      const id = format(d, "yyyy-MM-dd");
      const idx = dayToIndex.get(id);
      const fraction =
        (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) / 1440;
      if (idx !== undefined) return (idx + fraction) * DAY_W;
      let prev = addDays(d, -1);
      for (let i = 0; i < 7; i++) {
        const pidx = dayToIndex.get(format(prev, "yyyy-MM-dd"));
        if (pidx !== undefined) return (pidx + 1) * DAY_W;
        prev = addDays(prev, -1);
      }
      let next = addDays(d, 1);
      for (let i = 0; i < 7; i++) {
        const nidx = dayToIndex.get(format(next, "yyyy-MM-dd"));
        if (nidx !== undefined) return nidx * DAY_W;
        next = addDays(next, 1);
      }
      return null;
    },
    [dayToIndex, DAY_W],
  );

  const nowPos = useMemo(() => {
    const idx = dayToIndex.get(format(now, "yyyy-MM-dd"));
    if (idx !== undefined) {
      const progress =
        (now.getHours() * 60 + now.getMinutes()) / 1440;
      return SIDEBAR_W + (idx + progress) * DAY_W;
    }
    let prev = addDays(now, -1);
    for (let i = 0; i < 7; i++) {
      const pidx = dayToIndex.get(format(prev, "yyyy-MM-dd"));
      if (pidx !== undefined) return SIDEBAR_W + (pidx + 1) * DAY_W;
      prev = addDays(prev, -1);
    }
    return null;
  }, [now, dayToIndex, DAY_W]);

  // ---- Zoom anchoring ----
  const zoomAnchorRef = useRef<{ ratio: number; screenX: number } | null>(null);
  const captureZoomAnchor = useCallback(() => {
    const c = scrollRef.current;
    if (!c) return;
    const lanesWidth = timelineDays.length * DAY_W;
    if (lanesWidth <= 0) return;
    const viewLeft = c.scrollLeft;
    const centerScreenX = c.clientWidth / 2;
    const focusContentX = viewLeft + centerScreenX - SIDEBAR_W;
    const ratio = Math.max(0, Math.min(1, focusContentX / lanesWidth));
    zoomAnchorRef.current = { ratio, screenX: centerScreenX };
  }, [timelineDays.length, DAY_W]);

  useLayoutEffect(() => {
    const c = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!c || !anchor) return;
    const newLanesWidth = timelineDays.length * DAY_W;
    const newFocus = anchor.ratio * newLanesWidth;
    c.scrollLeft = Math.max(0, SIDEBAR_W + newFocus - anchor.screenX);
    zoomAnchorRef.current = null;
  }, [DAY_W, timelineDays.length]);

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

  const scrollToNow = useCallback(
    (smooth = true) => {
      const c = scrollRef.current;
      if (!c || nowPos === null) return;
      const left = Math.max(0, nowPos - c.clientWidth / 2);
      c.scrollTo({
        left,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [nowPos],
  );

  // ---- Month label tracking ----
  // Uses the header row's bounding rect so it works regardless of which
  // ancestor actually owns the horizontal scroll (inner scrollRef or window).
  useEffect(() => {
    if (timelineDays.length === 0) return;
    let raf: number | null = null;
    const update = () => {
      raf = null;
      const header = headerRef.current;
      if (!header) return;
      const rect = header.getBoundingClientRect();
      // Center of the visible portion of the header (excluding sidebar gutter)
      const visibleLeft = Math.max(rect.left + SIDEBAR_W, 0);
      const visibleRight = Math.min(rect.right, window.innerWidth);
      if (visibleRight <= visibleLeft) return;
      const centerScreenX = (visibleLeft + visibleRight) / 2;
      // Convert screen X to day index relative to header start (after sidebar)
      const offsetIntoDays = centerScreenX - (rect.left + SIDEBAR_W);
      const idx = Math.floor(offsetIntoDays / DAY_W);
      if (idx >= 0 && idx < timelineDays.length) {
        setVisibleMonth((prev) => {
          const next = format(timelineDays[idx].date, "MMMM yyyy");
          return prev === next ? prev : next;
        });
      }
    };
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(update);
    };
    update();
    const c = scrollRef.current;
    c?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      c?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true } as any);
      window.removeEventListener("resize", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [timelineDays, DAY_W]);

  // ---- Always reset to now when landing on the Timeline page ----
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c || timelineDays.length === 0 || nowPos === null || loading || !sub) return;

    let cancelled = false;
    const centerNow = () => {
      if (cancelled || !scrollRef.current) return;
      const el = scrollRef.current;
      el.scrollLeft = Math.max(0, nowPos - el.clientWidth / 2);
    };

    centerNow();
    const raf1 = requestAnimationFrame(centerNow);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(centerNow));
    const timers = [0, 50, 150, 300, 600].map((delay) => window.setTimeout(centerNow, delay));
    const ro = new ResizeObserver(centerNow);
    ro.observe(c);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      timers.forEach(window.clearTimeout);
      ro.disconnect();
    };
  }, [loading, nowPos, sub, timelineDays.length]);

  // ---- Listen for sidebar "Timeline" clicks to recenter on now ----
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => scrollToNow(true));
    };
    window.addEventListener("timeline:scroll-to-now", handler);
    return () => window.removeEventListener("timeline:scroll-to-now", handler);
  }, [scrollToNow]);

  // ---- Drag-to-pan ----
  const dragRef = useRef({ down: false, startX: 0, scrollLeft: 0 });
  const onMouseDown = (e: React.MouseEvent) => {
    // Skip drag when clicking interactive elements
    if ((e.target as HTMLElement).closest("[data-task-bar],button,a,input,select,textarea")) return;
    dragRef.current.down = true;
    dragRef.current.startX = e.pageX;
    dragRef.current.scrollLeft = scrollRef.current?.scrollLeft ?? 0;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.down || !scrollRef.current) return;
    e.preventDefault();
    const walk = (e.pageX - dragRef.current.startX) * 1.5;
    scrollRef.current.scrollLeft = dragRef.current.scrollLeft - walk;
  };
  const onMouseUpLeave = () => {
    dragRef.current.down = false;
  };

  // ---- Wheel: vertical → horizontal ----
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      c.scrollLeft += e.deltaY;
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  // ---- Lane mutation ----
  const lanes = sub?.active_lanes ?? 0;

  const [laneChangeConfirm, setLaneChangeConfirm] = useState<{
    targetCount: number;
    type: "increase" | "decrease";
  } | null>(null);

  const requestLaneChange = (n: number) => {
    if (!sub || n === lanes) return;
    setLaneChangeConfirm({ targetCount: n, type: n > lanes ? "increase" : "decrease" });
  };

  const applyLaneIncrease = async (n: number) => {
    if (!sub || !accountId) return;
    const monthly = LANE_PRICES_PENCE.slice(0, n).reduce((a, b) => a + b, 0);
    const { error } = await supabase
      .from("subscriptions")
      .update({
        active_lanes: n,
        monthly_cost_pence: monthly,
        // If a pending downgrade existed and target >= it, clear it
        pending_lane_count: null,
        pending_monthly_cost_pence: null,
        lane_change_effective_at: null,
        lane_change_requested_at: null,
      })
      .eq("id", sub.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Production capacity expanded");
      loadAll(accountId);
    }
  };

  const applyLaneDecrease = async (n: number, effectiveAt: Date) => {
    if (!sub || !accountId) return;
    const monthly = LANE_PRICES_PENCE.slice(0, n).reduce((a, b) => a + b, 0);
    const { error } = await supabase
      .from("subscriptions")
      .update({
        pending_lane_count: n,
        pending_monthly_cost_pence: monthly,
        lane_change_effective_at: format(effectiveAt, "yyyy-MM-dd"),
        lane_change_requested_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Lane reduction scheduled");
      loadAll(accountId);
    }
  };

  const cancelPendingLaneChange = async () => {
    if (!sub || !accountId) return;
    const { error } = await supabase
      .from("subscriptions")
      .update({
        pending_lane_count: null,
        pending_monthly_cost_pence: null,
        lane_change_effective_at: null,
        lane_change_requested_at: null,
      })
      .eq("id", sub.id);
    if (error) toast.error(error.message);
    else loadAll(accountId);
  };

  const enableSubscription = async () => {
    if (!accountId) return;
    const { error } = await supabase.from("subscriptions").upsert(
      {
        account_id: accountId,
        active_lanes: 1,
        monthly_cost_pence: LANE_PRICES_PENCE[0],
        status: "active",
      },
      { onConflict: "account_id" },
    );
    if (error) toast.error(error.message);
    else loadAll(accountId);
  };

  const tasksByLane = useMemo(() => {
    const m: Record<number, LaneTaskRow[]> = {};
    for (let i = 1; i <= lanes; i++) m[i] = [];
    tasks.forEach((t) => {
      if (t.lane_index != null && t.lane_index <= lanes) (m[t.lane_index] ||= []).push(t);
    });
    // Make tasks contiguous within each lane: sort by start_date then push each
    // task's effective start to the previous task's end (no downtime).
    for (const k of Object.keys(m)) {
      const list = m[Number(k)];
      list.sort((a, b) => {
        const sa = a.start_date ? new Date(a.start_date).getTime() : 0;
        const sb = b.start_date ? new Date(b.start_date).getTime() : 0;
        return sa - sb;
      });
      let prevEndMs: number | null = null;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t.start_date) continue;
        const origStart = new Date(t.start_date);
        if (isNaN(origStart.getTime())) continue;
        const dur = Math.max(0.5, Number(t.duration_days) || 1);
        const startMs = prevEndMs !== null ? Math.max(origStart.getTime(), prevEndMs) : origStart.getTime();
        const newStart = new Date(startMs);
        const endMs = startMs + dur * 86400000;
        // Mutate a shallow copy via reassignment of the field used in render.
        list[i] = { ...t, start_date: format(newStart, "yyyy-MM-dd") + "T" + format(newStart, "HH:mm:ss") } as any;
        prevEndMs = endMs;
      }
    }
    return m;
  }, [tasks, lanes]);

  // ---- Submit task request (pending admin validation) ----
  const submitTask = async () => {
    if (!accountId || !user) return;
    const hasAnnotate = !!sketchDataUrl;
    const hasDictate = interactionMode === "dictate" && !!newTask.description.trim();
    const hasType = !!newTask.title.trim() || !!newTask.description.trim();
    if (!hasAnnotate && !hasDictate && !hasType) return;
    setUploadingFiles(true);

    // Convert sketch annotation to a File if present
    const allFiles = [...taskFiles];
    if (sketchDataUrl) {
      const res = await fetch(sketchDataUrl);
      const blob = await res.blob();
      const sketchFile = new File([blob], "sketch-annotation.png", { type: "image/png" });
      allFiles.unshift(sketchFile);
    }

    const attachments: { name: string; path: string; size: number; type: string }[] = [];
    try {
      for (const file of allFiles) {
        const path = `task-requests/${accountId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("scene-assets")
          .upload(path, file, { upsert: false });
        if (upErr) {
          toast.error(`Upload failed: ${file.name}`);
          setUploadingFiles(false);
          return;
        }
        attachments.push({ name: file.name, path, size: file.size, type: file.type });
      }
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
      setUploadingFiles(false);
      return;
    }

    const { error } = await supabase.from("lane_tasks").insert({
      account_id: accountId,
      lane_index: null,
      position: null,
      title: newTask.title.trim() || (sketchDataUrl ? "Annotated request" : "New request"),
      description: newTask.description.trim() || null,
      created_by: user.id,
      project_id: newTask.projectId || null,
      requested_delivery_date: newTask.requestedDeliveryDate || null,
      start_date: null,
      duration_days: 1,
      status: "queued",
      attachments,
    } as any);
    setUploadingFiles(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (newTask.projectId) {
      localStorage.setItem("lastTaskProjectId", newTask.projectId);
    }
    if (newTask.sceneId && newTask.projectId) {
      localStorage.setItem("lastTaskSceneId_" + newTask.projectId, newTask.sceneId);
    }
    toast.success("Request sent for review");
    setAddOpen(false);
    setNewTask({
      title: "",
      description: "",
      projectId: "",
      sceneId: "",
      requestedDeliveryDate: "",
    });
    setTaskFiles([]);
    setSketchDataUrl(null);
    setInteractionMode(null);
    loadAll(accountId);
  };

  const deleteTask = async (id: string) => {
    if (!accountId) return;
    await supabase.from("lane_tasks").delete().eq("id", id);
    loadAll(accountId);
  };

  // ---- Project colors ----
  const projectColor = (projectId: string | null): string | null => {
    if (!projectId) return null;
    if (colorOverrides[projectId]) return colorOverrides[projectId];
    const idx = projects.findIndex((p) => p.id === projectId);
    return paletteFor(projectId, idx >= 0 ? idx : 0);
  };

  // ---- Render ----
  if (loading) {
    return (
      <ClientLayout>
        <div className="p-12 text-muted-foreground">Loading timeline…</div>
      </ClientLayout>
    );
  }

  if (!accountId) {
    return (
      <ClientLayout>
        <div className="mx-auto max-w-2xl p-12 text-center">
          <h1 className="font-serif text-2xl">No account linked</h1>
          <p className="mt-4 text-muted-foreground">
            Your user is not yet attached to a company account. An admin needs
            to add you to an account before you can manage lanes.
          </p>
        </div>
      </ClientLayout>
    );
  }

  if (!sub) {
    return (
      <ClientLayout>
        <div className="mx-auto max-w-2xl p-12 text-center">
          <p className="font-serif text-xs tracking-[0.3em] text-[hsl(var(--gold))]">
            STUDIO PARTNERSHIP
          </p>
          <h1 className="mt-3 font-serif text-3xl">No active subscription</h1>
          <p className="mt-4 text-muted-foreground">
            Activate your lane subscription to start scheduling work.
          </p>
          <Button className="mt-8" onClick={enableSubscription}>
            Activate 1-Lane subscription
          </Button>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="mb-12 animate-fade-in">
        <div className="mb-5 flex items-center gap-4">
          <div className="h-px w-10 bg-[hsl(var(--gold))]/60" />
          <span className="text-[9px] uppercase tracking-[0.42em] text-[hsl(var(--gold))]">
            Timeline
          </span>
        </div>
        <h1 className="font-serif text-4xl font-light tracking-[0.04em] text-foreground md:text-5xl mb-3">
          Production Lanes
        </h1>
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground/70">
          {lanes} active lane{lanes === 1 ? "" : "s"} <span className="mx-2 text-[hsl(var(--gold))]/60">·</span>{" "}
          {tasks.length} task{tasks.length === 1 ? "" : "s"} scheduled
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-sm border border-border/60 bg-card overflow-hidden flex flex-col"
      >
        {/* Toolbar */}
        <header className="relative border-b border-border/60 flex items-stretch shrink-0 bg-card">
          {/* Left gutter aligned with the lane-name column */}
          <div
            className="shrink-0 border-r border-border/60"
            style={{ width: SIDEBAR_W }}
          />
          {/* Month label (left), Zoom (right) */}
          <div className="flex-1 relative flex items-center px-4 py-3">
            <span className="font-serif text-[13px] tracking-[0.18em] text-foreground/90 uppercase whitespace-nowrap">
              {visibleMonth}
            </span>
            <div className="ml-auto flex items-center gap-4">
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground/60">
                Zoom
              </span>
              <ZoomScale value={DAY_W} min={DAY_W_MIN} max={DAY_W_MAX} onChange={setZoom} />
            </div>
          </div>
          {/* NOW marker aligned with present-time line. */}
          <div
            onClick={() => scrollToNow()}
            role="button"
            aria-label="Scroll to now"
            className="absolute top-0 bottom-0 -translate-x-1/2 flex items-center cursor-pointer"
            style={{ left: `calc(50% + ${SIDEBAR_W / 2}px)` }}
          >
            <div className="self-stretch w-px bg-[hsl(var(--gold))]/70" />
            <span className="pl-2 text-[9px] tracking-[0.28em] uppercase text-white">NOW</span>
          </div>
        </header>

        {/* Settings: project colors */}
        <AnimatePresence>
          {settingsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-border bg-muted/20"
            >
              <div className="px-6 py-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--gold))] mb-4">
                  Project colors
                </p>
                {projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No projects yet.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {projects.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <input
                          type="color"
                          value={projectColor(p.id) ?? paletteFor(p.id, i)}
                          onChange={(e) =>
                            setColorOverrides((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="h-8 w-8 rounded cursor-pointer border border-border bg-transparent"
                        />
                        <span className="text-xs font-medium truncate">{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrollable timeline */}
        <div className="relative">
          <div
            ref={scrollRef}
            className="overflow-x-auto scrollbar-thin select-none cursor-grab active:cursor-grabbing"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUpLeave}
            onMouseLeave={onMouseUpLeave}
          >
            <div
              className="flex flex-col relative"
              style={{ minWidth: `${SIDEBAR_W + timelineDays.length * DAY_W}px` }}
            >
              {/* Now indicator (only spans below the clock/day-headers) */}
              {nowPos !== null && (
                <div
                  className="pointer-events-none absolute bottom-0 z-20"
                  style={{ left: `${nowPos}px`, top: `${headerH}px`, width: 0 }}
                >
                  <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-[#C5A059]" />
                </div>
              )}

              {/* Day headers */}
              <div ref={headerRef} className="flex border-b border-border/60 sticky top-0 z-40 bg-card">
                <div
                  className="shrink-0 border-r border-border/60 sticky left-0 z-[55] bg-card flex items-center justify-center"
                  style={{ width: SIDEBAR_W }}
                >
                  <button
                    type="button"
                    onClick={() => setLanesPlanOpen(true)}
                    className="group inline-flex items-center gap-2 text-[9px] uppercase tracking-[0.32em] text-muted-foreground/70 hover:text-[hsl(var(--gold))] transition-colors"
                  >
                    <Settings className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                    Manage lanes
                  </button>
                </div>
                <div className="flex flex-1 relative">
                  {nowPos !== null && (
                    <div
                      className="pointer-events-none absolute bottom-0 w-px -translate-x-1/2 bg-[#C5A059] z-10"
                      style={{ left: `${nowPos - SIDEBAR_W}px`, top: "20px" }}
                    />
                  )}
                  {nowPos !== null && (
                    <div
                      className="pointer-events-none absolute bottom-0 -translate-x-1/2 z-50 px-2 py-0.5 bg-[hsl(var(--gold))] text-background text-[9px] tracking-[0.22em] uppercase whitespace-nowrap"
                      style={{ left: `${nowPos - SIDEBAR_W}px` }}
                    >
                      {isWeekend(now)
                        ? "Closed"
                        : now.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                    </div>
                  )}
                  {timelineDays.map((day) => (
                    <div
                      key={day.id}
                      className={`flex-1 py-5 border-r flex flex-col items-center justify-center gap-1 relative z-20 ${
                        day.date.getDay() === 5 ? "border-border/70" : "border-border/30"
                      } ${isSameDay(now, day.date) ? "bg-[hsl(var(--gold))]/[0.04]" : ""}`}
                      style={{ minWidth: DAY_W }}
                    >
                      <span
                        className={`text-[8px] tracking-[0.32em] uppercase px-1.5 rounded-sm bg-card ${
                          isSameDay(now, day.date) ? "text-[hsl(var(--gold))]" : "text-muted-foreground/50"
                        }`}
                        style={{}}
                      >
                        {day.name}
                      </span>
                      <span
                        className={`font-serif text-base tabular-nums font-light px-1.5 rounded-sm bg-card ${
                          isSameDay(now, day.date)
                            ? "text-[hsl(var(--gold))]"
                            : "text-foreground/85"
                        }`}
                      >
                        {day.num}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lane rows */}
              {Array.from({ length: lanes }, (_, i) => i + 1).map((laneIdx) => {
                const list = tasksByLane[laneIdx] || [];
                return (
                  <div
                    key={laneIdx}
                    className="flex border-b border-border/40 group/lane"
                  >
                    <div
                      className="shrink-0 border-r border-border/60 sticky left-0 z-[55] bg-card flex flex-col justify-center px-6 py-7"
                      style={{ width: SIDEBAR_W }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-serif text-[13px] tracking-[0.3em] text-foreground font-light">
                          Lane {laneIdx.toString().padStart(2, "0")}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 opacity-0 group-hover/lane:opacity-100 transition-opacity text-[hsl(var(--gold))]"
                          onClick={() => setAddOpen(true)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="mt-2 text-[9px] uppercase tracking-[0.32em] text-muted-foreground/60">
                        {list.length} task{list.length === 1 ? "" : "s"}
                      </p>
                    </div>

                    <div className="flex-1 relative h-28 flex">
                      {timelineDays.map((d) => (
                        <div
                          key={d.id}
                          className={`flex-1 border-r ${
                            d.date.getDay() === 5 ? "border-border/50" : "border-border/20"
                          } ${isSameDay(now, d.date) ? "bg-[hsl(var(--gold))]/[0.03]" : ""}`}
                          style={{ minWidth: DAY_W }}
                        />
                      ))}

                      {/* Task bars */}
                      {list.map((task) => {
                        if (!task.start_date) return null;
                        const sd = parseISO(task.start_date);
                        if (isNaN(sd.getTime())) return null;
                        const dur = Math.max(0.5, Number(task.duration_days) || 1);
                        const ed = addDays(sd, dur);
                        const startPx = dateToOffsetPx(sd);
                        const endPx = dateToOffsetPx(ed);
                        if (startPx === null || endPx === null || endPx <= startPx) return null;
                        const totalLanesPx = timelineDays.length * DAY_W;
                        const leftPct = (startPx / totalLanesPx) * 100;
                        const widthPct = ((endPx - startPx) / totalLanesPx) * 100;
                        const color = projectColor(task.project_id);
                        const isDone = task.status === "completed";
                        const isActive = task.status === "in_progress";
                        const todayMid = new Date();
                        todayMid.setHours(0, 0, 0, 0);
                        const isPast = ed.getTime() <= todayMid.getTime();
                        const PAST_GREEN = "#4ade80"; // green-400
                        // Scene grouping color: tasks sharing the same prefix
                        // (text before " — " or " - ") belong to the same scene.
                        const sceneKey = (task.title || "").split(/\s[—-]\s/)[0].trim().toLowerCase();
                        const SCENE_PALETTE = [
                          "#BCA88E", "#7BA7C9", "#C97B7B", "#9BBF8A",
                          "#C9A87B", "#A87BC9", "#7BC9BF", "#C97BA8",
                        ];
                        let h = 0;
                        for (let i = 0; i < sceneKey.length; i++) h = (h * 31 + sceneKey.charCodeAt(i)) >>> 0;
                        const sceneDot = SCENE_PALETTE[h % SCENE_PALETTE.length];

                        return (
                          <div
                            key={task.id}
                            data-task-bar
                            onMouseEnter={(e) =>
                              setHovered({
                                task,
                                rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                              })
                            }
                            onMouseLeave={() => setHovered(null)}
                            className={`absolute inset-y-4 z-10 overflow-hidden border-l-2 transition-all cursor-default backdrop-blur-[2px] ${
                              isPast
                                ? ""
                                : "hover:translate-y-[-1px] hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]"
                            }`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              ...(isPast
                                ? {
                                    backgroundColor: `${PAST_GREEN}1F`,
                                    borderLeftColor: PAST_GREEN,
                                    color: PAST_GREEN,
                                  }
                                : color
                                  ? {
                                      backgroundColor: `${color}14`,
                                      borderLeftColor: color,
                                      color,
                                    }
                                  : {}),
                            }}
                          >
                            <div className="relative px-4 py-2 h-full flex flex-col justify-center gap-1">
                              <div className="flex items-center gap-2">
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: sceneDot }}
                                  title={sceneKey}
                                />
                                {isActive && (
                                  <span
                                    className="h-1 w-1 rounded-full shrink-0 animate-pulse"
                                    style={{ backgroundColor: isPast ? PAST_GREEN : (color ?? "hsl(var(--gold))") }}
                                  />
                                )}
                                <p
                                  className={`font-serif text-[12px] truncate tracking-[0.08em] ${
                                    isPast ? "" : isDone ? "text-muted-foreground" : "text-foreground"
                                  }`}
                                  style={isPast ? { color: PAST_GREEN } : undefined}
                                >
                                  {task.title}
                                </p>
                              </div>
                              <p className="text-[9px] truncate text-muted-foreground/80 uppercase tracking-[0.22em]">
                                {dur < 1 ? `${Math.round(dur * 24)}h` : `${dur} day${dur === 1 ? "" : "s"}`} · {task.status.replace("_", " ")}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {lanes === 0 && (
                <div className="py-20 text-center text-sm text-muted-foreground">
                  No active lanes — use Manage lanes above to add capacity.
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => {
            const lastProj = localStorage.getItem("lastTaskProjectId") || "";
            const validLast = projects.some((p) => p.id === lastProj) ? lastProj : "";
            const defaultProj =
              validLast || (projects.length === 1 ? projects[0].id : "");
            setNewTask((p) => ({ ...p, projectId: defaultProj }));
            setTaskFiles([]);
            setAddOpen(true);
          }}
          className="group inline-flex items-center gap-3 px-10 py-3.5 border border-gold bg-transparent text-gold hover:bg-[#1C1A17] transition-all rounded-sm"
        >
          <Plus className="h-3.5 w-3.5 transition-transform group-hover:rotate-90" />
          <span className="font-serif text-[11px] uppercase tracking-[0.32em]">
            New task
          </span>
        </button>
      </div>


      {/* Pending requests queue */}
      {(() => {
        const pending = tasks.filter((t) => t.lane_index == null);
        if (pending.length === 0) return null;
        return (
          <div className="mt-8 rounded-sm border border-border/60 bg-card overflow-hidden">
            <header className="px-8 py-4 border-b border-border/60 flex items-center gap-3">
              <span className="text-[9px] uppercase tracking-[0.42em] text-[hsl(var(--gold))]">
                Pending requests
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                ({pending.length}) — awaiting validation
              </span>
            </header>
            <ul className="divide-y divide-border/40">
              {pending.map((t) => (
                <li
                  key={t.id}
                  className="px-8 py-4 flex items-center gap-6"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-[14px] text-foreground truncate">
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {t.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60">
                      Requested delivery
                    </p>
                    <p className="text-xs text-foreground mt-1">
                      {t.requested_delivery_date
                        ? format(parseISO(t.requested_delivery_date), "MMM d, yyyy")
                        : "—"}
                    </p>
                  </div>
                  <div className="text-right shrink-0 w-32">
                    <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60">
                      Project
                    </p>
                    <p className="text-xs text-foreground mt-1 truncate">
                      {projects.find((p) => p.id === t.project_id)?.name ?? "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Hover tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "fixed",
              left: Math.min(
                window.innerWidth - 320,
                Math.max(16, hovered.rect.left + hovered.rect.width / 2 - 160),
              ),
              top:
                hovered.rect.top < 320
                  ? hovered.rect.bottom + 12
                  : hovered.rect.top - 12,
              transform: hovered.rect.top < 320 ? undefined : "translateY(-100%)",
              zIndex: 9999,
              pointerEvents: "auto",
            }}
            className="w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden"
            onMouseLeave={() => setHovered(null)}
          >
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--gold))]">
                Task · Lane {hovered.task.lane_index?.toString().padStart(2, "0") ?? "—"}
              </span>
              <button
                onClick={() => deleteTask(hovered.task.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Delete task"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
              <h4 className="font-serif text-base text-foreground">{hovered.task.title}</h4>
              {hovered.task.description && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {hovered.task.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Start
                  </p>
                  <p className="text-xs text-foreground mt-1">
                    {hovered.task.start_date
                      ? format(parseISO(hovered.task.start_date), "MMM d, yyyy")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Duration
                  </p>
                  <p className="text-xs text-foreground mt-1">
                    {hovered.task.duration_days ?? 1} day
                    {(hovered.task.duration_days ?? 1) === 1 ? "" : "s"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Status
                  </p>
                  <p className="text-xs text-foreground mt-1 capitalize">
                    {hovered.task.status.replace("_", " ")}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Project
                  </p>
                  <p className="text-xs text-foreground mt-1 truncate">
                    {projects.find((p) => p.id === hovered.task.project_id)?.name ?? "—"}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Task Request Modal */}
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          if (!o) {
            setAddOpen(false);
            setInteractionMode(null);
            setSketchDataUrl(null);
          }
        }}
      >
        <DialogContent
          className="z-[100] max-w-2xl gap-0 border-0 p-0 bg-transparent shadow-none"
        >
          <div
            className="p-10 rounded-[4px] max-h-[90vh] overflow-y-auto"
            style={{
              background: "#1A1814",
              border: "0.5px solid rgba(255,255,255,0.08)",
            }}
          >
            <p
              className="font-serif"
              style={{
                fontSize: "1.8rem",
                fontWeight: 400,
                color: "rgba(255,255,255,0.95)",
                letterSpacing: "0.02em",
              }}
            >
              New task
            </p>

            <div className="mt-8 space-y-0">
              {/* Project */}
              <div>
                <label
                  className="block uppercase"
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    color: "#8C8880",
                    marginBottom: "10px",
                  }}
                >
                  Project
                </label>
                <div className="relative">
                  <select
                    value={newTask.projectId}
                    onChange={(e) =>
                      setNewTask((p) => ({ ...p, projectId: e.target.value }))
                    }
                    className="w-full bg-transparent border-0 outline-none focus:ring-0 appearance-none cursor-pointer"
                    style={{
                      borderBottom: "0.5px solid rgba(255,255,255,0.15)",
                      borderRadius: 0,
                      color: "white",
                      fontWeight: 300,
                      fontSize: "13px",
                      padding: "8px 0",
                      paddingRight: "20px",
                    }}
                  >
                    <option value="" style={{ background: "#1A1814" }}>
                      No project
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} style={{ background: "#1A1814" }}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2"
                    style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px" }}
                  >
                    ▾
                  </span>
                </div>
              </div>

              {/* Scene */}
              <AnimatePresence initial={false}>
              {newTask.projectId && (
                <motion.div
                  key="scene-field"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: "hidden" }}
                >
                <div style={{ marginTop: "32px" }}>
                  <label
                    className="block uppercase"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.2em",
                      color: "#8C8880",
                      marginBottom: "10px",
                    }}
                  >
                    Scene
                  </label>
                  <div className="relative">
                    <select
                      value={newTask.sceneId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNewTask((p) => ({ ...p, sceneId: id }));
                        const thumb = projectScenes.find((s) => s.id === id)?.thumbnailUrl || null;
                        setSceneThumbnail(thumb);
                        setSketchDataUrl(null);
                      }}
                      className="w-full bg-transparent border-0 outline-none focus:ring-0 appearance-none cursor-pointer"
                      style={{
                        borderBottom: "0.5px solid rgba(255,255,255,0.15)",
                        borderRadius: 0,
                        color: "white",
                        fontWeight: 300,
                        fontSize: "13px",
                        padding: "8px 0",
                        paddingRight: "20px",
                      }}
                    >
                      <option value="" style={{ background: "#1A1814" }}>
                        No specific scene
                      </option>
                      {projectScenes.map((s) => (
                        <option key={s.id} value={s.id} style={{ background: "#1A1814" }}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2"
                      style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px" }}
                    >
                      ▾
                    </span>
                  </div>
                </div>
                </motion.div>
              )}
              </AnimatePresence>

              {/* Scene thumbnail preview (no overlay tooltip) */}
              <AnimatePresence initial={false}>
                {newTask.sceneId && sceneThumbnail && (
                  <motion.div
                    key="thumb"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ marginTop: "32px", position: "relative" }}>
                      <img
                        src={sketchDataUrl || sceneThumbnail}
                        alt="Scene preview — click to annotate"
                        onClick={() => {
                          setInteractionMode("annotate");
                          setSketchOpen(true);
                        }}
                        className="w-full object-cover cursor-zoom-in"
                        style={{
                          maxHeight: 220,
                          objectPosition: "center",
                          display: "block",
                          borderRadius: 4,
                          border: "0.5px solid rgba(255,255,255,0.08)",
                        }}
                      />
                      {sketchDataUrl && (
                        <button
                          type="button"
                          onClick={() => setSketchDataUrl(null)}
                          className="absolute top-2 right-2 p-1 text-white/50 hover:text-white transition-colors"
                          title="Remove annotation"
                          style={{ background: "rgba(0,0,0,0.4)", borderRadius: 2 }}
                        >
                          <X size={11} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>

                    {/* Mode selector */}
                    <div className="grid grid-cols-3 gap-2" style={{ marginTop: "20px" }}>
                      {([
                        { key: "annotate", label: "Annotate" },
                        { key: "dictate", label: "Dictate" },
                        { key: "type", label: "Type" },
                      ] as const).map((m) => {
                        const active = interactionMode === m.key;
                        const hasContent =
                          (m.key === "annotate" && !!sketchDataUrl) ||
                          (m.key === "dictate" && (isRecording || isPolishing || !!newTask.description.trim())) ||
                          (m.key === "type" && (!!newTask.title.trim() || !!newTask.description.trim()));
                        return (
                          <motion.button
                            key={m.key}
                            type="button"
                            onClick={() => {
                              if (m.key === "annotate") {
                                setInteractionMode("annotate");
                                setSketchOpen(true);
                              } else if (m.key === "dictate") {
                                setInteractionMode("dictate");
                              } else {
                                setInteractionMode("type");
                                setTimeout(() => {
                                  const el = document.getElementById("new-task-title-input") as HTMLInputElement | null;
                                  el?.focus();
                                }, 50);
                              }
                            }}
                            whileHover={{
                              scale: 1.02,
                              boxShadow: active
                                ? "0 0 0 1px hsl(var(--gold)), inset 0 0 14px hsl(var(--gold) / 0.25)"
                                : "0 0 0 1px hsl(var(--gold) / 0.7), inset 0 0 12px hsl(var(--gold) / 0.12)",
                            }}
                            whileTap={{ scale: 0.99 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                            className="uppercase font-serif"
                            style={{
                              fontSize: "10px",
                              letterSpacing: "0.28em",
                              padding: "12px 0",
                              background: "transparent",
                              color: active ? "hsl(var(--gold))" : hasContent ? "hsl(var(--gold))" : "rgba(255,255,255,0.6)",
                              border: `${active ? "1px" : "0.5px"} solid ${active ? "hsl(var(--gold))" : hasContent ? "hsl(var(--gold) / 0.5)" : "rgba(255,255,255,0.18)"}`,
                              borderRadius: 2,
                              boxShadow: active ? "inset 0 0 18px hsl(var(--gold) / 0.2)" : "none",
                            }}
                          >
                            {m.label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Dictate panel */}
              <AnimatePresence initial={false}>
                {interactionMode === "dictate" && (
                  <motion.div
                    key="dictate-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div
                      style={{
                        marginTop: "20px",
                        padding: "20px",
                        border: "0.5px solid rgba(255,255,255,0.1)",
                        borderRadius: 2,
                        textAlign: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={isRecording ? stopDictation : startDictation}
                        disabled={isPolishing}
                        className="inline-flex items-center gap-3 transition-all"
                        style={{
                          padding: "10px 24px",
                          background: isRecording ? "rgba(224,79,79,0.12)" : "transparent",
                          border: `0.5px solid ${isRecording ? "rgba(224,79,79,0.6)" : "hsl(var(--gold) / 0.5)"}`,
                          color: isRecording ? "#E04F4F" : "hsl(var(--gold))",
                          borderRadius: 2,
                          opacity: isPolishing ? 0.5 : 1,
                        }}
                      >
                        <span className="font-serif uppercase" style={{ fontSize: "10px", letterSpacing: "0.28em" }}>
                          {isPolishing ? "Polishing…" : isRecording ? "■ Stop recording" : "● Start recording"}
                        </span>
                      </button>
                      {newTask.description && !isRecording && !isPolishing && (
                        <p
                          className="mt-4 text-left"
                          style={{
                            fontSize: "12px",
                            color: "rgba(255,255,255,0.7)",
                            fontWeight: 300,
                            lineHeight: 1.6,
                          }}
                        >
                          {newTask.description}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Type panel */}
              <AnimatePresence initial={false}>
                {interactionMode === "type" && (
                  <motion.div
                    key="type-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ marginTop: "24px" }}>
                      <label
                        className="block uppercase"
                        style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#8C8880", marginBottom: "10px" }}
                      >
                        Title
                      </label>
                      <input
                        id="new-task-title-input"
                        value={newTask.title}
                        onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
                        className="w-full bg-transparent border-0 outline-none focus:ring-0"
                        style={{
                          borderBottom: "0.5px solid rgba(255,255,255,0.15)",
                          borderRadius: 0,
                          color: "white",
                          fontWeight: 300,
                          fontSize: "13px",
                          padding: "8px 0",
                        }}
                      />
                    </div>
                    <div style={{ marginTop: "24px" }}>
                      <label
                        className="block uppercase"
                        style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#8C8880", marginBottom: "10px" }}
                      >
                        Brief / details
                      </label>
                      <textarea
                        ref={briefRef}
                        value={newTask.description}
                        onChange={(e) => {
                          setNewTask((p) => ({ ...p, description: e.target.value }));
                          e.currentTarget.style.height = "auto";
                          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
                        }}
                        rows={1}
                        className="w-full bg-transparent border-0 outline-none focus:ring-0 resize-none overflow-hidden"
                        style={{
                          borderBottom: "0.5px solid rgba(255,255,255,0.15)",
                          borderRadius: 0,
                          color: "white",
                          fontWeight: 300,
                          fontSize: "13px",
                          padding: "8px 0",
                          minHeight: "32px",
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Attachments dropzone */}
              <div style={{ marginTop: "32px" }}>
                <label
                  className="block uppercase"
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    color: "#8C8880",
                    marginBottom: "10px",
                  }}
                >
                  Attachments
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const files = Array.from(e.dataTransfer.files);
                    setTaskFiles((prev) => [...prev, ...files]);
                  }}
                  onClick={() =>
                    document.getElementById("task-file-input")?.click()
                  }
                  className="cursor-pointer text-center transition-colors"
                  style={{
                    border: dragActive
                      ? "0.5px dashed rgba(200,184,154,0.6)"
                      : "0.5px dashed rgba(255,255,255,0.15)",
                    padding: "18px",
                    borderRadius: "2px",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: "11px",
                    letterSpacing: "0.05em",
                  }}
                >
                  Drop files here, or click to browse
                </div>
                <input
                  id="task-file-input"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setTaskFiles((prev) => [...prev, ...files]);
                    e.target.value = "";
                  }}
                />
                {taskFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {taskFiles.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between"
                        style={{
                          fontSize: "11px",
                          color: "rgba(255,255,255,0.65)",
                          padding: "4px 0",
                          borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <span className="truncate pr-3">{f.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setTaskFiles((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
                          style={{
                            color: "rgba(255,255,255,0.3)",
                            fontSize: "11px",
                            background: "transparent",
                            border: "none",
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Delivery date */}
              <div
                style={{ marginTop: "32px", cursor: "pointer" }}
                onClick={(e) => {
                  const input = e.currentTarget.querySelector(
                    'input[type="date"]',
                  ) as (HTMLInputElement & { showPicker?: () => void }) | null;
                  if (!input) return;
                  if (typeof input.showPicker === "function") input.showPicker();
                  else input.focus();
                }}
              >
                <label
                  className="block uppercase"
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    color: "#8C8880",
                    marginBottom: "10px",
                    cursor: "pointer",
                  }}
                >
                  Delivery date
                </label>
                <input
                  type="date"
                  value={newTask.requestedDeliveryDate}
                  onChange={(e) =>
                    setNewTask((p) => ({
                      ...p,
                      requestedDeliveryDate: e.target.value,
                    }))
                  }
                  onClick={(e) => {
                    const input = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                    if (typeof input.showPicker === "function") input.showPicker();
                  }}
                  className="block w-full bg-transparent border-0 outline-none focus:ring-0 cursor-pointer"
                  style={{
                    borderBottom: "0.5px solid rgba(255,255,255,0.15)",
                    borderRadius: 0,
                    color: "white",
                    fontWeight: 300,
                    fontSize: "13px",
                    padding: "8px 0",
                    colorScheme: "dark",
                    width: "100%",
                  }}
                />
              </div>
            </div>

            <div
              className="flex items-center justify-end gap-2"
              style={{ marginTop: "32px" }}
            >
              <button
                onClick={() => setAddOpen(false)}
                className="uppercase"
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.35)",
                  padding: "12px 24px",
                  background: "transparent",
                  border: "none",
                }}
              >
                Cancel
              </button>
              {(() => {
                const isValid =
                  !!sketchDataUrl ||
                  !!newTask.title.trim() ||
                  !!newTask.description.trim();
                return (
                  <motion.button
                    onClick={submitTask}
                    disabled={uploadingFiles || !isValid}
                    whileHover={!isValid ? { scale: 1.01, boxShadow: "inset 0 0 12px hsl(var(--gold) / 0.15)" } : { scale: 1.02 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="uppercase disabled:opacity-40"
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.2em",
                      background: isValid ? "#C8B89A" : "transparent",
                      color: isValid ? "#1A1814" : "hsl(var(--gold))",
                      padding: "12px 24px",
                      borderRadius: "2px",
                      border: isValid ? "none" : "0.5px solid hsl(var(--gold) / 0.5)",
                    }}
                  >
                    {uploadingFiles ? "Uploading…" : "Request"}
                  </motion.button>
                );
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sketch overlay — uses the same Lightbox tool as the round view so
          improvements made there automatically flow into the request popup. */}
      {sketchOpen && sceneThumbnail && (
        <Lightbox
          src={sketchDataUrl || sceneThumbnail}
          alt="Annotate scene"
          assetId={null}
          sceneRoundId=""
          roundNumber={0}
          sceneName=""
          ephemeral
          onSaveAnnotation={(dataUrl) => setSketchDataUrl(dataUrl)}
          onClose={() => setSketchOpen(false)}
          saveLabel="Save annotation"
        />
      )}

      {/* Production Plan Modal */}
      <AnimatePresence>
        {lanesPlanOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLanesPlanOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-6xl bg-card/80 backdrop-blur-2xl border border-[hsl(var(--gold))]/20 rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="px-8 md:px-12 py-8 border-b border-border/60 flex justify-between items-start gap-6 bg-gradient-to-b from-[hsl(var(--gold))]/[0.04] to-transparent">
                <div>
                  <p className="font-serif text-[10px] tracking-[0.4em] text-[hsl(var(--gold))] uppercase">
                    Studio Portal
                  </p>
                  <h2 className="mt-3 font-serif text-3xl tracking-tight">Change Production Plan</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Select the capacity that matches your studio's current workload.
                  </p>
                </div>
                <button
                  onClick={() => setLanesPlanOpen(false)}
                  className="w-10 h-10 rounded-full border border-border/60 flex items-center justify-center hover:border-[hsl(var(--gold))]/50 hover:text-[hsl(var(--gold))] transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-8 md:px-12 py-10">
                <div className="flex gap-5 overflow-x-auto pb-6 -mx-2 px-2">
                  {(() => {
                    let runningTotal = 0;
                    return LANE_PRICES_PENCE.map((costPence, i) => {
                      const cost = costPence / 100;
                      const lCount = i + 1;
                      runningTotal += cost;
                      const isCurrent = lCount === lanes;
                      const isUpcoming = lCount > lanes;
                      return (
                        <div
                          key={lCount}
                          className={`group relative p-6 rounded-sm border transition-all flex flex-col w-[260px] shrink-0 ${
                            isCurrent
                              ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/[0.06] shadow-xl shadow-[hsl(var(--gold))]/10"
                              : isUpcoming
                                ? "border-[hsl(var(--gold))]/15 bg-[hsl(var(--gold))]/[0.02] hover:border-[hsl(var(--gold))]/40"
                                : "border-border/70 hover:border-[hsl(var(--gold))]/40 bg-card/40"
                          }`}
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div
                              className={`w-12 h-12 rounded-sm flex items-center justify-center font-serif text-xl ${
                                isCurrent
                                  ? "bg-[hsl(var(--gold))] text-background"
                                  : "bg-muted/40 text-foreground"
                              }`}
                            >
                              {lCount.toString().padStart(2, "0")}
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              {isCurrent && (
                                <span className="px-2.5 py-1 bg-[hsl(var(--gold))] text-background text-[9px] font-semibold uppercase tracking-[0.2em] rounded-full">
                                  Current
                                </span>
                              )}
                              {isUpcoming && (
                                <span className="px-2.5 py-1 border border-[hsl(var(--gold))]/40 text-[hsl(var(--gold))] text-[9px] font-semibold uppercase tracking-[0.2em] rounded-full">
                                  Expansion
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mb-6">
                            <h4 className="font-serif text-lg tracking-tight">
                              {lCount === 1 ? "Active Lane" : "Active Lanes"}
                            </h4>
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                              Capacity for {lCount} {lCount === 1 ? "task" : "tasks"} at one time.
                            </p>
                          </div>

                          <div className="space-y-2 pt-4 border-t border-border/50">
                            <div className="flex justify-between text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 px-1 mb-1">
                              <span>Lane</span>
                              <span>Cost / Month</span>
                            </div>
                            <div className="space-y-0.5">
                              {LANE_PRICES_PENCE.map((lp, idx) => {
                                const lNum = idx + 1;
                                const isActive = lNum <= lCount;
                                return (
                                  <div
                                    key={lNum}
                                    className={`flex justify-between px-2.5 py-1.5 rounded-sm transition-colors ${
                                      isActive
                                        ? "text-foreground font-medium bg-muted/30"
                                        : "text-muted-foreground/30"
                                    }`}
                                  >
                                    <span className="text-[10px] tabular-nums">Lane {lNum.toString().padStart(2, "0")}</span>
                                    <span className="text-[10px] tabular-nums">£{(lp / 100).toLocaleString()}</span>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="pt-4 mt-3 border-t border-border/50">
                              <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-[0.2em] mb-1">
                                Total / Month
                              </p>
                              <div className="flex items-baseline gap-1">
                                <span className="font-serif text-2xl tabular-nums">£{runningTotal.toLocaleString()}</span>
                                <span className="text-muted-foreground text-[10px]">/mo</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-6">
                            <button
                              disabled={isCurrent}
                              onClick={() => {
                                requestLaneChange(lCount);
                                setLanesPlanOpen(false);
                              }}
                              className={`w-full py-3 rounded-sm text-[10px] font-semibold uppercase tracking-[0.25em] transition-all ${
                                isCurrent
                                  ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
                                  : "border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
                              }`}
                            >
                              {isCurrent ? "Selected" : "Select Plan"}
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Footer */}
              <div className="px-8 md:px-12 py-5 border-t border-border/60 bg-gradient-to-t from-[hsl(var(--gold))]/[0.04] to-transparent flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  Each Lane is priced individually. Adding a new Lane does not change the cost of existing Lanes.
                </p>
                <a
                  href="mailto:studio@silvershadow.co"
                  className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[hsl(var(--gold))] hover:text-[hsl(var(--gold))]/80 transition-colors"
                >
                  Need more lanes? Contact us
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lane change confirmation */}
      <AnimatePresence>
        {laneChangeConfirm && sub && (() => {
          const today = new Date();
          const newCount = laneChangeConfirm.targetCount;
          const isIncrease = laneChangeConfirm.type === "increase";
          const nextFirst = new Date(today.getFullYear(), today.getMonth() + 1, 1);
          const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          const daysRemaining = Math.max(1, daysInMonth - today.getDate() + 1);
          const addedLanesCostPence = isIncrease
            ? LANE_PRICES_PENCE.slice(lanes, newCount).reduce((a, b) => a + b, 0)
            : 0;
          const prorataPence = Math.round((addedLanesCostPence * daysRemaining) / daysInMonth);
          const newMonthlyPence = LANE_PRICES_PENCE.slice(0, newCount).reduce((a, b) => a + b, 0);
          const noticeEnd = new Date(today);
          noticeEnd.setDate(noticeEnd.getDate() + 30);
          const effectiveDate = new Date(noticeEnd.getFullYear(), noticeEnd.getMonth() + 1, 1);
          const closeDate = new Date(effectiveDate.getTime() - 86400000);
          const removedLaneNumber = lanes;

          return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setLaneChangeConfirm(null)}
                className="absolute inset-0 bg-black/70 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full max-w-xl bg-card/85 backdrop-blur-2xl border border-[hsl(var(--gold))]/25 rounded-sm shadow-2xl overflow-hidden"
              >
                <div className="px-8 py-7 border-b border-border/60 bg-gradient-to-b from-[hsl(var(--gold))]/[0.05] to-transparent">
                  <p className="font-serif text-[9px] tracking-[0.4em] text-[hsl(var(--gold))] uppercase">
                    {isIncrease ? "Confirm Expansion" : "Lane Reduction"}
                  </p>
                  <h3 className="mt-2 font-serif text-2xl tracking-tight">
                    {lanes} → {newCount} Active Lane{newCount === 1 ? "" : "s"}
                  </h3>
                </div>

                <div className="px-8 py-7 space-y-5 text-sm leading-relaxed">
                  {isIncrease ? (
                    <>
                      <p className="text-foreground">
                        Your subscription renews on the <span className="text-[hsl(var(--gold))]">1st of each month</span>. Adding {newCount - lanes} lane{newCount - lanes === 1 ? "" : "s"} today, you will be charged a pro-rata amount for the remainder of the current period.
                      </p>
                      <div className="rounded-sm border border-border/60 divide-y divide-border/60 bg-muted/20">
                        <Row label="Charged today (pro-rata)" value={`£${(prorataPence / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} accent />
                        <Row label="Period covered" value={`${format(today, "d MMM yyyy")} → ${format(new Date(nextFirst.getTime() - 86400000), "d MMM yyyy")}`} />
                        <Row label="Days billed" value={`${daysRemaining} of ${daysInMonth}`} />
                        <Row label={`Renews on ${format(nextFirst, "d MMMM yyyy")}`} value={`£${(newMonthlyPence / 100).toLocaleString()}`} accent />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        From {format(nextFirst, "d MMMM yyyy")} onward your subscription renews at £{(newMonthlyPence / 100).toLocaleString()}/month for {newCount} active lanes.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-foreground">
                        Your instruction has been taken into account. A <span className="text-[hsl(var(--gold))]">30-day notice period</span> applies to lane reductions.
                      </p>
                      <div className="rounded-sm border border-border/60 divide-y divide-border/60 bg-muted/20">
                        <Row label={`Lane ${removedLaneNumber.toString().padStart(2, "0")} closes on`} value={format(closeDate, "EEEE, d MMMM yyyy")} accent />
                        <Row label="New plan effective" value={format(effectiveDate, "d MMMM yyyy")} />
                        <Row label="New monthly subscription" value={`£${(newMonthlyPence / 100).toLocaleString()}`} accent />
                      </div>
                      <p className="text-xs text-muted-foreground italic">
                        The lane remains fully active through the end and we will continue progressing work as normal in the meantime. Please do not hesitate to send through anything you would like us to work on during this period.
                      </p>
                    </>
                  )}
                </div>

                <div className="px-8 py-5 border-t border-border/60 flex items-center justify-end gap-3 bg-gradient-to-t from-[hsl(var(--gold))]/[0.04] to-transparent">
                  <button
                    onClick={() => setLaneChangeConfirm(null)}
                    className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (isIncrease) await applyLaneIncrease(newCount);
                      else await applyLaneDecrease(newCount, effectiveDate);
                      setLaneChangeConfirm(null);
                    }}
                    className="px-6 py-2.5 rounded-sm border border-gold bg-transparent text-gold text-[10px] font-semibold uppercase tracking-[0.25em] hover:bg-[#1C1A17] transition-all"
                  >
                    {isIncrease ? "Confirm & Pay Pro-rata" : "Confirm Reduction"}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </ClientLayout>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className={`text-sm tabular-nums ${accent ? "text-[hsl(var(--gold))] font-medium" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
