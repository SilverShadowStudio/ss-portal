import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import { Clock, X, Paperclip, ExternalLink, File } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { AssetViewer } from "./AssetViewer";
import { RoundTimelineCard } from "./RoundTimelineCard";
import { differenceInSeconds, format } from "date-fns";
import { deliverRoundAndStartReview, validateDeliveryDate } from "@/lib/reviewWindow";
import { logActivity } from "@/lib/activityLog";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FolderMappingManager } from "@/components/admin/FolderMappingManager";
import { AirtableSyncPanel } from "@/components/admin/AirtableSyncPanel";
import { DropboxVisualsPanel } from "@/components/admin/DropboxVisualsPanel";

interface TaskDetailProps {
  roundId: string;
  sceneId?: string;
  projectId?: string;
  projectName?: string;
  sceneName: string;
  roundNumber: number;
  roundStatus: string;
  deliveredAt: string | null;
  startDate: string | null;
  endDate: string | null;
  /** When true, shows admin-only controls like the upload-render button. */
  isAdmin?: boolean;
  /** Called after a status change so the parent can refresh state. */
  onUploaded?: () => void;
  /**
   * Optional callback to request the next production round on this scene.
   * When provided, an elegant "Request Round NN" CTA is shown beneath the
   * delivered asset viewer. The parent owns the actual creation flow
   * (typically by opening the same NewRoundModal used for Round 01) so the
   * end-to-end logic stays identical.
   */
  onRequestNextRound?: () => void;
  /** Round number that will be created when the CTA is confirmed. */
  nextRoundNumber?: number;
  /**
   * When a newer round already exists on this scene, this round is treated
   * as read-only and a soft banner invites the client to send any further
   * notes on the latest round instead.
   */
  isLocked?: boolean;
  successorRoundNumber?: number;
  /** Sibling rounds on the same scene — used by the AssetViewer to render
   *  a top-left round picker. Optional; passing nothing hides the picker. */
  siblingRounds?: { id: string; round_number: number; status?: string; is_legacy?: boolean }[];
  onSelectRound?: (roundId: string) => void;
  /** True when the currently-viewed round was imported from Dropbox history. */
  isLegacy?: boolean;
  /** When provided, shows a "Reschedule" link next to View Instructions on
   *  the in-production view. The parent decides whether to provide it
   *  based on the round's start_date / lock cutoff. */
  onReschedule?: () => void;
}

interface BriefData {
  instructions: string | null;
  created_at: string | null;
  scene_id: string | null;
}

interface BriefUpload {
  category: string;
  file_name: string;
  storage_path: string;
  /** Dropbox shared link, persisted by dropbox-save-round-files. Primary
   *  open/download target when present. */
  dropbox_shared_url: string | null;
  /** Supabase signed URL, resolved at fetch time as a fallback (private
   *  bucket — getPublicUrl returns dead links) and as the inline image src. */
  signedUrl?: string;
}

function fmtTimestamp(iso: string): string {
  return format(new Date(iso), "d MMM yyyy 'at' HH:mm:ss");
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp)$/i.test(name);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** ISO timestamp → "yyyy-mm-dd" in local time for an <input type="date">. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO timestamp → "HH:mm" in local time for an <input type="time">. Defaults
 *  to "11:00" (the historical delivery convention) when there is no stored time. */
function toTimeInputValue(iso: string | null): string {
  if (!iso) return "11:00";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "11:00";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "yyyy-mm-dd" + "HH:mm" → local Date. The time defaults to 11:00 when not
 *  supplied, preserving the prior delivery convention; a chosen time is honoured
 *  exactly so the lead-time guard and display reflect it. */
function parseDateTimeInput(dateValue: string, timeValue: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!dm) return null;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeValue || "11:00");
  const hh = tm ? Number(tm[1]) : 11;
  const mm = tm ? Number(tm[2]) : 0;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mm, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

export function TaskDetail({ roundId, sceneId, projectId, projectName, sceneName, roundNumber, roundStatus, deliveredAt, startDate, endDate, isAdmin = false, onUploaded, onRequestNextRound, nextRoundNumber, isLocked = false, successorRoundNumber, siblingRounds, onSelectRound, onReschedule, isLegacy = false }: TaskDetailProps) {
  // Strict status → UI mapping:
  //   in_production / in_progress / pending → "Production in Progress" (no image)
  //   client_review / delivered             → image + annotation tools
  //   approved                              → image, locked
  const isPreDelivery =
    roundStatus === "in_production" ||
    roundStatus === "in_progress" ||
    roundStatus === "pending";
  const isDelivered = !isPreDelivery;
  const [assetCount, setAssetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [currentStatus, setCurrentStatus] = useState(roundStatus);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [adminPreviewLink, setAdminPreviewLink] = useState<string | null>(null);
  useEffect(() => setCurrentStatus(roundStatus), [roundStatus, roundId]);

  // Brief / instructions modal state — fetched lazily on open.
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefUploads, setBriefUploads] = useState<BriefUpload[]>([]);
  const [briefUploadsLoading, setBriefUploadsLoading] = useState(false);
  const [roundCreatedAt, setRoundCreatedAt] = useState<string | null>(null);

  // Admin delivery-date editor. `endDateState` mirrors the endDate prop so an
  // admin edit re-renders the timeline immediately without waiting for the
  // parent re-fetch; the draft/error/saving fields drive the inline editor.
  const [endDateState, setEndDateState] = useState<string | null>(endDate);
  const [deliveryDraft, setDeliveryDraft] = useState<string>(toDateInputValue(endDate));
  const [timeDraft, setTimeDraft] = useState<string>(toTimeInputValue(endDate));
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [savingDelivery, setSavingDelivery] = useState(false);
  useEffect(() => {
    setEndDateState(endDate);
    setDeliveryDraft(toDateInputValue(endDate));
    setTimeDraft(toTimeInputValue(endDate));
    setDeliveryError(null);
  }, [endDate, roundId]);

  async function saveDeliveryDate() {
    setDeliveryError(null);
    const parsed = parseDateTimeInput(deliveryDraft, timeDraft);
    if (!parsed) {
      setDeliveryError("Pick a valid delivery date.");
      return;
    }
    const requestDate = roundCreatedAt ? new Date(roundCreatedAt) : new Date(NaN);
    const verdict = validateDeliveryDate(parsed, requestDate);
    if (!verdict.ok) {
      setDeliveryError(verdict.error ?? "Delivery must be after the request date.");
      return;
    }
    setSavingDelivery(true);
    const previous = endDateState;
    const iso = parsed.toISOString();
    const { error } = await supabase
      .from("scene_rounds")
      .update({ end_date: iso })
      .eq("id", roundId);
    setSavingDelivery(false);
    if (error) {
      console.error("Delivery-date update failed:", error);
      setDeliveryError("Could not save. Please try again.");
      return;
    }
    setEndDateState(iso);
    await logActivity({
      action: "round_rescheduled",
      actorRole: "admin",
      description: `Delivery set to ${format(parsed, "d MMM yyyy 'at' HH:mm")}`,
      entityType: "scene_round",
      entityId: roundId,
      roundId,
      roundNumber,
      sceneName,
      metadata: { from: previous, to: iso },
    });
    onUploaded?.();
  }

  // Validate the temporal window once.
  const window = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    if (end.getTime() <= start.getTime()) return null; // reversed / zero-length
    return { start, end };
  }, [startDate, endDate]);

  // Live timer for progress bar — update every 30s (smooth on a multi-day span,
  // no jitter, lightweight). We stop ticking once the window has elapsed.
  useEffect(() => {
    if (isDelivered || !window) return;
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [isDelivered, window]);

  useEffect(() => {
    supabase
      .from("round_assets")
      .select("*", { count: "exact", head: true })
      .eq("scene_round_id", roundId)
      .eq("is_current", true)
      .then(({ count }) => {
        setAssetCount(count || 0);
        setLoading(false);
      });
  }, [roundId]);

  useEffect(() => {
    supabase
      .from("scene_rounds")
      .select("created_at")
      .eq("id", roundId)
      .maybeSingle()
      .then(({ data }) => setRoundCreatedAt(data?.created_at ?? null));
  }, [roundId]);

  // Lazy-load instructions + uploads on first open.
  useEffect(() => {
    // Refetch on each open. `brief` must NOT be a dependency: setBrief() runs
    // mid-async below, and if `brief` were a dep that state change would tear
    // down this effect (cancelled = true) before the upload fetch resolves,
    // leaving "Retrieving files…" stuck forever.
    if (!briefOpen) return;
    let cancelled = false;
    setBriefLoading(true);
    (async () => {
      const { data } = await supabase
        .from("scene_rounds")
        .select("instructions, created_at, scene_id")
        .eq("id", roundId)
        .maybeSingle();
      if (cancelled) return;
      const fetched: BriefData = {
        instructions: data?.instructions ?? null,
        created_at: data?.created_at ?? null,
        scene_id: data?.scene_id ?? null,
      };
      setBrief(fetched);
      setBriefLoading(false);

      if (fetched.scene_id) {
        setBriefUploadsLoading(true);
        const { data: uploads } = await supabase
          .from("round_uploads")
          .select("category, file_name, storage_path, dropbox_shared_url")
          .eq("scene_id", fetched.scene_id);
        if (cancelled) return;
        const list = (uploads || []) as BriefUpload[];
        // Resolve Supabase signed URLs (the bucket is private — getPublicUrl
        // is dead) as a fallback link target and as the inline image src.
        // Dropbox shared links, when present, are preferred for open/download.
        let enriched = list;
        if (list.length > 0) {
          const { data: signed } = await supabase.storage
            .from("round-uploads")
            .createSignedUrls(list.map((u) => u.storage_path), 3600);
          if (cancelled) return;
          const byPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
          enriched = list.map((u) => ({ ...u, signedUrl: byPath.get(u.storage_path) ?? undefined }));
        }
        setBriefUploads(enriched);
        setBriefUploadsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [briefOpen, roundId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <BrandLoader size="md" />
      </div>
    );
  }

  const briefTrigger = (
    <button
      type="button"
      onClick={() => setBriefOpen(true)}
      className="text-[11px] tracking-[0.14em] uppercase text-foreground/60 hover:text-foreground hover:underline underline-offset-4 transition-colors font-sans"
    >
      View Instructions
    </button>
  );

  const rescheduleTrigger = onReschedule ? (
    <button
      type="button"
      onClick={onReschedule}
      className="text-[11px] tracking-[0.14em] uppercase text-foreground/60 hover:text-foreground hover:underline underline-offset-4 transition-colors font-sans"
    >
      Reschedule
    </button>
  ) : null;

  // Admin-only manual status override. Three canonical states map to the
  // existing scene_rounds.status values used by the timeline coloring logic.
  // Values must match the scene_rounds.status CHECK constraint:
  //   pending | in_production | delivered | approved | client_review
  const STATUS_OPTIONS: { value: string; label: string; dot: string; ring: string }[] = [
    { value: "in_production", label: "In Production", dot: "bg-yellow-400", ring: "border-yellow-400/70" },
    { value: "client_review", label: "Awaiting Review", dot: "bg-red-500", ring: "border-red-500/70" },
    { value: "approved", label: "Approved", dot: "bg-emerald-500", ring: "border-emerald-500/70" },
  ];

  async function changeStatus(next: string) {
    if (next === currentStatus) return;
    const previous = currentStatus;
    setCurrentStatus(next);
    setSavingStatus(next);
    const { error } = await supabase
      .from("scene_rounds")
      .update({ status: next })
      .eq("id", roundId);
    setSavingStatus(null);
    if (error) {
      console.error("Status update failed:", error);
      setCurrentStatus(previous);
      alert("Could not update status. Please try again.");
      return;
    }
    await logActivity({
      action: "scene_status_changed",
      description: `Status set to ${STATUS_OPTIONS.find((o) => o.value === next)?.label ?? next}`,
      entityType: "scene_round",
      entityId: roundId,
      roundId,
      roundNumber,
      sceneName,
      metadata: { from: previous, to: next },
    });
    onUploaded?.();
  }

  const isDraftRound = roundStatus === "draft";

  const adminStatusBar = isAdmin ? (
    isDraftRound ? (
      // Drafts are client-side only — the client hasn't submitted the brief
      // yet, so the admin has nothing to act on. Render a read-only banner
      // in place of the status bar so admins don't accidentally promote a
      // half-written brief into production.
      <div
        className="mb-4 px-4 py-3 font-sans"
        style={{ borderLeft: "2px solid #8A8070", background: "rgba(138,128,112,0.06)" }}
      >
        <p
          className="uppercase mb-1"
          style={{ fontSize: 10, letterSpacing: "0.15em", color: "#8A8070" }}
        >
          Draft — client only
        </p>
        <p className="text-[12px] text-foreground/65 leading-relaxed">
          The client has saved this round as a draft and has not submitted it for production yet. No action is required from the studio. Nothing has been synced to Airtable or Dropbox.
        </p>
      </div>
    ) : (
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground/70 font-sans mr-1">
          Status
        </span>
        {STATUS_OPTIONS.map((opt) => {
          const active =
            currentStatus === opt.value ||
            (opt.value === "in_production" &&
              (currentStatus === "in_progress" || currentStatus === "pending"));
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => changeStatus(opt.value)}
              disabled={savingStatus !== null}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-sans tracking-wide transition-all",
                active
                  ? `${opt.ring} bg-card text-foreground shadow-sm`
                  : "border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:border-border",
                savingStatus !== null && "opacity-70 cursor-wait"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", opt.dot)} />
              {opt.label}
            </button>
          );
        })}
      </div>
    )
  ) : null;

  // Admin-only delivery date + time editor. Unlike the client RescheduleRoundModal
  // (locked to future Mondays + a +7-day floor), this lets an admin correct a
  // round to ANY datetime that passes validateDeliveryDate — its purpose is fixing
  // mistakes (e.g. a delivery stored before the request date). The time defaults
  // to 11:00 (the historical convention) but is fully editable.
  const adminDeliveryEditor = isAdmin && !isDraftRound ? (
    <div className="mt-8">
      <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 mb-2">
        Delivery date &amp; time · Admin
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={deliveryDraft}
          onChange={(e) => {
            setDeliveryDraft(e.target.value);
            setDeliveryError(null);
          }}
          disabled={savingDelivery}
          className="h-9 px-3 bg-transparent border border-border/50 text-[12px] text-foreground font-sans focus:outline-none focus:border-foreground/40 disabled:opacity-50"
          style={{ borderRadius: 2, colorScheme: "dark" }}
        />
        <input
          type="time"
          value={timeDraft}
          onChange={(e) => {
            setTimeDraft(e.target.value);
            setDeliveryError(null);
          }}
          disabled={savingDelivery}
          className="h-9 px-3 bg-transparent border border-border/50 text-[12px] text-foreground font-sans focus:outline-none focus:border-foreground/40 disabled:opacity-50"
          style={{ borderRadius: 2, colorScheme: "dark" }}
        />
        <button
          type="button"
          onClick={saveDeliveryDate}
          disabled={
            savingDelivery ||
            (toDateInputValue(endDateState) === deliveryDraft &&
              toTimeInputValue(endDateState) === timeDraft)
          }
          className="h-9 px-4 text-[10px] font-sans uppercase tracking-[0.2em] border border-[var(--brand-gold)] bg-transparent text-gold transition-all disabled:opacity-25 disabled:cursor-not-allowed"
          style={{ borderRadius: 2 }}
        >
          {savingDelivery ? "Saving…" : "Save"}
        </button>
      </div>
      {deliveryError && (
        <p className="mt-2 text-[11px] text-red-400 font-sans">{deliveryError}</p>
      )}
    </div>
  ) : null;

  const briefModal = createPortal(
    <AnimatePresence>
      {briefOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={() => setBriefOpen(false)}
          />
          {/* Flex-centred wrapper. Framer-motion writes an inline `transform`
              for the y/scale animation, which would override Tailwind
              `-translate-*` centering — so centre with flex, not translate.
              Wrapper is pointer-events-none so clicks in the gutter fall
              through to the backdrop (close); panel re-enables pointer events. */}
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            className="pointer-events-auto w-[min(620px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] bg-[#111113] border border-[#222020] rounded-sm shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Round instructions"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-7 py-5 border-b border-[#1c1a18]">
              <div>
                <p className="text-[10px] tracking-[0.15em] uppercase text-foreground/55 font-sans mb-2">
                  Round {roundNumber.toString().padStart(2, "0")}
                </p>
                <h2 className="font-serif text-[22px] font-normal text-foreground leading-tight">{sceneName}</h2>
                {(brief?.created_at ?? roundCreatedAt) && (
                  <p className="mt-1.5 text-[10px] text-foreground/45 font-sans">
                    Requested: {fmtTimestamp((brief?.created_at ?? roundCreatedAt)!)}
                  </p>
                )}
              </div>
              <button
                onClick={() => setBriefOpen(false)}
                className="mt-1 text-foreground/50 hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="px-7 py-6 max-h-[65vh] overflow-y-auto">
              {briefLoading ? (
                <p className="text-[11px] text-foreground/45 font-sans py-8">Retrieving files…</p>
              ) : (
                <>
                  {brief?.instructions ? (
                    <p className="text-[13px] text-foreground/85 leading-[1.7] whitespace-pre-wrap font-sans mt-6">
                      {brief.instructions}
                    </p>
                  ) : (
                    <p className="text-[13px] text-foreground/45 italic font-sans mt-6">No instructions submitted for this round.</p>
                  )}

                  {/* File list */}
                  {(briefUploadsLoading || briefUploads.length > 0) && (
                    <div className="mt-7">
                      <p className="text-[9px] tracking-[0.24em] uppercase text-foreground/35 font-sans mb-3">
                        Attached Files
                      </p>
                      {briefUploadsLoading ? (
                        <p className="text-[11px] text-foreground/45 font-sans">Retrieving files…</p>
                      ) : (
                        <div className="space-y-1.5">
                          {briefUploads.map((file, i) => {
                            const href = file.dropbox_shared_url ?? file.signedUrl;
                            return href ? (
                              <a
                                key={i}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-xs text-[#8a7c6e] hover:text-foreground transition-colors font-sans"
                              >
                                {titleCase(file.category)}: {file.file_name}
                              </a>
                            ) : (
                              <p key={i} className="text-xs text-[#8a7c6e] font-sans">
                                {titleCase(file.category)}: {file.file_name}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Previews */}
                  {!briefUploadsLoading && briefUploads.length > 0 && (
                    <div className="mt-7">
                      <p className="text-[9px] tracking-[0.24em] uppercase text-foreground/35 font-sans mb-3">
                        Previews
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {briefUploads.map((file, i) => {
                          // Open/download → Dropbox shared link when present, else
                          // the Supabase signed URL. Inline thumbnail uses the
                          // signed URL (Dropbox raw hotlinks are unreliable).
                          const href = file.dropbox_shared_url ?? file.signedUrl;
                          if (isImageFile(file.file_name) && file.signedUrl) {
                            return (
                              <a
                                key={i}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group relative aspect-square overflow-hidden bg-[#1a1816]"
                              >
                                <img
                                  src={file.signedUrl}
                                  alt={file.file_name}
                                  className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
                                />
                              </a>
                            );
                          }
                          return (
                            <a
                              key={i}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex flex-col items-center justify-center gap-2 aspect-square bg-[#1a1816] hover:bg-[#201e1b] transition-colors p-3"
                            >
                              <File size={18} className="text-[#8a7c6e]" />
                              <span className="text-[9px] text-[#8a7c6e] text-center break-all font-sans leading-snug">
                                {file.file_name}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );

  const dropboxPanel = isAdmin && sceneId && projectId && !isDraftRound ? (
    <div className="mt-6 w-full max-w-sm mx-auto">
      <DropboxVisualsPanel
        sceneId={sceneId}
        projectId={projectId}
        sceneName={sceneName}
        onRoundSelected={(_round, link, _filename) => setAdminPreviewLink(link)}
      />
    </div>
  ) : null;

  const adminLightbox = adminPreviewLink
    ? createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/92 cursor-zoom-out"
          onClick={() => setAdminPreviewLink(null)}
        >
          <img
            src={adminPreviewLink}
            alt="Dropbox render preview"
            className="max-w-[92vw] max-h-[92vh] object-contain cursor-default shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Close preview"
            className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center text-white/60 hover:text-white transition-colors text-xl leading-none"
            onClick={() => setAdminPreviewLink(null)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>,
        document.body,
      )
    : null;

  // If not delivered yet, show pending state
  if (!isDelivered) {
    const sortedSiblings =
      siblingRounds && siblingRounds.length > 1
        ? [...siblingRounds].sort((a, b) => a.round_number - b.round_number)
        : [];
    return (
      <>
      {adminStatusBar}
      {sortedSiblings.length > 0 && (
        <div className="flex items-end justify-between gap-6 border-b border-border mb-6">
          <nav className="flex items-center gap-8">
            {sortedSiblings.map((r) => {
              const isActive = r.round_number === roundNumber;
              const label = `Round ${r.round_number.toString().padStart(2, "0")}`;
              const statusDot =
                r.status === "approved"
                  ? "bg-emerald-500"
                  : r.status === "client_review" || r.status === "delivered"
                  ? "bg-red-500"
                  : r.status === "in_production" || r.status === "in_progress" || r.status === "pending"
                  ? "bg-yellow-400"
                  : "bg-muted-foreground/40";
              const statusLabel =
                r.status === "approved"
                  ? "Approved"
                  : r.status === "client_review" || r.status === "delivered"
                  ? "Awaiting Review"
                  : r.status === "in_production" || r.status === "in_progress" || r.status === "pending"
                  ? "In Production"
                  : "Pending";
              return (
                <Tooltip key={r.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isActive && onSelectRound) onSelectRound(r.id);
                      }}
                      className={cn(
                        "relative pb-3 text-sm font-medium font-sans transition-colors flex items-center gap-2",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusDot)} />
                      {label}
                      {r.is_legacy && (
                        <span className="text-[9px] tracking-[0.1em] uppercase text-foreground/35 font-sans">· Legacy</span>
                      )}
                      {isActive && (
                        <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-gold rounded-full" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {statusLabel} — use arrow keys or click to navigate between rounds.
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </div>
      )}
      <div
        className="py-8"
      >
        {/* Status block */}
        <div>
          <p className="text-[10px] tracking-[0.15em] uppercase text-foreground/55 font-sans mb-1">
            Status
          </p>
          <p className="text-[12px] tracking-[0.12em] uppercase text-[var(--brand-gold)] font-sans mb-4">
            In Production
          </p>
          <div className="h-px bg-[#2A2820] mb-4" />
          <RoundTimelineCard
            requestedAt={roundCreatedAt}
            deliveryAt={endDateState ? new Date(endDateState) : null}
          />
          {adminDeliveryEditor}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3">
          {briefTrigger}
          {rescheduleTrigger}
        </div>

      </div>
      {dropboxPanel}
      {isAdmin && sceneId && (
        <div className="mt-4 w-full max-w-sm mx-auto">
          <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 mb-2">
            Airtable
          </p>
          <AirtableSyncPanel
            sceneId={sceneId}
            sceneName={sceneName}
            onSynced={onUploaded}
          />
        </div>
      )}
      {briefModal}
      {adminLightbox}
      </>
    );
  }

  // If delivered but no assets
  if (assetCount === 0) {
    return (
      <>
        {adminStatusBar}
        <div
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <p className="text-muted-foreground text-sm font-sans">No assets delivered yet for this round.</p>
          {briefTrigger}
        </div>
        {dropboxPanel}
        {briefModal}
        {adminLightbox}
      </>
    );
  }

  // Show the full asset viewer inline. We render a plain div (no motion
  // fade-in) so hopping between sibling rounds via the top-left tabs feels
  // like an instant cross-cut rather than a re-fade of the whole panel.
  return (
    <>
      <div>
        {adminStatusBar}
        {isLegacy && deliveredAt && (
          <p className="text-[10px] tracking-[0.24em] uppercase text-foreground/40 font-sans mb-4">
            Delivered before portal · {format(new Date(deliveredAt), "d MMM yyyy")}
          </p>
        )}
        <AssetViewer
          sceneRoundId={roundId}
          projectName={projectName}
          sceneName={sceneName}
          roundNumber={roundNumber}
          onClose={() => {}}
          onRequestNextRound={onRequestNextRound}
          nextRoundNumber={nextRoundNumber}
          deliveredAt={deliveredAt}
          isLocked={isLocked}
          successorRoundNumber={successorRoundNumber}
          siblingRounds={siblingRounds}
          onSelectRound={onSelectRound}
          isLegacy={isLegacy}
          isAdmin={isAdmin}
        />
      </div>
      {dropboxPanel}
      {briefModal}
      {adminLightbox}
    </>
  );
}