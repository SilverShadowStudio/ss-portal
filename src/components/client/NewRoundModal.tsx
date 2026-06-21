import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import { X, FileIcon, MoreHorizontal } from "lucide-react";
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

// ── Date-picker helpers for "any day" delivery mode ──────────────────────────
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
function isWeekday(d: Date): boolean {
  return d.getDay() !== 0 && d.getDay() !== 6;
}
function isSameDayPicker(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
const PICKER_DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
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
  bookingMode?: 'calendar' | 'calendar_no_quote' | 'delivery' | 'delivery_no_quote';
}

function UploadItem({
  label,
  files,
  onFilesAdded,
  onRemoveFile,
  required,
  goldLabel,
}: {
  label: string;
  files: UploadedFile[];
  onFilesAdded: (files: FileList) => void;
  onRemoveFile: (index: number) => void;
  required?: boolean;
  goldLabel?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = files.length > 0;
  const firstFile = files[0] ?? null;

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
      onClick={active ? undefined : () => inputRef.current?.click()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group flex items-start py-4 border-b last:border-b-0 ${active ? "" : "cursor-pointer"}`}
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

      {/* Subtle hover/drag overlay — only in empty state */}
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
        <div className="flex items-start justify-between gap-3">

          {/* Left: label + uploaded file info */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span
                className={`text-[11px] font-sans uppercase tracking-[0.12em] ${
                  active
                    ? "text-gold font-medium"
                    : goldLabel
                    ? "text-gold"
                    : isDragging
                    ? "text-gold/70"
                    : "text-foreground/75"
                }`}
              >
                {label}
              </span>
              {/* REQUIRED tag — shown only when empty */}
              {required && !active && (
                <span className="text-[9px] font-sans uppercase tracking-[0.15em] text-gold shrink-0">
                  Required
                </span>
              )}
            </div>

            {/* Populated: filename + size + overflow files */}
            {active && firstFile && (
              <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                <p className="font-serif text-[14px] text-foreground leading-snug truncate">
                  {firstFile.name}
                </p>
                {firstFile.size != null && firstFile.size > 0 && (
                  <p className="mt-0.5 font-sans text-[9px] uppercase tracking-[0.15em] text-foreground/40">
                    {formatFileSize(firstFile.size)}
                  </p>
                )}
                {firstFile.uploading && (
                  <BrandLoader size="sm" className="mt-1 h-2.5 w-2.5" />
                )}
                {firstFile.error && (
                  <span className="mt-0.5 text-[9px] text-destructive uppercase tracking-wider">Upload error</span>
                )}
                {/* Additional files (multi-upload) */}
                {files.length > 1 && (
                  <div className="mt-2 space-y-1">
                    {files.slice(1).map((f, i) => (
                      <div key={i + 1} className="flex items-center gap-2">
                        <FileIcon size={9} className="shrink-0 text-foreground/25" />
                        <span className="text-[10px] text-foreground/50 truncate flex-1 font-sans">{f.name}</span>
                        {f.uploading && <BrandLoader size="sm" className="h-2.5 w-2.5" />}
                        <button
                          type="button"
                          onClick={() => onRemoveFile(i + 1)}
                          className="p-0.5 text-foreground/25 hover:text-foreground/60 transition-colors"
                        >
                          <X size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: affordance */}
          <div className="shrink-0 pt-0.5">
            {!active && (
              <span
                style={{ transition: "opacity var(--duration-standard) var(--ease-default)" }}
                className={`text-[9px] font-sans uppercase tracking-[0.2em] ${
                  isDragging ? "text-gold/70" : "text-foreground/40"
                }`}
              >
                Drop or click
              </span>
            )}
            {active && (
              <div onClick={(e) => e.stopPropagation()}>
                <RowActions
                  type="file"
                  onReplace={() => inputRef.current?.click()}
                  onRemove={() => { for (let i = files.length - 1; i >= 0; i--) onRemoveFile(i); }}
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function RowActions({
  type, onReplace, onRemove, onAction,
}: {
  type: "file" | "date";
  onReplace?: () => void;
  onRemove?: () => void;
  onAction?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const iconBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1 text-foreground/30 hover:text-gold transition-colors"
      style={{ lineHeight: 0 }}
    >
      <MoreHorizontal size={15} strokeWidth={1.5} />
    </button>
  );

  if (type === "date") return iconBtn("Change delivery date", onAction!);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {iconBtn("File actions", () => setOpen(o => !o))}
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)",
            background: "#1E1C18", border: "1px solid #2A2820",
            borderRadius: 2, minWidth: 120, zIndex: 20,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { onReplace?.(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-[11px] font-sans uppercase tracking-[0.12em] text-foreground/65 hover:text-foreground hover:bg-white/5 transition-colors"
          >
            Replace
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onRemove?.(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-[11px] font-sans uppercase tracking-[0.12em] text-amber-400/70 hover:text-amber-300 hover:bg-white/5 transition-colors"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function SectionOpener({ number, word, subtitle, muted }: {
  number: string;
  word: string;
  subtitle?: string;
  muted?: boolean;
}) {
  const accent = muted ? "#8A8070" : "#B89A6A";
  return (
    <div className="pb-8">
      <p className="font-sans uppercase font-medium" style={{ fontSize: 11, letterSpacing: "0.3em", color: accent, lineHeight: 1 }}>
        {number}
      </p>
      <p className="font-serif" style={{ fontSize: 28, color: accent, lineHeight: 1, marginTop: 6 }}>
        {word}
      </p>
      {subtitle && (
        <p className="font-sans italic text-foreground/40" style={{ fontSize: 13, marginTop: 8 }}>
          {subtitle}
        </p>
      )}
    </div>
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
  bookingMode,
}: NewRoundModalProps) {
  const isDelivery = bookingMode === 'delivery' || bookingMode === 'delivery_no_quote';

  const [instructions, setInstructions] = useState("");
  const [bufferWeeks, setBufferWeeks] = useState<number>(1);

  // Delivery date picker state (used in "any day" booking mode only)
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDisplayMonth, setPickerDisplayMonth] = useState<Date>(startOfMonth(new Date()));
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
    setDeliveryMode("next");
    setSelectedMonday(null);
    setBriefReview(null);
    setPickerDate(null);
    setPickerOpen(false);
    setPickerDisplayMonth(startOfMonth(new Date()));
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

  // Earliest selectable delivery date in picker: next weekday after today.
  const earliestPickerDate = useMemo(() => {
    if (!isDelivery) return null;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (!isWeekday(d)) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [isDelivery]);

  // Countdown derived from currentTime (already ticks every second) — no extra interval needed.
  const deliveryCountdown = useMemo(() => {
    if (!isDelivery || !pickerDate) return null;
    const target = new Date(pickerDate);
    target.setHours(12, 0, 0, 0);
    const diff = target.getTime() - currentTime.getTime();
    if (diff <= 0) return null;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `Delivery in ${d} days ${h} hours ${m} minutes ${s} seconds`;
  }, [isDelivery, pickerDate, currentTime]);

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

  const hasAtLeastOneFile = Object.values(filesByCategory).some(files => files.length > 0);

  const hasFloorPlan  = filesByCategory.floor_plan.length > 0;
  const hasCgiPackage = filesByCategory.cgi_package.length > 0;
  const hasDeliveryDate = !isDelivery || pickerDate !== null;

  const submissionIndicator = useMemo(() => {
    if (hasFloorPlan && hasCgiPackage && hasDeliveryDate) return null;
    const fileParts: string[] = [];
    if (!hasFloorPlan)  fileParts.push("Floor Plan");
    if (!hasCgiPackage) fileParts.push("CGI Package");
    const needDate = isDelivery && !pickerDate;
    if (fileParts.length === 0 && needDate) return "Select a delivery date to submit.";
    const allParts = needDate ? [...fileParts, "a delivery date"] : fileParts;
    if (allParts.length === 1) return `Add ${allParts[0]} to submit.`;
    if (allParts.length === 2) return `Add ${allParts[0]} and ${allParts[1]} to submit.`;
    return `Add ${allParts.slice(0, -1).join(", ")}, and ${allParts[allParts.length - 1]} to submit.`;
  }, [hasFloorPlan, hasCgiPackage, hasDeliveryDate, isDelivery, pickerDate]);

  const isSubmitDisabled =
    isSubmitting ||
    !hasFloorPlan ||
    !hasCgiPackage ||
    (isDelivery && !pickerDate) ||
    (!isDelivery && deliveryMode === "choose" && !selectedMonday);

  const [submitHovered, setSubmitHovered] = useState(false);
  const [submitFocused, setSubmitFocused] = useState(false);
  const showTooltip = !!submissionIndicator && (submitHovered || submitFocused);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  useEffect(() => {
    // Reset the confirm prompt every time the modal opens so it never
    // lingers across sessions.
    if (!isOpen) setConfirmDiscard(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

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
      onSaveDraft(instructions.trim(), isDelivery ? 0 : bufferWeeks);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDelivery ? (!pickerDate || !hasAtLeastOneFile) : !hasAtLeastOneFile) return;
    setIsSubmitting(true);
    try {
      const success = await uploadAllFiles();
      if (!success) {
        toast({ title: "Upload failed", description: "Some files could not be uploaded. Please try again.", variant: "destructive" });
        return;
      }
      if (isDelivery) {
        const now = new Date();
        if (onCreateWithDate) {
          onCreateWithDate(instructions.trim(), pickerDate!, now, 0);
        } else {
          onCreate(instructions.trim(), 0);
        }
      } else {
        const useBooked = deliveryMode === "choose" && bookedStart && bookedDelivery;
        if (onCreateWithDate) {
          if (useBooked) {
            onCreateWithDate(instructions.trim(), bookedDelivery!, bookedStart!, bufferWeeks);
          } else {
            onCreateWithDate(instructions.trim(), deliveryDate, startDate, bufferWeeks);
          }
        } else {
          onCreate(instructions.trim(), bufferWeeks);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Date picker renderer for "any day" delivery mode ─────────────────────
  const renderPickerMonthGrid = (monthStart: Date) => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const total = daysInMonth(year, month);
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const numRows = Math.ceil((lead + total) / 7);
    return (
      <div style={{ width: 196 }}>
        <p className="mb-3 text-center font-sans uppercase text-[10px] tracking-[0.2em] text-foreground/40">
          {monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <div className="grid grid-cols-7">
          {PICKER_DAY_HEADERS.map((h, i) => (
            <div key={i} className="flex h-7 items-center justify-center font-sans text-[9px] tracking-[0.1em] text-foreground/25">{h}</div>
          ))}
        </div>
        {Array.from({ length: numRows }).map((_, r) => (
          <div key={r} className="grid grid-cols-7">
            {Array.from({ length: 7 }).map((__, c) => {
              const dayNum = r * 7 + c - lead + 1;
              if (dayNum < 1 || dayNum > total) return <div key={c} className="h-8 w-7" />;
              const day = new Date(year, month, dayNum);
              const isSelected = pickerDate != null && isSameDayPicker(day, pickerDate);
              const selectable = isWeekday(day) && earliestPickerDate != null && day >= earliestPickerDate;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={!selectable}
                  onClick={() => { if (selectable) { setPickerDate(day); setPickerOpen(false); } }}
                  className={[
                    "flex h-8 w-7 items-center justify-center border font-serif text-[13px] tabular-nums transition-colors",
                    isSelected ? "bg-gold border-gold text-[#1A1814]" : "border-transparent",
                    selectable && !isSelected ? "text-foreground hover:border-[var(--brand-gold,#B89A6A)]" : "",
                    !selectable ? "cursor-default text-foreground" : "",
                  ].join(" ")}
                  style={{ borderRadius: 2, opacity: (!isSelected && !selectable) ? 0.18 : 1 }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const renderDeliveryPicker = () => {
    const canGoPrev = earliestPickerDate != null && pickerDisplayMonth > startOfMonth(earliestPickerDate);
    return (
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => canGoPrev && setPickerDisplayMonth(m => addMonths(m, -1))}
          disabled={!canGoPrev}
          className="font-serif text-foreground/35 hover:text-foreground transition-colors disabled:opacity-20"
          style={{ fontSize: 18 }}
        >‹</button>
        <div className="flex gap-5">
          {renderPickerMonthGrid(pickerDisplayMonth)}
          {renderPickerMonthGrid(addMonths(pickerDisplayMonth, 1))}
        </div>
        <button
          type="button"
          onClick={() => setPickerDisplayMonth(m => addMonths(m, 1))}
          className="font-serif text-foreground/35 hover:text-foreground transition-colors"
          style={{ fontSize: 18 }}
        >›</button>
      </div>
    );
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

              {/* ── Sections ── */}
              <div className="px-12 pt-8 pb-10">

                {/* Required intro */}
                <p className="font-sans italic mb-8" style={{ fontSize: 14 }}>
                  <span style={{ color: "#B89A6A" }}>Required</span>
                  <span className="text-foreground"> — we need these three before Round 01 can begin.</span>
                </p>
                <div className="pl-4 border-t border-border/30" style={{ position: "relative" }}>
                  <UploadItem goldLabel label="Floor plan" files={filesByCategory.floor_plan} onFilesAdded={(fl) => handleFilesAdded("floor_plan", fl)} onRemoveFile={(i) => handleRemoveFile("floor_plan", i)} />
                  <UploadItem goldLabel label="CGI Package (PDF)" files={filesByCategory.cgi_package} onFilesAdded={(fl) => handleFilesAdded("cgi_package", fl)} onRemoveFile={(i) => handleRemoveFile("cgi_package", i)} />

                  {/* Delivery date — same structural pattern as UploadItem */}
                  <div
                    className="group flex items-start py-4"
                    style={{
                      marginLeft: "-3rem", marginRight: "-3rem",
                      paddingLeft: (isDelivery && pickerDate) ? "calc(3rem - 3px)" : "3rem",
                      paddingRight: "3rem",
                      position: "relative",
                      transition: "background var(--duration-standard) var(--ease-default)",
                      background: (isDelivery && pickerDate) ? "#252018" : "transparent",
                      borderLeft: (isDelivery && pickerDate) ? "3px solid var(--brand-gold, #B89A6A)" : "3px solid transparent",
                      boxShadow: (isDelivery && pickerDate) ? "inset 0 0 0 1px rgba(184,154,106,0.15)" : "none",
                    }}
                  >
                    <div className="flex-1 min-w-0" style={{ position: "relative" }}>
                      <div className="flex items-start justify-between gap-3">
                        {/* Left: label + date */}
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-3">
                            <span className={`text-[11px] font-sans uppercase tracking-[0.12em] ${
                              (isDelivery && pickerDate) ? "text-gold font-medium" : "text-gold"
                            }`}>
                              Delivery Date
                            </span>
                          </div>
                          {isDelivery ? (
                            pickerDate && (
                              <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                                <p className="font-serif text-[14px] text-foreground leading-snug truncate">
                                  {pickerDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                </p>
                                {deliveryCountdown && (
                                  <p className="mt-0.5 font-sans text-[9px] uppercase tracking-[0.15em] text-foreground/40" style={{ fontVariantNumeric: "tabular-nums" }}>
                                    {deliveryCountdown}
                                  </p>
                                )}
                              </div>
                            )
                          ) : (
                            <div className="mt-1.5">
                              <p className="font-serif text-[14px] text-foreground leading-snug">
                                {deliveryDateStr}
                              </p>
                              <p className="mt-0.5 font-sans text-[9px] uppercase tracking-[0.15em] text-foreground/40" style={{ fontVariantNumeric: "tabular-nums" }}>
                                Order within {deadlineLabel}
                              </p>
                            </div>
                          )}
                        </div>
                        {/* Right: affordance */}
                        <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                          {isDelivery && (
                            pickerDate ? (
                              <RowActions type="date" onAction={() => setPickerOpen(true)} />
                            ) : (
                              <span className="text-[9px] font-sans uppercase tracking-[0.2em] text-foreground/40">
                                No date selected
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Calendar — visible when no date selected or CHANGE clicked */}
                  {isDelivery && (!pickerDate || pickerOpen) && (
                    <div className="flex justify-center pb-4">
                      {renderDeliveryPicker()}
                    </div>
                  )}

                  {/* Buffer between rounds — non-delivery mode only */}
                  {!isDelivery && (
                    <div className="pt-6 pb-2 border-t border-border/20">
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
                  )}
                </div>

                {hasFloorPlan && hasCgiPackage && hasDeliveryDate && (
                  <>
                    {/* Section break */}
                    <div style={{ marginTop: 64, marginBottom: 64, borderTop: "1px solid #2A2820" }} />

                    {/* Welcome intro */}
                    <p className="font-sans italic mb-6" style={{ fontSize: 14 }}>
                      <span style={{ color: "#B89A6A" }}>Optional</span>
                      <span className="text-foreground"> — the more detail you share, the better Round 01 we can deliver.</span>
                    </p>
                    <div className="pl-4 border-t border-border/30" style={{ position: "relative" }}>

                      {/* Instructions — first in Welcome section */}
                      <div className="py-5 border-b" style={{ borderBottomColor: "#2A2820" }}>
                        <div className="flex items-center justify-between mb-4">
                          <label className="text-[11px] font-sans uppercase tracking-[0.12em] text-foreground/75">
                            Instructions
                          </label>
                          <button
                            type="button"
                            onClick={isRecording ? stopDictation : startDictation}
                            disabled={isPolishing || !!briefReview}
                            className={`px-3 py-1 text-[13px] font-sans border transition-all ${
                              isRecording
                                ? "border-rose-500/60 text-rose-400 bg-rose-500/5"
                                : (isPolishing || briefReview)
                                ? "border-border/30 text-foreground/25 cursor-not-allowed"
                                : "border-border/40 hover:border-[#B89A6A]/60 hover:opacity-80"
                            }`}
                            style={{ borderRadius: 2, color: (isPolishing || briefReview || isRecording) ? undefined : "#B89A6A" }}
                          >
                            {isPolishing ? "Formatting…" : isRecording ? "Stop" : "Speak"}
                          </button>
                        </div>

                        {isPolishing ? (
                          <div
                            className="flex items-center justify-center text-[11px] font-sans uppercase tracking-[0.18em] text-foreground/35"
                            style={{ minHeight: 120, border: "1px solid #2A2820", padding: 16 }}
                          >
                            Formatting your brief…
                          </div>
                        ) : briefReview ? (
                          <div className="space-y-5">
                            <div>
                              <p className="font-sans uppercase text-foreground/55 mb-2" style={{ fontSize: 9, letterSpacing: "0.22em" }}>
                                What you said
                              </p>
                              <p className="font-sans italic text-foreground leading-relaxed whitespace-pre-wrap" style={{ fontSize: 13, opacity: 0.45 }}>
                                {briefReview.raw}
                              </p>
                            </div>
                            <div>
                              <p className="font-sans uppercase text-foreground mb-2" style={{ fontSize: 9, letterSpacing: "0.22em", color: "#B89A6A" }}>
                                Formatted brief
                              </p>
                              <p className="font-sans text-foreground leading-relaxed whitespace-pre-wrap" style={{ fontSize: 14 }}>
                                {briefReview.formatted}
                              </p>
                            </div>
                            <div className="flex items-center gap-6 pt-2">
                              <button
                                type="button"
                                onClick={acceptFormatted}
                                className="font-sans uppercase hover:opacity-80 transition-opacity"
                                style={{ fontSize: 11, letterSpacing: "0.15em", color: "#B89A6A", background: "transparent", border: "none", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "#B89A6A", paddingBottom: 6 }}
                              >
                                Use formatted
                              </button>
                              <button
                                type="button"
                                onClick={useOriginal}
                                className="font-sans uppercase text-foreground hover:opacity-100 transition-opacity"
                                style={{ fontSize: 11, letterSpacing: "0.15em", opacity: 0.35, background: "transparent", border: "none", padding: 0 }}
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
                            rows={3}
                            maxLength={2000}
                            className="w-full bg-transparent text-foreground placeholder:text-foreground/20 text-[14px] font-sans leading-relaxed focus:outline-none resize-none p-4 border border-[#2A2820] focus:border-[var(--brand-gold)]"
                            style={{ overflow: "hidden", minHeight: "120px", transition: "border-color var(--duration-quick) var(--ease-default)" }}
                          />
                        )}
                      </div>

                      <UploadItem label="Elevations" files={filesByCategory.elevations} onFilesAdded={(fl) => handleFilesAdded("elevations", fl)} onRemoveFile={(i) => handleRemoveFile("elevations", i)} />
                      <UploadItem label="Reflected ceiling plan (RCP)" files={filesByCategory.rcp} onFilesAdded={(fl) => handleFilesAdded("rcp", fl)} onRemoveFile={(i) => handleRemoveFile("rcp", i)} />
                      <UploadItem label="Finishes schedule" files={filesByCategory.finishes_schedule} onFilesAdded={(fl) => handleFilesAdded("finishes_schedule", fl)} onRemoveFile={(i) => handleRemoveFile("finishes_schedule", i)} />
                      <UploadItem label="Furniture schedule (FF&E)" files={filesByCategory.furniture_schedule} onFilesAdded={(fl) => handleFilesAdded("furniture_schedule", fl)} onRemoveFile={(i) => handleRemoveFile("furniture_schedule", i)} />
                      <UploadItem label="Lighting plan" files={filesByCategory.lighting_plan} onFilesAdded={(fl) => handleFilesAdded("lighting_plan", fl)} onRemoveFile={(i) => handleRemoveFile("lighting_plan", i)} />
                      <UploadItem label="Lighting mood reference" files={filesByCategory.lighting_mood_reference} onFilesAdded={(fl) => handleFilesAdded("lighting_mood_reference", fl)} onRemoveFile={(i) => handleRemoveFile("lighting_mood_reference", i)} />
                      <UploadItem label="Existing 3D models" files={filesByCategory.models_3d} onFilesAdded={(fl) => handleFilesAdded("models_3d", fl)} onRemoveFile={(i) => handleRemoveFile("models_3d", i)} />
                    </div>
                  </>
                )}

              </div>

              {/* ── Footer ── always rendered; CANCEL must never be gated behind required fields */}
              <div className="px-12" style={{ marginTop: 24 }}>
                <div style={{ borderTop: "1px solid #2A2820" }} />
              </div>
              <div className="px-12 pb-12 flex gap-3 items-center" style={{ paddingTop: 64 }}>
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
                {/* Submit — wrapped for tooltip positioning */}
                <div
                  className="flex-1"
                  style={{ position: "relative" }}
                  onMouseEnter={() => setSubmitHovered(true)}
                  onMouseLeave={() => setSubmitHovered(false)}
                >
                  {/* Tooltip — always in DOM when indicator exists; opacity driven by hover/focus */}
                  {submissionIndicator && (
                    <div
                      role="tooltip"
                      id="submit-tooltip"
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 12px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#232019",
                        border: "1px solid #2A2820",
                        padding: "12px 16px",
                        width: "max-content",
                        maxWidth: 280,
                        pointerEvents: "none",
                        zIndex: 10,
                        opacity: showTooltip ? 1 : 0,
                        transition: `opacity ${showTooltip ? 150 : 100}ms ease`,
                      }}
                    >
                      <p
                        className="font-sans text-foreground/85 leading-relaxed"
                        style={{ fontSize: 13 }}
                      >
                        {submissionIndicator}
                      </p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isSubmitDisabled}
                    aria-describedby={submissionIndicator ? "submit-tooltip" : undefined}
                    onFocus={() => setSubmitFocused(true)}
                    onBlur={() => setSubmitFocused(false)}
                    className="w-full h-12 text-[10px] font-sans uppercase tracking-[0.24em] border border-[var(--brand-gold)] bg-transparent text-gold hover:text-gold transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                    style={{ borderRadius: 2 }}
                  >
                    {isSubmitting
                      ? "Uploading…"
                      : isDelivery || deliveryMode === "next"
                      ? "Submit for Production"
                      : "Book Production Slot"}
                  </button>
                </div>
              </div>

            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
