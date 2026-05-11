import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { addDays, format, isWeekend } from "date-fns";
import { X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Lightbox } from "@/components/client/AssetViewer";

interface Project {
  id: string;
  name: string;
}
interface Scene {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

type Mode = "annotate" | "dictate" | "type" | null;

const GLASS_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "0.5px solid hsl(var(--gold) / 0.25)",
  color: "white",
  fontWeight: 300,
  fontSize: 13,
  padding: "10px 12px",
  borderRadius: 2,
  outline: "none",
  width: "100%",
};

export default function NewTask() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectScenes, setProjectScenes] = useState<Scene[]>([]);

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    projectId: searchParams.get("projectId") || "",
    sceneId: searchParams.get("sceneId") || "",
    requestedDeliveryDate: "",
  });
  const [sceneThumbnail, setSceneThumbnail] = useState<string | null>(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [sketchDataUrl, setSketchDataUrl] = useState<string | null>(null);
  const [pins, setPins] = useState<{ x: number; y: number }[]>([]);
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [interactionMode, setInteractionMode] = useState<Mode>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  // Resolve accountId
  useEffect(() => {
    if (!user) return;
    supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.account_id && setAccountId(data.account_id));
  }, [user]);

  // Load projects
  useEffect(() => {
    if (!accountId) return;
    supabase
      .from("projects")
      .select("id, name")
      .eq("account_id", accountId)
      .is("archived_at", null)
      .then(({ data }) => {
        const list = (data as Project[]) ?? [];
        setProjects(list);
        if (!newTask.projectId) {
          const last = localStorage.getItem("lastTaskProjectId") || "";
          const valid = list.some((p) => p.id === last) ? last : "";
          const def = valid || (list.length === 1 ? list[0].id : "");
          if (def) setNewTask((p) => ({ ...p, projectId: def }));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Load scenes + thumbnails for the selected project
  useEffect(() => {
    if (!newTask.projectId) {
      setProjectScenes([]);
      setSceneThumbnail(null);
      return;
    }
    supabase
      .from("scenes")
      .select("id, name")
      .eq("project_id", newTask.projectId)
      .order("name")
      .then(async ({ data }) => {
        const scenes = (data as Scene[]) || [];
        const withThumbs = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const { data: rounds } = await supabase
                .from("scene_rounds")
                .select("id, round_number")
                .eq("scene_id", scene.id)
                .order("round_number", { ascending: false })
                .limit(1);
              if (!rounds?.length) return scene;
              const { data: assets } = await supabase
                .from("round_assets")
                .select("storage_path, created_at")
                .eq("scene_round_id", rounds[0].id)
                .eq("is_current", true)
                .eq("source", "upload")
                .not("storage_path", "is", null)
                .order("created_at", { ascending: false })
                .limit(1);
              if (!assets?.length) return scene;
              const path = String(assets[0].storage_path).replace(/^\/+/, "");
              const { data: urlData } = supabase.storage
                .from("round-uploads")
                .getPublicUrl(path);
              return { ...scene, thumbnailUrl: urlData.publicUrl };
            } catch {
              return scene;
            }
          }),
        );
        setProjectScenes(withThumbs);
        const lastScene =
          localStorage.getItem("lastTaskSceneId_" + newTask.projectId) || "";
        const validLast = withThumbs.some((s) => s.id === lastScene) ? lastScene : "";
        const def =
          newTask.sceneId && withThumbs.some((s) => s.id === newTask.sceneId)
            ? newTask.sceneId
            : validLast || (withThumbs[0]?.id ?? "");
        setNewTask((p) => ({ ...p, sceneId: def }));
        const thumb = withThumbs.find((s) => s.id === def)?.thumbnailUrl || null;
        setSceneThumbnail(thumb);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTask.projectId]);

  // Auto-grow textarea
  useEffect(() => {
    const el = briefRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [newTask.description, interactionMode]);

  // Dictation
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
          typeof data.deliveryDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(data.deliveryDate)
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
      }
    } catch (e) {
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      toast.error(
        err?.name === "NotAllowedError"
          ? "Microphone access blocked."
          : "Could not access microphone",
      );
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    transcriptRef.current = "";
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + " ";
      transcriptRef.current = t;
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => {
      setIsRecording(false);
      const t = transcriptRef.current.trim();
      if (t) polishDictation(t);
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

  // Date scroller — next 21 weekdays
  const dateOptions = useMemo(() => {
    const out: { date: Date; iso: string }[] = [];
    let d = addDays(new Date(), 1);
    while (out.length < 28) {
      if (!isWeekend(d)) out.push({ date: d, iso: format(d, "yyyy-MM-dd") });
      d = addDays(d, 1);
    }
    return out;
  }, []);

  // Submit
  const submit = async () => {
    if (!accountId || !user) return;
    const hasAnnotate = !!sketchDataUrl || pins.length > 0;
    const hasContent =
      hasAnnotate || !!newTask.title.trim() || !!newTask.description.trim();
    if (!hasContent) return;
    setUploadingFiles(true);

    const allFiles = [...taskFiles];
    if (sketchDataUrl) {
      const res = await fetch(sketchDataUrl);
      const blob = await res.blob();
      allFiles.unshift(
        new File([blob], "sketch-annotation.png", { type: "image/png" }),
      );
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

    let description = newTask.description.trim();
    if (pins.length > 0) {
      const pinNote = `\n\nAnnotation pins: ${pins
        .map((p, i) => `#${i + 1} (${p.x.toFixed(1)}%, ${p.y.toFixed(1)}%)`)
        .join(", ")}`;
      description = description ? description + pinNote : pinNote.trim();
    }

    const { error } = await supabase.from("lane_tasks").insert({
      account_id: accountId,
      lane_index: null,
      position: null,
      title:
        newTask.title.trim() ||
        (hasAnnotate ? "Annotated request" : "New request"),
      description: description || null,
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
    if (newTask.projectId)
      localStorage.setItem("lastTaskProjectId", newTask.projectId);
    if (newTask.sceneId && newTask.projectId)
      localStorage.setItem("lastTaskSceneId_" + newTask.projectId, newTask.sceneId);
    toast.success("Request sent for review");
    navigate(-1);
  };

  const projectName =
    projects.find((p) => p.id === newTask.projectId)?.name || "Untitled";

  const isValid =
    !!sketchDataUrl ||
    pins.length > 0 ||
    !!newTask.title.trim() ||
    !!newTask.description.trim();

  // Click-to-pin on hero
  const onHeroClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactionMode !== "annotate") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setPins((prev) => [...prev, { x, y }]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[80] grid grid-cols-1 md:grid-cols-5"
      style={{ background: "#121110" }}
    >
      {/* Left: hero */}
      <div className="relative md:col-span-3 overflow-hidden bg-black">
        {sceneThumbnail ? (
          <div
            ref={heroRef}
            onClick={onHeroClick}
            className={`absolute inset-0 ${interactionMode === "annotate" ? "cursor-crosshair" : "cursor-default"}`}
          >
            <img
              src={sketchDataUrl || sceneThumbnail}
              alt={projectName}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            {/* Vignette */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)",
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow:
                  "inset 0 0 180px 30px rgba(0,0,0,0.55)",
              }}
            />
            {/* Pins */}
            {pins.map((p, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  transform: "translate(-50%, -100%)",
                  pointerEvents: "none",
                }}
              >
                <MapPin
                  className="text-[hsl(var(--gold))]"
                  size={22}
                  strokeWidth={1.5}
                  style={{ filter: "drop-shadow(0 0 6px hsl(var(--gold) / 0.7))" }}
                  fill="hsl(var(--gold))"
                />
                <div
                  className="absolute -top-1 left-1/2 -translate-x-1/2 font-serif text-[10px]"
                  style={{ color: "#1A1814", transform: "translate(-50%, -110%)" }}
                >
                  {i + 1}
                </div>
              </div>
            ))}
            {pins.length > 0 && interactionMode === "annotate" && (
              <button
                type="button"
                onClick={() => setPins([])}
                className="absolute bottom-6 left-6 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--gold))] hover:text-white"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "0.5px solid hsl(var(--gold) / 0.4)",
                  borderRadius: 2,
                  backdropFilter: "blur(8px)",
                }}
              >
                Clear pins
              </button>
            )}
            {interactionMode === "annotate" && (
              <button
                type="button"
                onClick={() => setSketchOpen(true)}
                className="absolute bottom-6 right-6 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-[hsl(var(--gold))] hover:text-white"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: "0.5px solid hsl(var(--gold) / 0.4)",
                  borderRadius: 2,
                  backdropFilter: "blur(8px)",
                }}
              >
                Open precise annotator
              </button>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs uppercase tracking-[0.3em]">
            Select a scene
          </div>
        )}
      </div>

      {/* Right: form */}
      <div
        className="relative md:col-span-2 overflow-y-auto"
        style={{ background: "#121110" }}
      >
        {/* Close */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="absolute top-6 right-6 z-10 p-2 text-[hsl(var(--gold))]/55 hover:text-[hsl(var(--gold))] transition-colors"
        >
          <X size={18} strokeWidth={1.25} />
        </button>

        <div className="px-10 py-14 md:px-14 md:py-16">
          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px w-8 bg-[hsl(var(--gold))]/60" />
            <span className="text-[9px] uppercase tracking-[0.42em] text-[hsl(var(--gold))]">
              Request
            </span>
          </div>

          {/* Title */}
          <h1 className="font-serif text-4xl md:text-5xl tracking-[0.04em] text-white font-light">
            New Task
          </h1>
          <p className="mt-3 font-serif text-base tracking-[0.04em] text-white/55">
            {projectName}
          </p>

          {/* Project select */}
          <div className="mt-10">
            <label
              className="block uppercase mb-2"
              style={{
                fontSize: 9,
                letterSpacing: "0.24em",
                color: "#8C8880",
              }}
            >
              Project
            </label>
            <div className="relative">
              <select
                value={newTask.projectId}
                onChange={(e) =>
                  setNewTask((p) => ({ ...p, projectId: e.target.value, sceneId: "" }))
                }
                style={{ ...GLASS_INPUT, appearance: "none", paddingRight: 28, cursor: "pointer" }}
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
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}
              >
                ▾
              </span>
            </div>
          </div>

          {/* Scene select */}
          {newTask.projectId && (
            <div className="mt-6">
              <label
                className="block uppercase mb-2"
                style={{ fontSize: 9, letterSpacing: "0.24em", color: "#8C8880" }}
              >
                Scene
              </label>
              <div className="relative">
                <select
                  value={newTask.sceneId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setNewTask((p) => ({ ...p, sceneId: id }));
                    setSceneThumbnail(
                      projectScenes.find((s) => s.id === id)?.thumbnailUrl || null,
                    );
                    setSketchDataUrl(null);
                    setPins([]);
                  }}
                  style={{ ...GLASS_INPUT, appearance: "none", paddingRight: 28, cursor: "pointer" }}
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
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}
                >
                  ▾
                </span>
              </div>
            </div>
          )}

          {/* Mode triplet */}
          <div className="grid grid-cols-3 gap-2 mt-8">
            {([
              { key: "annotate", label: "Annotate" },
              { key: "dictate", label: "Dictate" },
              { key: "type", label: "Type" },
            ] as const).map((m) => {
              const active = interactionMode === m.key;
              return (
                <motion.button
                  key={m.key}
                  type="button"
                  onClick={() => setInteractionMode(m.key)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.99 }}
                  className="uppercase font-serif"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.28em",
                    padding: "12px 0",
                    background: "transparent",
                    color: active ? "hsl(var(--gold))" : "rgba(255,255,255,0.6)",
                    border: `0.5px solid ${active ? "hsl(var(--gold))" : "hsl(var(--gold) / 0.35)"}`,
                    borderRadius: 2,
                  }}
                >
                  {m.label}
                </motion.button>
              );
            })}
          </div>

          {/* Dictate panel */}
          <AnimatePresence initial={false}>
            {interactionMode === "dictate" && (
              <motion.div
                key="dictate"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: "hidden" }}
              >
                <div
                  className="mt-5 p-5 text-center"
                  style={{
                    border: "0.5px solid hsl(var(--gold) / 0.2)",
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.02)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <button
                    type="button"
                    onClick={isRecording ? stopDictation : startDictation}
                    disabled={isPolishing}
                    className="uppercase"
                    style={{
                      padding: "10px 24px",
                      fontSize: 10,
                      letterSpacing: "0.28em",
                      background: isRecording ? "rgba(224,79,79,0.12)" : "transparent",
                      border: `0.5px solid ${isRecording ? "rgba(224,79,79,0.6)" : "hsl(var(--gold) / 0.5)"}`,
                      color: isRecording ? "#E04F4F" : "hsl(var(--gold))",
                      borderRadius: 2,
                    }}
                  >
                    {isPolishing ? "Polishing…" : isRecording ? "■ Stop recording" : "● Start recording"}
                  </button>
                  {newTask.description && !isRecording && !isPolishing && (
                    <p
                      className="mt-4 text-left"
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.7)",
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

          {/* Title + Brief (always visible when type chosen, or always available) */}
          <div className="mt-6">
            <label
              className="block uppercase mb-2"
              style={{ fontSize: 9, letterSpacing: "0.24em", color: "#8C8880" }}
            >
              Title
            </label>
            <input
              value={newTask.title}
              onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--gold) / 0.8)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--gold) / 0.25)";
              }}
              style={GLASS_INPUT}
            />
          </div>

          <div className="mt-5">
            <label
              className="block uppercase mb-2"
              style={{ fontSize: 9, letterSpacing: "0.24em", color: "#8C8880" }}
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
              rows={3}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--gold) / 0.8)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--gold) / 0.25)";
              }}
              style={{ ...GLASS_INPUT, resize: "none", minHeight: 80 }}
            />
          </div>

          {/* Attachments */}
          <div className="mt-6">
            <label
              className="block uppercase mb-2"
              style={{ fontSize: 9, letterSpacing: "0.24em", color: "#8C8880" }}
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
                document.getElementById("task-file-input-page")?.click()
              }
              className="cursor-pointer text-center transition-colors"
              style={{
                border: dragActive
                  ? "0.5px dashed hsl(var(--gold) / 0.6)"
                  : "0.5px dashed rgba(255,255,255,0.15)",
                padding: 18,
                borderRadius: 2,
                color: "rgba(255,255,255,0.5)",
                fontSize: 11,
              }}
            >
              Drop files here, or click to browse
            </div>
            <input
              id="task-file-input-page"
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
                    className="flex items-center justify-between text-white/65"
                    style={{
                      fontSize: 11,
                      padding: "4px 0",
                      borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className="truncate pr-3">{f.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setTaskFiles((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="text-white/30 hover:text-white"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Delivery date — horizontal scroller */}
          <div className="mt-7">
            <label
              className="block uppercase mb-3"
              style={{ fontSize: 9, letterSpacing: "0.24em", color: "#8C8880" }}
            >
              Delivery date
            </label>
            <div
              className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin"
              style={{ scrollSnapType: "x mandatory" }}
            >
              {dateOptions.map(({ date, iso }) => {
                const active = newTask.requestedDeliveryDate === iso;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() =>
                      setNewTask((p) => ({
                        ...p,
                        requestedDeliveryDate: active ? "" : iso,
                      }))
                    }
                    className="shrink-0 flex flex-col items-center transition-all"
                    style={{
                      minWidth: 56,
                      padding: "10px 6px",
                      borderRadius: 2,
                      border: `0.5px solid ${active ? "hsl(var(--gold))" : "hsl(var(--gold) / 0.2)"}`,
                      background: "transparent",
                      color: active ? "hsl(var(--gold))" : "rgba(255,255,255,0.65)",
                      scrollSnapAlign: "start",
                    }}
                  >
                    <span
                      className="uppercase font-sans"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.18em",
                        opacity: active ? 0.85 : 0.55,
                      }}
                    >
                      {format(date, "EEE")}
                    </span>
                    <span
                      className="font-serif"
                      style={{ fontSize: 18, marginTop: 2 }}
                    >
                      {format(date, "d")}
                    </span>
                    <span
                      className="uppercase font-sans"
                      style={{
                        fontSize: 8,
                        letterSpacing: "0.18em",
                        opacity: active ? 0.85 : 0.45,
                      }}
                    >
                      {format(date, "MMM")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Request */}
          <div className="mt-10 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="uppercase text-white/40 hover:text-white/70"
              style={{
                fontSize: 10,
                letterSpacing: "0.24em",
                padding: "12px 4px",
                background: "transparent",
                border: "none",
              }}
            >
              Cancel
            </button>
            <motion.button
              type="button"
              onClick={submit}
              disabled={uploadingFiles || !isValid}
              whileHover={
                isValid
                  ? {
                      scale: 1.02,
                      boxShadow: "0 0 32px hsl(var(--gold) / 0.5)",
                    }
                  : {}
              }
              whileTap={{ scale: 0.99 }}
              className="uppercase disabled:opacity-40"
              style={{
                fontSize: 11,
                letterSpacing: "0.32em",
                padding: "14px 36px",
                borderRadius: 999,
                background: "transparent",
                color: "hsl(var(--gold))",
                border: "0.5px solid hsl(var(--gold))",
                boxShadow: isValid ? "0 0 24px hsl(var(--gold) / 0.35)" : "none",
                transition: "box-shadow 0.3s ease",
              }}
            >
              {uploadingFiles ? "Uploading…" : "Request"}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Precise annotator (lightbox) */}
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
    </motion.div>
  );
}
