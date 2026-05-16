import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, FileIcon } from "lucide-react";
import { format, differenceInSeconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { computeRoundSchedule } from "@/lib/roundSchedule";

interface UploadedFile {
  file: File;
  uploading: boolean;
  storagePath?: string;
  error?: string;
}

type Category =
  | "floor_plan"
  | "elevations"
  | "rcp"
  | "furniture_schedule"
  | "finishes_schedule"
  | "lighting_plan"
  | "lighting_mood_reference"
  | "models_3d"
  | "cgi_package";

interface NewRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (instructions: string) => void;
  onCreateWithDate?: (instructions: string, deliveryDate: Date, startDate: Date) => void;
  sceneName?: string;
  sceneId?: string;
  roundNumber?: number;
}

function UploadItem({
  label,
  files,
  onFilesAdded,
  onRemoveFile,
}: {
  label: string;
  files: UploadedFile[];
  onFilesAdded: (files: FileList) => void;
  onRemoveFile: (index: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = files.length > 0;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) onFilesAdded(e.dataTransfer.files);
    },
    [onFilesAdded]
  );

  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group flex items-start py-4 border-b cursor-pointer last:border-b-0"
      style={{
        marginLeft: "-3rem", marginRight: "-3rem",
        paddingLeft: active ? "calc(3rem - 3px)" : "3rem", paddingRight: "3rem",
        position: "relative",
        transition: "background 300ms ease",
        borderBottomColor: "#2A2820",
        background: active ? "#252018" : "transparent",
        borderLeft: active ? "3px solid var(--brand-gold, #B89A6A)" : "3px solid transparent",
        boxShadow: active ? "inset 0 0 0 1px rgba(184,154,106,0.15)" : "none",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFilesAdded(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Subtle hover/drag overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderTop: isDragging
            ? "1px solid hsl(var(--gold) / 0.35)"
            : isHovered && !active
            ? "1px solid hsl(var(--foreground) / 0.06)"
            : "1px solid transparent",
          borderBottom: isDragging
            ? "1px solid hsl(var(--gold) / 0.35)"
            : isHovered && !active
            ? "1px solid hsl(var(--foreground) / 0.06)"
            : "1px solid transparent",
          borderLeft: "none",
          borderRight: "none",
          background: isDragging
            ? "hsl(var(--gold) / 0.03)"
            : isHovered && !active
            ? "hsl(var(--foreground) / 0.025)"
            : "transparent",
          transition: "all 500ms ease",
          pointerEvents: "none",
          borderRadius: 0,
        }}
      />

      <div className="flex-1 min-w-0" style={{ position: "relative" }}>
        <div className="flex items-center justify-between gap-3">
          <span
            className={`text-[11px] font-sans uppercase tracking-[0.12em] ${
              active
                ? "text-gold font-medium"
                : isDragging
                ? "text-gold/70"
                : "text-foreground/75"
            }`}
          >
            {label}
          </span>
          {!active && (
            <span
              style={{ transition: "opacity 300ms ease" }}
              className={`text-[9px] font-sans uppercase tracking-[0.2em] shrink-0 ${
                isDragging ? "text-gold/70" : "text-foreground/40"
              }`}
            >
              Drop or click
            </span>
          )}
          {active && (
            <span className="text-[9px] font-sans uppercase tracking-[0.2em] text-gold shrink-0">
              {files.length} file{files.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {files.length > 0 && (
          <div className="mt-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <FileIcon size={10} className="shrink-0 text-foreground/25" />
                <span className="text-[10px] text-foreground/85 truncate flex-1 font-sans">
                  {f.file.name}
                </span>
                {f.uploading && (
                  <div className="h-2.5 w-2.5 animate-spin rounded-full border border-gold border-t-transparent" />
                )}
                {f.error && (
                  <span className="text-[9px] text-destructive uppercase tracking-wider">Error</span>
                )}
                <button
                  onClick={() => onRemoveFile(i)}
                  className="p-0.5 text-foreground/25 hover:text-foreground/60 transition-colors"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-sans font-medium uppercase tracking-[0.3em] text-gold pt-5 pb-1 first:pt-0">
      {children}
    </p>
  );
}

export function NewRoundModal({
  isOpen,
  onClose,
  onCreate,
  onCreateWithDate,
  sceneName,
  sceneId,
  roundNumber = 1,
}: NewRoundModalProps) {
  const [instructions, setInstructions] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [filesByCategory, setFilesByCategory] = useState<Record<Category, UploadedFile[]>>({
    floor_plan: [],
    elevations: [],
    rcp: [],
    furniture_schedule: [],
    finishes_schedule: [],
    lighting_plan: [],
    lighting_mood_reference: [],
    models_3d: [],
    cgi_package: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  // Auto-resize textarea whenever instructions change
  useEffect(() => {
    const el = instructionsRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [instructions]);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentTime(new Date());
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setInstructions("");
      setFilesByCategory({
        floor_plan: [], elevations: [], rcp: [],
        furniture_schedule: [], finishes_schedule: [], lighting_plan: [],
        lighting_mood_reference: [], models_3d: [], cgi_package: [],
      });
    }
  }, [isOpen]);

  // ── Dictation ────────────────────────────────────────────
  const polishDictation = useCallback(async (raw: string) => {
    setIsPolishing(true);
    try {
      const res = await supabase.functions.invoke("polish-task", {
        body: { raw },
      });
      const data = res.data as { description?: string } | null;
      if (data?.description) {
        setInstructions(data.description);
        sonnerToast.success("Dictation polished — review and request");
      } else {
        setInstructions(raw);
      }
    } catch {
      setInstructions(raw);
    } finally {
      setIsPolishing(false);
    }
  }, []);

  const startDictation = useCallback(async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      sonnerToast.error("Dictation not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      const inIframe = window.self !== window.top;
      if (err?.name === "NotAllowedError" && inIframe) {
        sonnerToast.error("Mic blocked inside the preview. Open the app in a new tab to dictate.", {
          action: { label: "Open in new tab", onClick: () => window.open(window.location.href, "_blank") },
          duration: 10000,
        });
      } else if (err?.name === "NotAllowedError") {
        sonnerToast.error("Microphone access blocked. Allow it in your browser settings.");
      } else {
        sonnerToast.error("Could not access microphone");
      }
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    transcriptRef.current = "";
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      transcriptRef.current = text;
    };
    rec.onerror = (e: any) => {
      const err = e?.error;
      if (err === "no-speech") sonnerToast.error("No speech detected — try again");
      else if (err === "not-allowed" || err === "service-not-allowed") sonnerToast.error("Microphone access blocked.");
      else if (err === "audio-capture") sonnerToast.error("No microphone found");
      else if (err !== "aborted") sonnerToast.error(`Dictation error: ${err || "unknown"}`);
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
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  // ── File handling ─────────────────────────────────────────
  const handleFilesAdded = (category: Category, fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map((file) => ({ file, uploading: false }));
    setFilesByCategory((prev) => ({ ...prev, [category]: [...prev[category], ...newFiles] }));
  };

  const handleRemoveFile = (category: Category, index: number) => {
    setFilesByCategory((prev) => ({ ...prev, [category]: prev[category].filter((_, i) => i !== index) }));
  };

  const uploadAllFiles = async (): Promise<boolean> => {
    if (!user || !sceneId) return true;
    const categories = Object.keys(filesByCategory) as Category[];
    for (const category of categories) {
      const catFiles = filesByCategory[category];
      for (let idx = 0; idx < catFiles.length; idx++) {
        const uploadedFile = catFiles[idx];
        if (uploadedFile.storagePath) continue;
        const path = `${user.id}/${sceneId}/${category}/${Date.now()}-${uploadedFile.file.name}`;
        setFilesByCategory((prev) => ({
          ...prev,
          [category]: prev[category].map((f, i) => i === idx ? { ...f, uploading: true } : f),
        }));
        const { error: storageError } = await supabase.storage.from("round-uploads").upload(path, uploadedFile.file);
        if (storageError) {
          setFilesByCategory((prev) => ({
            ...prev,
            [category]: prev[category].map((f, i) => i === idx ? { ...f, uploading: false, error: storageError.message } : f),
          }));
          return false;
        }
        await supabase.from("round_uploads").insert({
          scene_id: sceneId, user_id: user.id, category,
          file_name: uploadedFile.file.name, storage_path: path, file_size: uploadedFile.file.size,
        });
        setFilesByCategory((prev) => ({
          ...prev,
          [category]: prev[category].map((f, i) => i === idx ? { ...f, uploading: false, storagePath: path } : f),
        }));
      }
    }
    return true;
  };

  const { orderDeadline: deadline, start: startDate, delivery: deliveryDate } = computeRoundSchedule(currentTime);
  const deliveryDateStr = format(deliveryDate, "EEEE d MMMM 'at' h:mma");
  const diffSecs = Math.max(0, differenceInSeconds(deadline, currentTime));
  const days = Math.floor(diffSecs / (24 * 3600));
  const hours = Math.floor((diffSecs % (24 * 3600)) / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  const deadlineLabel = [
    days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : null,
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : null,
    `${mins} ${mins === 1 ? "minute" : "minutes"}`,
  ].filter(Boolean).join(", ");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instructions.trim()) return;
    setIsSubmitting(true);
    try {
      const success = await uploadAllFiles();
      if (!success) {
        toast({ title: "Upload failed", description: "Some files could not be uploaded. Please try again.", variant: "destructive" });
        return;
      }
      if (onCreateWithDate) {
        onCreateWithDate(instructions.trim(), deliveryDate, startDate);
      } else {
        onCreate(instructions.trim());
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="relative w-full max-w-[760px] shadow-[0_40px_100px_-16px_rgba(0,0,0,0.6)] max-h-[92vh] overflow-y-auto"
            style={{ borderRadius: 4, background: "var(--brand-dark-surface, #181614)", border: "1px solid #2A2820" }}
          >
            <form onSubmit={handleSubmit}>

              {/* ── Header ── */}
              <div className="px-12 pt-12 pb-7 border-b border-border/30">
                <div className="flex items-start justify-between">
                  <div>
                    <h2
                      className="font-serif font-normal text-foreground"
                      style={{ fontSize: "1.85rem", letterSpacing: "-0.01em", lineHeight: 1 }}
                    >
                      Round {roundNumber.toString().padStart(2, "0")}
                    </h2>
                    {sceneName && (
                      <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-foreground/45 font-sans">
                        {sceneName}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-1 text-foreground/50 hover:text-foreground transition-colors"
                    style={{ lineHeight: 1 }}
                  >
                    <X size={16} strokeWidth={1} />
                  </button>
                </div>
              </div>

              {/* ── Main content ── */}
              <div className="px-12 py-8 space-y-10">

                {/* Instructions */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-[9px] font-sans font-medium uppercase tracking-[0.3em] text-gold">
                      Instructions
                    </label>
                    <button
                      type="button"
                      onClick={isRecording ? stopDictation : startDictation}
                      disabled={isPolishing}
                      className={`px-3 py-1 text-[9px] font-sans uppercase tracking-[0.2em] border transition-all ${
                        isRecording
                          ? "border-rose-500/60 text-rose-400 bg-rose-500/5"
                          : isPolishing
                          ? "border-border/30 text-foreground/25 cursor-not-allowed"
                          : "border-border/40 text-foreground/35 hover:border-foreground/30 hover:text-foreground/60"
                      }`}
                      style={{ borderRadius: 2 }}
                    >
                      {isPolishing ? "Polishing…" : isRecording ? "Stop" : "Dictate"}
                    </button>
                  </div>

                  <textarea
                    ref={instructionsRef}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Describe the camera angle, lighting mood, materials, and any specific changes required."
                    autoFocus
                    rows={3}
                    maxLength={2000}
                    required
                    className="w-full bg-transparent text-foreground placeholder:text-foreground/20 text-[14px] font-sans leading-relaxed focus:outline-none resize-none p-4 border border-[#2A2820] focus:border-[var(--brand-gold)]"
                    style={{ overflow: "hidden", minHeight: "120px", transition: "border-color 160ms ease" }}
                  />
                  <p className="mt-4 text-[11px] font-sans text-foreground/30 leading-relaxed">
                    Upload what you have. The more detail you share, the better Round 01 we can deliver.
                  </p>
                </div>

                {/* File fields */}
                <div>
                  {/* 01 — Architecture */}
                  <SectionLabel>01 — Architecture</SectionLabel>
                  <div className="pl-4 border-t border-border/30" style={{ position: "relative" }}>
                    <UploadItem label="Floor plan" files={filesByCategory.floor_plan} onFilesAdded={(fl) => handleFilesAdded("floor_plan", fl)} onRemoveFile={(i) => handleRemoveFile("floor_plan", i)} />
                    <UploadItem label="Elevations" files={filesByCategory.elevations} onFilesAdded={(fl) => handleFilesAdded("elevations", fl)} onRemoveFile={(i) => handleRemoveFile("elevations", i)} />
                    <UploadItem label="Reflected ceiling plan (RCP)" files={filesByCategory.rcp} onFilesAdded={(fl) => handleFilesAdded("rcp", fl)} onRemoveFile={(i) => handleRemoveFile("rcp", i)} />
                  </div>

                  {/* 02 — Design & Finishes */}
                  <SectionLabel>02 — Design & Finishes</SectionLabel>
                  <div className="pl-4 border-t border-border/30" style={{ position: "relative" }}>
                    <UploadItem label="Finishes schedule" files={filesByCategory.finishes_schedule} onFilesAdded={(fl) => handleFilesAdded("finishes_schedule", fl)} onRemoveFile={(i) => handleRemoveFile("finishes_schedule", i)} />
                    <UploadItem label="Furniture schedule (FF&E)" files={filesByCategory.furniture_schedule} onFilesAdded={(fl) => handleFilesAdded("furniture_schedule", fl)} onRemoveFile={(i) => handleRemoveFile("furniture_schedule", i)} />
                    <UploadItem label="Lighting plan" files={filesByCategory.lighting_plan} onFilesAdded={(fl) => handleFilesAdded("lighting_plan", fl)} onRemoveFile={(i) => handleRemoveFile("lighting_plan", i)} />
                  </div>

                  {/* 03 — References & Assets */}
                  <SectionLabel>03 — References & Assets</SectionLabel>
                  <div className="pl-4 border-t border-border/30" style={{ position: "relative" }}>
                    <UploadItem label="Lighting mood reference" files={filesByCategory.lighting_mood_reference} onFilesAdded={(fl) => handleFilesAdded("lighting_mood_reference", fl)} onRemoveFile={(i) => handleRemoveFile("lighting_mood_reference", i)} />
                    <UploadItem label="3D models" files={filesByCategory.models_3d} onFilesAdded={(fl) => handleFilesAdded("models_3d", fl)} onRemoveFile={(i) => handleRemoveFile("models_3d", i)} />
                    <UploadItem label="CGI Package (PDF)" files={filesByCategory.cgi_package} onFilesAdded={(fl) => handleFilesAdded("cgi_package", fl)} onRemoveFile={(i) => handleRemoveFile("cgi_package", i)} />
                  </div>
                </div>

              </div>

              {/* ── Delivery timing — outside space-y to allow 24px top margin ── */}
              <div className="px-12 pb-8" style={{ marginTop: "24px" }}>
                <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-gold/80 leading-relaxed">
                  Delivery — {deliveryDateStr}
                </p>
                <p
                  className="mt-1.5 text-[11px] font-sans text-foreground/50 leading-relaxed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  Order within {deadlineLabel}
                </p>
              </div>

              {/* ── Footer ── */}
              <div className="px-12 pb-12 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-12 px-6 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/35 hover:text-foreground/55 transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-12 px-8 text-[10px] font-sans uppercase tracking-[0.24em] border border-[#3A3530] bg-transparent text-foreground/65 hover:text-foreground/85 transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Save Draft
                </button>
                <button
                  type="submit"
                  disabled={!instructions.trim() || isSubmitting}
                  className="flex-1 h-12 text-[10px] font-sans uppercase tracking-[0.24em] border border-[var(--brand-gold)] bg-transparent text-gold hover:text-gold transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{ borderRadius: 2 }}
                >
                  {isSubmitting ? "Uploading…" : "Submit for Production"}
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
