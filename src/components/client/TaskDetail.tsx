import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, X, Paperclip, ExternalLink, Upload, Loader2 } from "lucide-react";
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
  /** Called after a successful upload so the parent can refresh state. */
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
  siblingRounds?: { id: string; round_number: number; status?: string }[];
  onSelectRound?: (roundId: string) => void;
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

export function TaskDetail({ roundId, sceneId, projectId, projectName, sceneName, roundNumber, roundStatus, deliveredAt, startDate, endDate, isAdmin = false, onUploaded, onRequestNextRound, nextRoundNumber, isLocked = false, successorRoundNumber, siblingRounds, onSelectRound }: TaskDetailProps) {
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
  useEffect(() => setCurrentStatus(roundStatus), [roundStatus, roundId]);

  // Admin upload state — drag/drop or file picker, single render image.
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allowedTypes = ["image/jpeg", "image/png", "image/tiff", "image/webp"];
  const maxFileSize = 50 * 1024 * 1024; // 50MB

  // Brief / instructions modal state — fetched lazily on open.
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefUploads, setBriefUploads] = useState<BriefUpload[]>([]);
  const [briefUploadsLoading, setBriefUploadsLoading] = useState(false);

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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  async function uploadRender(file: File) {
    if (!allowedTypes.includes(file.type)) {
      alert(`${file.name} is not a supported image format (JPG, PNG, TIFF, WebP).`);
      return;
    }
    if (file.size > maxFileSize) {
      alert(`${file.name} exceeds the 50MB limit.`);
      return;
    }

    setUploading(true);
    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${roundId}/${timestamp}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("scene-assets")
        .upload(storagePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("round_assets").insert({
        scene_round_id: roundId,
        filename: file.name,
        file_size: file.size,
        source: "upload",
        storage_path: storagePath,
        version: 1,
        is_current: true,
      });
      if (insertError) {
        await supabase.storage.from("scene-assets").remove([storagePath]);
        throw insertError;
      }

      // Mark round as delivered (capping its timeline bar at "now") and
      // spawn the sibling review round.
      await deliverRoundAndStartReview(roundId);

      // Activity log: single asset upload event.
      await logActivity({
        action: "asset_uploaded",
        description: `Uploaded ${file.name}`,
        entityType: "scene_round",
        entityId: roundId,
        roundId,
        roundNumber,
        sceneName,
        metadata: { filename: file.name, count: 1 },
      });

      setAssetCount((c) => c + 1);
      onUploaded?.();
    } catch (err) {
      console.error("Render upload failed:", err);
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const briefTrigger = (
    <button
      type="button"
      onClick={() => setBriefOpen(true)}
      className="mt-6 text-[11px] tracking-[0.14em] uppercase text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline font-sans"
    >
      View instructions
    </button>
  );

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

  const adminStatusBar = isAdmin ? (
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
  ) : null;

  const briefModal = createPortal(
    <AnimatePresence>
      {briefOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm"
            onClick={() => setBriefOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-1/2 z-[70] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Round instructions"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold tracking-[0.22em] uppercase text-primary/70">
                  Round {roundNumber.toString().padStart(2, "0")}
                </span>
                <h2 className="font-serif text-lg text-foreground mt-0.5">Instructions</h2>
              </div>
              <button
                onClick={() => setBriefOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              {briefLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
                  <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
                  Loading…
                </div>
              ) : brief?.instructions ? (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap font-sans">
                  {brief.instructions}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic font-sans">
                  No instructions available.
                </p>
              )}

              {!briefLoading && (briefUploadsLoading || briefUploads.length > 0) && (
                <div className="mt-5 border-t border-border pt-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Paperclip size={10} className="text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.18em]">
                      Attachments
                    </span>
                  </div>
                  {briefUploadsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
                      Loading files…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {briefUploads.map((file, i) => {
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
                            <span className="text-[9px] font-bold text-primary/50 uppercase tracking-[0.12em] w-20 shrink-0 truncate">
                              {categoryLabel}
                            </span>
                            <span className="truncate flex-1 font-sans">{file.file_name}</span>
                            <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!briefLoading && brief?.created_at && (
              <div className="px-6 py-3 border-t border-border bg-muted/30">
                <p className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground/80 font-sans">
                  Submitted {format(new Date(brief.created_at), "d MMM yyyy 'at' HH:mm")}
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );

  const dropboxPanel = isAdmin && sceneId && projectId ? (
    <div className="mt-6 w-full max-w-sm mx-auto">
      <DropboxVisualsPanel
        sceneId={sceneId}
        projectId={projectId}
        sceneName={sceneName}
        onRoundSelected={(round, link, filename) => {}}
      />
    </div>
  ) : null;

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
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <div className="relative mb-6">
          <div className="h-16 w-16 rounded-full border-2 border-primary/20 flex items-center justify-center">
            <Clock className="h-8 w-8 text-primary animate-pulse" />
          </div>
        </div>
        <h3 className="font-serif text-2xl text-foreground mb-2">Production in Progress</h3>
        <p className="text-muted-foreground text-sm max-w-md font-sans">
          Round {roundNumber.toString().padStart(2, "0")} is currently in production.
          {endDate && (() => {
            const d = new Date(endDate);
            d.setHours(11, 0, 0, 0);
            const dateStr = d.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });
            return (
              <>
                {" "}It will be ready for review on
                <br />
                {dateStr} at 11:00am.
              </>
            );
          })()}
        </p>

        {/* Live progress bar — only when both timestamps form a valid window */}
        {window && (() => {
          const { start, end } = window;
          const totalSecs = differenceInSeconds(end, start);
          const elapsedSecs = differenceInSeconds(now, start);
          const ratio = elapsedSecs / totalSecs;
          const progress = Math.min(100, Math.max(0, ratio * 100));
          const remainingSecs = Math.max(0, differenceInSeconds(end, now));

          let remainingLabel: string;
          if (now < start) {
            remainingLabel = "Production has not started";
          } else if (remainingSecs <= 0) {
            remainingLabel = "Delivery expected at any moment";
          } else if (remainingSecs >= 86400) {
            const days = Math.ceil(remainingSecs / 86400);
            remainingLabel = `${days} day${days !== 1 ? "s" : ""} remaining`;
          } else if (remainingSecs >= 3600) {
            const hours = Math.ceil(remainingSecs / 3600);
            remainingLabel = `${hours} hour${hours !== 1 ? "s" : ""} remaining`;
          } else {
            const mins = Math.max(1, Math.ceil(remainingSecs / 60));
            remainingLabel = `${mins} minute${mins !== 1 ? "s" : ""} remaining`;
          }

          return (
            <div className="mt-10 w-full max-w-sm">
              <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                {/* Plain CSS transition keeps the bar fluid without re-animating
                    on every tick (no jitter, no overshoot). */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/60 transition-[width] duration-700 ease-linear"
                  style={{ width: `${progress}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground font-sans tracking-wide">
                {remainingLabel}
              </p>
            </div>
          );
        })()}
        {briefTrigger}

        {isAdmin && (
          <div
            className={`mt-8 w-full max-w-sm rounded-2xl border-2 border-dashed transition-colors ${
              isDragging
                ? "border-gold bg-gold/10"
                : "border-gold/40 bg-gold/5 hover:border-gold/70 hover:bg-gold/10"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) uploadRender(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={allowedTypes.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadRender(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center gap-2 px-6 py-5 text-gold disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm font-semibold tracking-wide font-sans">
                    Uploading…
                  </span>
                </>
              ) : (
                <>
                  <Upload size={20} />
                  <span className="text-sm font-semibold tracking-[0.14em] uppercase font-sans">
                    Upload round render
                  </span>
                  <span className="text-[11px] text-gold/70 font-sans normal-case tracking-normal">
                    Drag &amp; drop or click to browse · JPG, PNG, TIFF, WebP
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </motion.div>
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
      </>
    );
  }

  // If delivered but no assets
  if (assetCount === 0) {
    return (
      <>
        {adminStatusBar}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <p className="text-muted-foreground text-sm font-sans">No assets delivered yet for this round.</p>
          {briefTrigger}
        </motion.div>
        {dropboxPanel}
        {briefModal}
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
        />
      </div>
      {dropboxPanel}
      {briefModal}
    </>
  );
}