import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
import { Clock, X, Paperclip, ExternalLink, File } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { AssetViewer } from "./AssetViewer";
import { differenceInSeconds, format } from "date-fns";
import { deliverRoundAndStartReview } from "@/lib/reviewWindow";
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
    if (!briefOpen || brief !== null) return;
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
          .select("category, file_name, storage_path")
          .eq("scene_id", fetched.scene_id);
        if (cancelled) return;
        setBriefUploads(uploads || []);
        setBriefUploadsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [briefOpen, brief, roundId]);

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
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
            className="fixed left-1/2 top-1/2 z-[70] w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 bg-[#111113] border border-[#222020] rounded-sm shadow-2xl overflow-hidden"
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
                          {briefUploads.map((file, i) => (
                            <p key={i} className="text-xs text-[#8a7c6e] font-sans">
                              {titleCase(file.category)}: {file.file_name}
                            </p>
                          ))}
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
                          const { data: urlData } = supabase.storage
                            .from("round-uploads")
                            .getPublicUrl(file.storage_path);
                          if (isImageFile(file.file_name)) {
                            return (
                              <a
                                key={i}
                                href={urlData.publicUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group relative aspect-square overflow-hidden bg-[#1a1816]"
                              >
                                <img
                                  src={urlData.publicUrl}
                                  alt={file.file_name}
                                  className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
                                />
                              </a>
                            );
                          }
                          return (
                            <a
                              key={i}
                              href={urlData.publicUrl}
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
          {roundCreatedAt && (
            <p className="text-[11px] text-foreground/50 font-sans mb-1.5">
              Requested {fmtTimestamp(roundCreatedAt)}
            </p>
          )}
          {endDate && (() => {
            const d = new Date(endDate);
            d.setHours(11, 0, 0, 0);
            const dateStr = d.toLocaleDateString("en-GB", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            });
            return (
              <p className="text-[12px] text-foreground/80 font-sans">
                Delivery scheduled for {dateStr} at 11:00am
              </p>
            );
          })()}
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
        />
      </div>
      {dropboxPanel}
      {briefModal}
      {adminLightbox}
    </>
  );
}