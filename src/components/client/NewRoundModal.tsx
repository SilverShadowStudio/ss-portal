import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import { X, FileIcon } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { format, differenceInSeconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { computeRoundSchedule } from "@/lib/roundSchedule";

// ── Future-Monday booking helpers (Isabelle button) ──
function startOfBookingDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
/** First Monday on or after the given date. */
function nextMondayOnOrAfter(d: Date): Date {
  const c = startOfBookingDay(d);
  const day = c.getDay(); // 0=Sun .. 1=Mon .. 6=Sat
  const shift = day === 1 ? 0 : (8 - day) % 7;
  c.setDate(c.getDate() + shift);
  return c;
}
function sameBookingDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
/** Production cutoff for a Monday start: the prior Friday at 12:00. */
function cutoffForStart(monday: Date): Date {
  const c = new Date(monday);
  c.setDate(c.getDate() - 3); // Monday → previous Friday
  c.setHours(12, 0, 0, 0);
  return c;
}

interface UploadedFile {
  name: string;
  size?: number;
  /** Only present for files added in this modal session (new uploads).
   *  Persisted files restored from `round_uploads` have no File object —
   *  they live in storage and are identified by storagePath + uploadId. */
  file?: File;
  uploading: boolean;
  storagePath?: string;
  /** `round_uploads.id` — present for files already persisted to the DB.
   *  Used to delete the row + storage object when the client removes a
   *  previously-uploaded file from a draft. */
  uploadId?: string;
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
  onCreate: (instructions: string, bufferWeeks: number) => void;
  onCreateWithDate?: (
    instructions: string,
    deliveryDate: Date,
    startDate: Date,
    bufferWeeks: number,
  ) => void;
  /** Persist current state as a draft (status='draft') without firing
   *  Submit For Production. Edge functions (airtable-auto-sync,
   *  dropbox-save-round-files) early-return on draft so nothing leaks
   *  outside the portal. */
  onSaveDraft?: (instructions: string, bufferWeeks: number) => void;
  /** Discard the existing draft — deletes the scene_rounds row but leaves
   *  scene-level uploads alone (they're not round-scoped). Only used when
   *  `existingDraft` is set; the modal closes after success. */
  onDiscardDraft?: (draftId: string) => Promise<void> | void;
  sceneName?: string;
  sceneId?: string;
  roundNumber?: number;
  /** If the scene already has a draft round, the parent passes its id,
   *  instructions and buffer setting here so the modal opens pre-populated
   *  and Save Draft updates that row instead of inserting a new one. */
  existingDraft?: {
    id: string;
    instructions: string | null;
    buffer_weeks?: number | null;
    /** Present when re-opening a row that already exists. 'draft' enables
     *  the Discard affordance; 'pending' means a booked slot being edited
     *  before its cutoff, in which case start_date pre-selects the date. */
    status?: string | null;
    start_date?: string | null;
  } | null;
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
        transition: "background var(--duration-standard) var(--ease-default)",
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
          transition: "all var(--duration-deliberate) var(--ease-default)",
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
              style={{ transition: "opacity var(--duration-standard) var(--ease-default)" }}
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
                  {f.name}
                </span>
                {f.uploading && (
                  <BrandLoader size="sm" className="h-2.5 w-2.5" />
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
  onSaveDraft,
  onDiscardDraft,
  sceneName,
  sceneId,
  roundNumber = 1,
  existingDraft,
}: NewRoundModalProps) {
  const [instructions, setInstructions] = useState("");
  const [bufferWeeks, setBufferWeeks] = useState<number>(1);
  // Delivery scheduling: "next" preserves the legacy immediate-request flow;
  // "choose" is the Isabelle button — pick a future production Monday.
  const [deliveryMode, setDeliveryMode] = useState<"next" | "choose">("next");
  const [selectedMonday, setSelectedMonday] = useState<Date | null>(null);
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
  // Review panel state for the dictation flow. After dictation + formatting,
  // both the raw transcript and the formatted brief are shown side-by-side
  // for the client to choose. Choosing populates the textarea but never
  // auto-submits — the client always has a final review inside the input.
  const [briefReview, setBriefReview] = useState<{
    raw: string;
    formatted: string;
  } | null>(null);
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
    if (!isOpen) return;
    setInstructions(existingDraft?.instructions ?? "");
    setBufferWeeks(existingDraft?.buffer_weeks ?? 1);
    // Re-opening a booked (pending) slot before cutoff: default to the
    // chosen-date picker with its existing start Monday pre-selected so the
    // booking is preserved unless the client changes it. Everything else
    // (new round, draft re-open) starts on the legacy "Next available" path.
    if (existingDraft?.status === "pending" && existingDraft?.start_date) {
      setDeliveryMode("choose");
      setSelectedMonday(new Date(existingDraft.start_date));
    } else {
      setDeliveryMode("next");
      setSelectedMonday(null);
    }
    setBriefReview(null);
    // Start with empty widgets; if reopening a draft, hydrate from
    // `round_uploads` so files the client uploaded before saving the
    // draft are visible (and removable) on this session.
    setFilesByCategory({
      floor_plan: [], elevations: [], rcp: [],
      furniture_schedule: [], finishes_schedule: [], lighting_plan: [],
      lighting_mood_reference: [], models_3d: [], cgi_package: [],
    });
    if (existingDraft && sceneId) {
      (async () => {
        const { data, error } = await supabase
          .from("round_uploads")
          .select("id, category, file_name, storage_path, file_size")
          .eq("scene_id", sceneId)
          .order("created_at", { ascending: true });
        if (error || !data) return;
        const grouped: Record<Category, UploadedFile[]> = {
          floor_plan: [], elevations: [], rcp: [],
          furniture_schedule: [], finishes_schedule: [], lighting_plan: [],
          lighting_mood_reference: [], models_3d: [], cgi_package: [],
        };
        for (const row of data) {
          const cat = row.category as Category;
          if (!grouped[cat]) continue;
          grouped[cat].push({
            name: row.file_name,
            size: row.file_size ?? undefined,
            uploading: false,
            storagePath: row.storage_path,
            uploadId: row.id,
          });
        }
        setFilesByCategory(grouped);
      })();
    }
  }, [isOpen, existingDraft?.id, existingDraft?.instructions, sceneId]);

  // ── Dictation ────────────────────────────────────────────
  // After speech-to-text completes, send the raw transcript to the
  // `format-brief` edge function (Anthropic Claude) which rewrites it as a
  // structured interior-design brief. The result is surfaced in a review
  // panel; the client picks "Use formatted" or "Use original" before it
  // enters the textarea. We never auto-submit — the client always confirms.
  const polishDictation = useCallback(async (raw: string) => {
    setIsPolishing(true);
    try {
      const res = await supabase.functions.invoke("format-brief", {
        body: { transcript: raw },
      });
      const data = res.data as { formatted?: string; error?: string } | null;
      if (data?.formatted) {
        setBriefReview({ raw, formatted: data.formatted });
      } else {
        // Formatter failed — populate the textarea with the raw transcript
        // so the client still has something to edit, and toast the error.
        setInstructions(raw);
        sonnerToast.error("Could not format brief — using raw transcript");
      }
    } catch (err: any) {
      console.warn("[NewRoundModal] format-brief failed:", err);
      setInstructions(raw);
      sonnerToast.error("Could not format brief — using raw transcript");
    } finally {
      setIsPolishing(false);
    }
  }, []);

  const acceptFormatted = useCallback(() => {
    if (briefReview) setInstructions(briefReview.formatted);
    setBriefReview(null);
  }, [briefReview]);

  const useOriginal = useCallback(() => {
    if (briefReview) setInstructions(briefReview.raw);
    setBriefReview(null);
  }, [briefReview]);

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
    const newFiles: UploadedFile[] = Array.from(fileList).map((file) => ({
      name: file.name, size: file.size, file, uploading: false,
    }));
    setFilesByCategory((prev) => ({ ...prev, [category]: [...prev[category], ...newFiles] }));
  };

  const handleRemoveFile = (category: Category, index: number) => {
    const target = filesByCategory[category][index];
    // Optimistic UI removal first — both new and persisted entries.
    setFilesByCategory((prev) => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }));
    // Persisted files (already in storage + round_uploads) must be cleaned
    // up so the client doesn't end up paying for orphans or having ghost
    // files show up next time they reopen the draft.
    if (target?.uploadId || target?.storagePath) {
      (async () => {
        try {
          if (target.storagePath) {
            await supabase.storage.from("round-uploads").remove([target.storagePath]);
          }
          if (target.uploadId) {
            await supabase.from("round_uploads").delete().eq("id", target.uploadId);
          }
        } catch (err) {
          console.warn("[NewRoundModal] failed to delete persisted upload:", err);
        }
      })();
    }
  };

  const uploadAllFiles = async (): Promise<boolean> => {
    if (!user || !sceneId) return true;
    const categories = Object.keys(filesByCategory) as Category[];
    for (const category of categories) {
      const catFiles = filesByCategory[category];
      for (let idx = 0; idx < catFiles.length; idx++) {
        const uploadedFile = catFiles[idx];
        if (uploadedFile.storagePath || !uploadedFile.file) continue;
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
        const { data: insertRow } = await supabase.from("round_uploads").insert({
          scene_id: sceneId, user_id: user.id, category,
          file_name: uploadedFile.file.name, storage_path: path, file_size: uploadedFile.file.size,
        }).select("id").single();
        setFilesByCategory((prev) => ({
          ...prev,
          [category]: prev[category].map((f, i) => i === idx ? {
            ...f, uploading: false, storagePath: path, uploadId: insertRow?.id,
          } : f),
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

  // ── Future-Monday booking (Isabelle button) ──
  // Grid of the next 12 Mondays from (today + 7 days, rounded forward to the
  // next Monday) — same anchor as RescheduleRoundModal.
  const bookingMondays = useMemo(() => {
    const minBase = startOfBookingDay(new Date());
    minBase.setDate(minBase.getDate() + 7);
    const first = nextMondayOnOrAfter(minBase);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i * 7);
      return d;
    });
  }, [isOpen]);

  const bookedStart = deliveryMode === "choose" ? selectedMonday : null;
  const bookedDelivery = bookedStart
    ? (() => { const d = new Date(bookedStart); d.setDate(d.getDate() + 7); return d; })()
    : null;
  const cutoff = bookedStart ? cutoffForStart(bookedStart) : null;
  const cutoffSecs = cutoff ? Math.max(0, differenceInSeconds(cutoff, currentTime)) : 0;
  const cutoffDays = Math.floor(cutoffSecs / (24 * 3600));
  const cutoffHours = Math.floor((cutoffSecs % (24 * 3600)) / 3600);
  const cutoffCountdown = `${cutoffDays} ${cutoffDays === 1 ? "day" : "days"}, ${cutoffHours} ${cutoffHours === 1 ? "hour" : "hours"} remaining`;

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  useEffect(() => {
    // Reset the confirm prompt every time the modal opens so it never
    // lingers across sessions.
    if (!isOpen) setConfirmDiscard(false);
  }, [isOpen]);

  const handleDiscardDraft = async () => {
    if (!onDiscardDraft || !existingDraft) return;
    if (!confirmDiscard) { setConfirmDiscard(true); return; }
    setIsDiscarding(true);
    try {
      await onDiscardDraft(existingDraft.id);
    } finally {
      setIsDiscarding(false);
      setConfirmDiscard(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    setIsSubmitting(true);
    try {
      // Files persist regardless of submit/draft state — they live on the
      // scene (round_uploads.scene_id), not on the round row. Upload any
      // new ones now so they survive across draft edits.
      const success = await uploadAllFiles();
      if (!success) {
        toast({ title: "Upload failed", description: "Some files could not be uploaded. Please try again.", variant: "destructive" });
        return;
      }
      onSaveDraft(instructions.trim(), bufferWeeks);
    } finally {
      setIsSubmitting(false);
    }
  };

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
      const useBooked = deliveryMode === "choose" && bookedStart && bookedDelivery;
      if (onCreateWithDate) {
        if (useBooked) {
          // Book Production Slot: picked Monday is the production start,
          // delivery is start + 7 days.
          onCreateWithDate(instructions.trim(), bookedDelivery!, bookedStart!, bufferWeeks);
        } else {
          onCreateWithDate(instructions.trim(), deliveryDate, startDate, bufferWeeks);
        }
      } else {
        onCreate(instructions.trim(), bufferWeeks);
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
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            onClick={onClose}
            className="absolute inset-0 bg-background/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ type: "tween", duration: DURATION.standard / 1000, ease: FM_EASE.default }}
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
                      disabled={isPolishing || !!briefReview}
                      className={`px-3 py-1 text-[9px] font-sans uppercase tracking-[0.2em] border transition-all ${
                        isRecording
                          ? "border-rose-500/60 text-rose-400 bg-rose-500/5"
                          : (isPolishing || briefReview)
                          ? "border-border/30 text-foreground/25 cursor-not-allowed"
                          : "border-border/40 text-foreground/35 hover:border-foreground/30 hover:text-foreground/60"
                      }`}
                      style={{ borderRadius: 2 }}
                    >
                      {isPolishing ? "Formatting…" : isRecording ? "Stop" : "Dictate"}
                    </button>
                  </div>

                  {isPolishing ? (
                    // Loading state shown while the LLM formats the transcript.
                    // Holds the textarea-sized space so the layout doesn't jump.
                    <div
                      className="flex items-center justify-center text-[11px] font-sans uppercase tracking-[0.18em] text-foreground/35"
                      style={{ minHeight: 120, border: "1px solid #2A2820", padding: 16 }}
                    >
                      Formatting your brief…
                    </div>
                  ) : briefReview ? (
                    // Review panel: raw transcript vs LLM-formatted brief.
                    // Picking either populates the textarea and clears the
                    // review state. The client still has a final pass in
                    // the textarea — we never auto-submit.
                    <div className="space-y-5">
                      <div>
                        <p
                          className="font-sans uppercase text-foreground/55 mb-2"
                          style={{ fontSize: 9, letterSpacing: "0.22em" }}
                        >
                          What you said
                        </p>
                        <p
                          className="font-sans italic text-foreground leading-relaxed whitespace-pre-wrap"
                          style={{ fontSize: 13, opacity: 0.45 }}
                        >
                          {briefReview.raw}
                        </p>
                      </div>
                      <div>
                        <p
                          className="font-sans uppercase text-foreground mb-2"
                          style={{ fontSize: 9, letterSpacing: "0.22em", color: "#B89A6A" }}
                        >
                          Formatted brief
                        </p>
                        <p
                          className="font-sans text-foreground leading-relaxed whitespace-pre-wrap"
                          style={{ fontSize: 14 }}
                        >
                          {briefReview.formatted}
                        </p>
                      </div>
                      <div className="flex items-center gap-6 pt-2">
                        <button
                          type="button"
                          onClick={acceptFormatted}
                          className="font-sans uppercase hover:opacity-80 transition-opacity"
                          style={{
                            fontSize: 11,
                            letterSpacing: "0.15em",
                            color: "#B89A6A",
                            borderBottom: "1px solid #B89A6A",
                            paddingBottom: 6,
                            background: "transparent",
                            border: "none",
                            borderBottomWidth: 1,
                            borderBottomStyle: "solid",
                            borderBottomColor: "#B89A6A",
                          }}
                        >
                          Use formatted
                        </button>
                        <button
                          type="button"
                          onClick={useOriginal}
                          className="font-sans uppercase text-foreground hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 11,
                            letterSpacing: "0.15em",
                            opacity: 0.35,
                            background: "transparent",
                            border: "none",
                            padding: 0,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.35"; }}
                        >
                          Use original
                        </button>
                      </div>
                    </div>
                  ) : (
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
                      style={{ overflow: "hidden", minHeight: "120px", transition: "border-color var(--duration-quick) var(--ease-default)" }}
                    />
                  )}
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

              {/* ── Buffer between rounds — sits between brief inputs and delivery summary ── */}
              <div className="px-12 pt-2 pb-6">
                <p className="text-[9px] font-sans font-medium uppercase tracking-[0.3em] text-gold mb-4">
                  Buffer between rounds
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setBufferWeeks((n) => Math.max(1, n - 1))}
                    disabled={bufferWeeks <= 1}
                    aria-label="Decrease buffer"
                    className="h-10 w-10 flex items-center justify-center border border-[#2A2820] text-foreground/65 hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{ borderRadius: 2 }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={bufferWeeks}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      if (Number.isNaN(raw)) return;
                      setBufferWeeks(Math.min(12, Math.max(1, raw)));
                    }}
                    className="h-10 w-14 bg-transparent text-center text-[14px] font-sans text-foreground border border-[#2A2820] focus:border-[var(--brand-gold)] focus:outline-none"
                    style={{ borderRadius: 2, fontVariantNumeric: "tabular-nums" }}
                  />
                  <button
                    type="button"
                    onClick={() => setBufferWeeks((n) => Math.min(12, n + 1))}
                    disabled={bufferWeeks >= 12}
                    aria-label="Increase buffer"
                    className="h-10 w-10 flex items-center justify-center border border-[#2A2820] text-foreground/65 hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{ borderRadius: 2 }}
                  >
                    +
                  </button>
                  <select
                    value="weeks"
                    onChange={() => { /* days unit deferred — single option keeps the chrome ready */ }}
                    className="h-10 px-3 bg-transparent text-[12px] font-sans text-foreground/75 border border-[#2A2820] focus:border-[var(--brand-gold)] focus:outline-none cursor-pointer"
                    style={{ borderRadius: 2 }}
                  >
                    <option value="weeks">weeks</option>
                  </select>
                </div>
                <p className="mt-4 text-[11px] font-sans italic text-foreground/40 leading-relaxed">
                  How long you want between each round of work. Default is one week of production plus your buffer time.
                </p>
              </div>

              {/* ── Delivery date — picker + summary ── */}
              <div className="px-12 pb-8" style={{ marginTop: "24px" }}>
                <p className="text-[9px] font-sans font-medium uppercase tracking-[0.3em] text-gold mb-4">
                  Delivery date
                </p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <button
                    type="button"
                    onClick={() => { setDeliveryMode("next"); setSelectedMonday(null); }}
                    className={`h-10 px-4 text-[10px] font-sans uppercase tracking-[0.18em] border transition-colors ${
                      deliveryMode === "next"
                        ? "border-[var(--brand-gold)] text-gold"
                        : "border-border/40 text-foreground/55 hover:text-foreground hover:border-foreground/40"
                    }`}
                    style={{ borderRadius: 2 }}
                  >
                    Next available
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("choose")}
                    className={`h-10 px-4 text-[10px] font-sans uppercase tracking-[0.18em] border transition-colors ${
                      deliveryMode === "choose"
                        ? "border-[var(--brand-gold)] text-gold"
                        : "border-border/40 text-foreground/55 hover:text-foreground hover:border-foreground/40"
                    }`}
                    style={{ borderRadius: 2 }}
                  >
                    Choose a date
                  </button>
                </div>

                {deliveryMode === "next" ? (
                  <>
                    <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-gold/80 leading-relaxed">
                      Delivery — {deliveryDateStr}
                    </p>
                    <p
                      className="mt-1.5 text-[11px] font-sans text-foreground/50 leading-relaxed"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      Order within {deadlineLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 mb-3">
                      Pick a production Monday
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {bookingMondays.map((m) => {
                        const isSel = !!selectedMonday && sameBookingDay(m, selectedMonday);
                        return (
                          <button
                            key={m.toISOString()}
                            type="button"
                            onClick={() => setSelectedMonday(m)}
                            className={`h-11 px-2 text-[11px] font-sans uppercase tracking-[0.14em] border transition-colors ${
                              isSel
                                ? "border-[var(--brand-gold)] text-gold"
                                : "border-border/40 text-foreground/65 hover:text-foreground hover:border-foreground/40"
                            }`}
                            style={{ borderRadius: 2 }}
                          >
                            {format(m, "d MMM")}
                          </button>
                        );
                      })}
                    </div>
                    {bookedStart && bookedDelivery && cutoff && (
                      <div className="mt-5">
                        <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-gold/80 leading-relaxed">
                          Production starts {format(bookedStart, "EEEE d MMMM")} — delivery {format(bookedDelivery, "EEEE d MMMM")}
                        </p>
                        <p
                          className="mt-1.5 text-[11px] font-sans text-foreground/50 leading-relaxed"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          Cutoff: {format(cutoff, "EEEE d MMMM")} at 12:00 — {cutoffCountdown}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="px-12 pb-12 flex gap-3 items-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-12 px-6 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/35 hover:text-foreground/55 transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Cancel
                </button>
                {onDiscardDraft && existingDraft && existingDraft.status === "draft" && (
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    disabled={isDiscarding || isSubmitting}
                    className="h-12 px-4 text-[10px] font-sans uppercase tracking-[0.24em] text-foreground/35 hover:text-rose-300/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ borderRadius: 2 }}
                  >
                    {isDiscarding
                      ? "Discarding…"
                      : confirmDiscard
                      ? "Confirm discard"
                      : "Discard draft"}
                  </button>
                )}
                {onSaveDraft && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleSaveDraft}
                    className="h-12 px-8 text-[10px] font-sans uppercase tracking-[0.24em] border border-[#3A3530] bg-transparent text-foreground/65 hover:text-foreground/85 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ borderRadius: 2 }}
                  >
                    {isSubmitting ? "Saving…" : "Save Draft"}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!instructions.trim() || isSubmitting || (deliveryMode === "choose" && !selectedMonday)}
                  className="flex-1 h-12 text-[10px] font-sans uppercase tracking-[0.24em] border border-[var(--brand-gold)] bg-transparent text-gold hover:text-gold transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{ borderRadius: 2 }}
                >
                  {isSubmitting
                    ? "Uploading…"
                    : deliveryMode === "choose"
                    ? "Book Production Slot"
                    : "Submit for Production"}
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
