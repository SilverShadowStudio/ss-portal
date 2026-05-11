import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { createPortal } from "react-dom";
import { Download, Check, Send, History, X, MousePointer2, Paperclip, ExternalLink, Pencil, Eraser, ImageDown, Undo2, Redo2, Scissors, Eye, EyeOff, ShieldQuestion, MessageSquare } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PinChat } from "./PinChat";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { computeReviewWindow } from "@/lib/reviewWindow";
import { buildAssetDownloadName } from "@/lib/scenePhase";
import { logActivity } from "@/lib/activityLog";
import { toast as sonnerToast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";

interface Asset {
  id: string;
  filename: string;
  dropbox_path: string | null;
  storage_path: string | null;
  source: "dropbox" | "upload";
  version: number;
  is_current: boolean;
  file_size: number | null;
  created_at: string;
}

interface Comment {
  id: string;
  message: string;
  user_id: string;
  created_at: string;
}

interface Approval {
  id: string;
  status: "pending" | "approved" | "revision_requested";
  notes: string | null;
  user_id: string;
  created_at: string;
}

interface AssetViewerProps {
  sceneRoundId: string;
  projectName?: string;
  sceneName: string;
  roundNumber: number;
  onClose: () => void;
  /** Optional CTA shown inside the lightbox to start the next round. */
  onRequestNextRound?: () => void;
  nextRoundNumber?: number;
  /** Delivery timestamp of this round — surfaced beneath the preview as a
   *  subtle, clickable label that deep-links to the matching moment in the
   *  Timeline view. */
  deliveredAt?: string | null;
  /**
   * When a successor round has already been requested, the client should no
   * longer add new feedback here — every further note belongs to the next
   * round. We surface this with a soft banner above the viewer. The number
   * shown in the banner copy is `successorRoundNumber`.
   */
  isLocked?: boolean;
  successorRoundNumber?: number;
  /**
   * Optional sibling-round navigation. When provided, a "Round 01 / Round 02"
   * tab strip is rendered at the top-left of the visual so the client can
   * hop between rounds of the same scene without leaving the viewer.
   */
  siblingRounds?: { id: string; round_number: number; status?: string }[];
  onSelectRound?: (roundId: string) => void;
}

type Tab = "preview" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "Review" },
  { id: "files", label: "Brief" },
];

export function AssetViewer({ sceneRoundId, projectName, sceneName, roundNumber, onClose, onRequestNextRound, nextRoundNumber, deliveredAt, isLocked = false, successorRoundNumber, siblingRounds, onSelectRound }: AssetViewerProps) {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [newComment, setNewComment] = useState("");
  // Initial load only — round-to-round swaps don't flip back to "loading"
  // so the prior visual stays on screen until the new one is fetched,
  // producing an instant cross-cut instead of a spinner-flicker.
  const [loading, setLoading] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchAssets();
  }, [sceneRoundId]);

  useEffect(() => {
    if (selectedAsset) {
      fetchAssetDetails(selectedAsset.id);
      // Reset dimensions whenever the active asset changes — they will be
      // re-populated by the <img>'s onLoad handler below. We do NOT clear
      // thumbnailUrl here: keeping the previous frame visible until the new
      // one resolves avoids a black flash when hopping between rounds.
      setImgDimensions(null);
      if (selectedAsset.source === "dropbox" && selectedAsset.dropbox_path) {
        fetchThumbnail(selectedAsset.dropbox_path);
      } else if (selectedAsset.source === "upload" && selectedAsset.storage_path) {
        const path = selectedAsset.storage_path.replace(/^\/+/, "");
        const { data } = supabase.storage
          .from("round-uploads")
          .getPublicUrl(path);
        setThumbnailUrl(data.publicUrl);
      }
    }
  }, [selectedAsset]);

  async function fetchAssets() {
    try {
      const { data, error } = await supabase
        .from("round_assets")
        .select("*")
        .eq("scene_round_id", sceneRoundId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const typed: Asset[] = (data || []).map((a) => ({
        ...a,
        source: a.source as "dropbox" | "upload",
      }));
      setAssets(typed);
      const current = typed.find((a) => a.is_current) || typed[0];
      if (current) setSelectedAsset(current);
    } catch (err) {
      console.error("Error fetching assets:", err);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  }

  async function fetchAssetDetails(assetId: string) {
    try {
      const { data: commentsData } = await supabase
        .from("asset_comments")
        .select("*")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: true });
      setComments(commentsData || []);

      const { data: session } = await supabase.auth.getSession();
      if (session?.session?.user) {
        const { data: approvalData } = await supabase
          .from("asset_approvals")
          .select("*")
          .eq("asset_id", assetId)
          .eq("user_id", session.session.user.id)
          .maybeSingle();
        if (approvalData) {
          setApproval({
            ...approvalData,
            status: approvalData.status as Approval["status"],
          });
        } else {
          setApproval(null);
        }
      }
    } catch (err) {
      console.error("Error fetching asset details:", err);
    }
  }

  async function fetchThumbnail(path: string) {
    try {
      const session = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dropbox-api?action=get-thumbnail`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.data.session?.access_token}`,
          },
          body: JSON.stringify({ path, size: "w640h480" }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        setThumbnailUrl(data.thumbnail);
      }
    } catch (err) {
      console.error("Error fetching thumbnail:", err);
    }
  }

  async function handleDownload() {
    if (!selectedAsset) return;
    setIsDownloading(true);
    try {
      let downloadUrl: string | null = null;
      if (selectedAsset.source === "upload" && selectedAsset.storage_path) {
        const path = selectedAsset.storage_path.replace(/^\/+/, "");
        const { data } = supabase.storage
          .from("round-uploads")
          .getPublicUrl(path);
        downloadUrl = data.publicUrl;
      } else if (selectedAsset.source === "dropbox" && selectedAsset.dropbox_path) {
        const session = await supabase.auth.getSession();
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dropbox-api?action=get-temporary-link`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.data.session?.access_token}`,
            },
            body: JSON.stringify({ path: selectedAsset.dropbox_path }),
          }
        );
        if (!response.ok) throw new Error("Failed to get download link");
        const data = await response.json();
        downloadUrl = data.link;
      }
      if (downloadUrl) {
        // Fetch as blob and trigger an automatic file save so the browser
        // writes directly to the user's default download location instead of
        // opening the asset in a new tab.
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error("Failed to fetch asset");
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = buildAssetDownloadName(
          projectName,
          sceneName,
          roundNumber,
          selectedAsset.filename
        );
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      console.error("Download error:", err);
      toast({
        title: "Download failed",
        description: "Could not generate download link",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleAddComment() {
    if (!selectedAsset || !newComment.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("asset_comments").insert({
        asset_id: selectedAsset.id,
        user_id: session.session.user.id,
        message: newComment.trim(),
      });
      if (error) throw error;
      setNewComment("");
      fetchAssetDetails(selectedAsset.id);
      toast({ title: "Feedback added" });
    } catch (err) {
      console.error("Comment error:", err);
      toast({
        title: "Error",
        description: "Failed to add feedback",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApproval(status: "approved" | "revision_requested") {
    if (!selectedAsset) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("asset_approvals").upsert(
        {
          asset_id: selectedAsset.id,
          user_id: session.session.user.id,
          status,
        },
        { onConflict: "asset_id,user_id" }
      );
      if (error) throw error;
      fetchAssetDetails(selectedAsset.id);
      // Activity log: approval/revision request.
      await logActivity({
        action: status === "approved" ? "asset_approved" : "revision_requested",
        description:
          status === "approved"
            ? `Approved ${selectedAsset.filename}`
            : `Requested revision on ${selectedAsset.filename}`,
        entityType: "round_asset",
        entityId: selectedAsset.id,
        metadata: { filename: selectedAsset.filename },
      });
      toast({
        title: status === "approved" ? "Asset approved" : "Revision requested",
      });
    } catch (err) {
      console.error("Approval error:", err);
      toast({
        title: "Error",
        description: "Failed to update approval status",
        variant: "destructive",
      });
    }
  }

  const currentFileName = selectedAsset?.filename;
  const versionHistory = assets
    .filter((a) => a.filename === currentFileName)
    .sort((a, b) => b.version - a.version);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground font-sans text-sm">No assets delivered yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs row — sibling-round picker on the left, view tabs + download on the right. */}
      <div className="flex items-end justify-between gap-6 border-b border-border">
        <nav className="flex items-center gap-8">
          {(siblingRounds && siblingRounds.length > 1
            ? [...siblingRounds].sort((a, b) => a.round_number - b.round_number)
            : []
          ).map((r) => {
            const isActive = r.round_number === roundNumber;
            const label = `Round ${r.round_number.toString().padStart(2, "0")}`;
            const statusDot =
              r.status === "approved"
                ? "bg-emerald-500"
                : r.status === "client_review" || r.status === "delivered"
                ? "bg-red-500"
                : r.status === "in_progress" || r.status === "pending"
                ? "bg-yellow-400"
                : "bg-muted-foreground/40";
            const statusLabel =
              r.status === "approved"
                ? "Approved"
                : r.status === "client_review" || r.status === "delivered"
                ? "Awaiting Review"
                : r.status === "in_progress" || r.status === "pending"
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
        <nav className="flex items-center gap-8">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!selectedAsset || isDownloading}
            title="Download full-resolution file"
            aria-label="Download full-resolution file"
            className="pb-3 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4" />
          </button>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative pb-3 text-sm font-medium font-sans transition-colors",
                  isActive
                    ? "text-gold"
                    : "text-foreground/40 hover:text-foreground/70"
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-gold rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* PREVIEW TAB — large, framed visual */}
      {activeTab === "preview" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => thumbnailUrl && setLightboxOpen(true)}
            disabled={!thumbnailUrl}
            className="group relative block w-full overflow-hidden bg-secondary disabled:cursor-default cursor-zoom-in"
            aria-label="View full size"
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={selectedAsset?.filename}
                className="block w-full h-auto transition-transform duration-300 group-hover:scale-[1.01]"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setImgDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
              />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              </div>
            )}
          </button>

          {/* Metadata row — original dimensions, file size and format. */}
          {thumbnailUrl && selectedAsset && (
            <div className="flex w-full items-center justify-between gap-4">
              {deliveredAt ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate("/timeline", {
                      state: { focusRoundId: sceneRoundId, focusAt: deliveredAt },
                    })
                  }
                  className="font-sans text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline tabular-nums"
                  title="View in timeline"
                >
                  Delivered {format(new Date(deliveredAt), "d MMM yyyy 'at' HH:mm")}
                </button>
              ) : (
                <span />
              )}
              <AssetMetaBadge
                filename={selectedAsset.filename}
                fileSize={selectedAsset.file_size}
                width={imgDimensions?.w}
                height={imgDimensions?.h}
              />
            </div>
          )}

          {/* Locked banner — shown beneath the visual, lower-left. The round
              is read-only because a newer round already exists on this scene;
              existing comments/pins stay visible for reference. */}
          {isLocked && (
            <div
              className="flex items-start gap-3 rounded-2xl border border-gold/30 bg-[#181613] px-4 py-3 max-w-2xl"
              role="status"
            >
              <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
              <p className="text-[12px] leading-relaxed text-foreground/80 font-sans">
                {successorRoundNumber
                  ? `This round is closed for new feedback — please add any further notes to Round ${successorRoundNumber.toString().padStart(2, "0")}.`
                  : `This round is closed for new feedback — please add any further notes to the latest round.`}
              </p>
            </div>
          )}

          {/* Thumbnail strip when multiple current assets */}
          {assets.filter((a) => a.is_current).length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
              {assets
                .filter((a) => a.is_current)
                .map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedAsset(asset)}
                    className={cn(
                      "shrink-0 rounded-lg border px-3 py-2 text-xs font-sans transition-colors",
                      selectedAsset?.id === asset.id
                        ? "border-gold bg-[#1C1A17] text-gold"
                        : "border-border text-muted-foreground hover:border-gold/50"
                    )}
                  >
                    {asset.filename.length > 22
                      ? asset.filename.slice(0, 19) + "…"
                      : asset.filename}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* FILES TAB — file metadata + download + version history */}
      {activeTab === "files" && (
        <PreviousBriefPanel sceneRoundId={sceneRoundId} />
      )}

      {/* Lightbox — full-screen black overlay, zoom + pan with mouse wheel */}
      {lightboxOpen && thumbnailUrl && (
        <Lightbox
          src={thumbnailUrl}
          alt={selectedAsset?.filename ?? ""}
          assetId={selectedAsset?.id ?? null}
          sceneRoundId={sceneRoundId}
          roundNumber={roundNumber}
          projectName={projectName}
          sceneName={sceneName}
          onClose={() => setLightboxOpen(false)}
          onRequestNextRound={onRequestNextRound}
          nextRoundNumber={nextRoundNumber}
          isLocked={isLocked}
        />
      )}
    </div>
  );
}

// Tiny inline icon to avoid pulling another import just for the revision badge.
function MessageSquareIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * Previous brief — shows the instructions, attached files, client name and
 * submission date for this round. All data is fetched lazily based on the
 * scene_round_id passed in from the parent.
 */
function PreviousBriefPanel({ sceneRoundId }: { sceneRoundId: string }) {
  const [loading, setLoading] = useState(true);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [files, setFiles] = useState<
    { category: string; file_name: string; storage_path: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: round } = await supabase
        .from("scene_rounds")
        .select("instructions, created_at, scene_id, scenes!inner(project_id, projects!inner(user_id))")
        .eq("id", sceneRoundId)
        .maybeSingle();
      if (cancelled) return;

      const sceneId = round?.scene_id ?? null;
      const userId = (round as any)?.scenes?.projects?.user_id ?? null;
      setInstructions(round?.instructions ?? null);
      setSubmittedAt(round?.created_at ?? null);

      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, full_name, company")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        const composed =
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
          profile?.full_name ||
          profile?.company ||
          null;
        setClientName(composed);
      }

      if (sceneId) {
        const { data: uploads } = await supabase
          .from("round_uploads")
          .select("category, file_name, storage_path")
          .eq("scene_id", sceneId);
        if (cancelled) return;
        setFiles(uploads || []);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sceneRoundId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — client name + submitted date */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.22em] uppercase text-muted-foreground/80">
              Submitted by
            </p>
            <p className="font-serif text-base text-foreground mt-0.5 truncate">
              {clientName || "—"}
            </p>
          </div>
          {submittedAt && (
            <p className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground/80 font-sans">
              {new Date(submittedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              ·{" "}
              {new Date(submittedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-[10px] font-semibold tracking-[0.22em] uppercase text-muted-foreground/80 mb-2">
          Instructions
        </p>
        {instructions ? (
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap font-sans">
            {instructions}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic font-sans">
            No instructions provided.
          </p>
        )}
      </div>

      {/* Attachments */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <Paperclip size={11} className="text-muted-foreground" />
          <p className="text-[10px] font-semibold tracking-[0.22em] uppercase text-muted-foreground/80">
            Attachments
          </p>
        </div>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground italic font-sans">
            No files were attached.
          </p>
        ) : (
          <div className="space-y-1.5">
            {files.map((file, i) => {
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
                  <span className="text-[9px] font-bold text-primary/50 uppercase tracking-[0.12em] w-24 shrink-0 truncate">
                    {categoryLabel}
                  </span>
                  <span className="truncate flex-1 font-sans">{file.file_name}</span>
                  <ExternalLink
                    size={10}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen image viewer with mouse-wheel zoom (1× → 20×) anchored at the
 * cursor, click-and-drag pan when zoomed, and double-click to reset.
 *
 * Also hosts the annotation layer: clicking on the image (when not panning)
 * drops an elegant pin marker tied to a normalized image-space coordinate.
 * Clicking an existing pin opens its chat panel.
 */
/**
 * Tiny `<kbd>` chip used inside lightbox tooltips to surface the keyboard
 * shortcut for each action. Sits flush with the tooltip's text baseline.
 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded border border-border/60 bg-muted px-1 font-sans text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}

export function Lightbox({
  src,
  alt,
  assetId,
  sceneRoundId,
  roundNumber,
  projectName,
  sceneName,
  onClose,
  onRequestNextRound,
  nextRoundNumber,
  isLocked = false,
  ephemeral = false,
  onSaveAnnotation,
  saveLabel = "Save annotation",
}: {
  src: string;
  alt: string;
  assetId: string | null;
  sceneRoundId: string;
  roundNumber: number;
  projectName?: string;
  sceneName: string;
  onClose: () => void;
  onRequestNextRound?: () => void;
  nextRoundNumber?: number;
  isLocked?: boolean;
  /**
   * When true, the Lightbox runs entirely in-memory: no Supabase reads,
   * inserts, deletes, or realtime subscriptions. Pins/strokes live only
   * in local state and are designed to be flattened into a single PNG
   * via `onSaveAnnotation`. Used by the new-task popup so the same tool
   * powers both the round viewer and the request flow.
   */
  ephemeral?: boolean;
  /** Called with a flattened PNG data URL when the user hits Save. */
  onSaveAnnotation?: (dataUrl: string) => void;
  saveLabel?: string;
}) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 20;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const didPan = useRef(false);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null
  );

  // Annotation state
  type Pin = {
    id: string;
    x: number;
    y: number;
    created_by: string;
    resolved_at: string | null;
  };
  const [pins, setPins] = useState<Pin[]>([]);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Map of user_id -> first-name initial, used inside the pin bubble.
  const [pinInitials, setPinInitials] = useState<Record<string, string>>({});
  const [annotateMode, setAnnotateMode] = useState(!isLocked);
  const { toast } = useToast();
  const { isAdmin } = useUserRole();

  // Drawing state — strokes are stored as normalized [0..1] polylines
  // anchored to the intrinsic image box, so they survive zoom/pan.
  // Persisted strokes carry a DB id; in-flight strokes use a temporary
  // negative timestamp id until the insert returns.
  type Stroke = {
    id: string;
    points: { x: number; y: number }[];
    created_by: string | null;
    pending?: boolean;
  };
  const [drawMode, setDrawMode] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  // When enabled, single-click erases ask for confirmation first. Drag-sweep
  // erases stay unconfirmed since the gesture itself is intentional.
  const [confirmErase, setConfirmErase] = useState(false);
  // Stroke id queued for the confirm dialog (null = dialog closed).
  const [pendingEraseId, setPendingEraseId] = useState<string | null>(null);
  // Pin id queued for the inline delete confirm dialog (null = closed).
  const [pendingDeletePinId, setPendingDeletePinId] = useState<string | null>(
    null
  );
  // Session-scoped opt-out: if true, the × badge deletes immediately
  // (still with an Undo toast) without showing the confirm dialog. Reset
  // on every viewer mount so it's truly per-session and never persisted.
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
  // Local checkbox state for the dialog — applied only if the user
  // confirms the deletion.
  const [dontAskAgainChecked, setDontAskAgainChecked] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const isDrawing = useRef(false);
  const currentStrokeIdRef = useRef<string | null>(null);
  // Erase-drag state — when the user holds the pointer down in erase mode,
  // we sweep across strokes and remove every one the cursor crosses, while
  // tracking which we've already erased so each is queued only once.
  const isErasing = useRef(false);
  const erasedDuringDragRef = useRef<Set<string>>(new Set());
  // Tracks whether the pointer moved meaningfully during an erase drag, so
  // we can distinguish a single click from a sweep at pointer-up time.
  const eraseDragMovedRef = useRef(false);
  // First stroke under the pointer at pointer-down. Used when confirmErase
  // is on so we know what to delete after the user accepts the dialog.
  const eraseDownHitRef = useRef<string | null>(null);
  // Pointer-down location, used to apply a small movement threshold before
  // treating the gesture as a drag-sweep rather than a click.
  const eraseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  // rAF-throttle state for erase pointer-move hit-testing. Rapid pointer
  // events (especially on high-rate mice and trackpads, ~120–240Hz) coalesce
  // into one hit-test per animation frame so dragging across dense drawings
  // stays smooth. We keep the SVG element + the latest pointer sample so
  // the scheduled callback can re-run findStrokeAt against fresh coords.
  const erasePendingFrameRef = useRef<number | null>(null);
  const erasePendingSampleRef = useRef<{
    svg: SVGSVGElement;
    clientX: number;
    clientY: number;
    tolerancePx: number;
    pointerType: string;
    isDragging: boolean;
  } | null>(null);
  // Stroke currently under the cursor while erase mode is active. Used to
  // render a brighter preview outline so the user can see exactly which
  // stroke a click would remove. Cleared on pointer leave / mode exit.
  const [hoveredEraseId, setHoveredEraseId] = useState<string | null>(null);
  // Drop the hover preview whenever the eraser is turned off, so a stale
  // highlight doesn't linger when the user switches tools.
  useEffect(() => {
    if (!eraseMode) setHoveredEraseId(null);
  }, [eraseMode]);
  // Redo stack — strokes the user just undid, in chronological order.
  // Cleared whenever a new stroke is drawn so we never resurrect a stale
  // history branch.
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const PEN_COLOR = "#39FF14"; // saturated fluo green

  // Visibility toggles for the lightbox overlays. Defaults: everything on.
  //   - showMyPins / showOthersPins  → pin markers, split by author so each
  //     audience can be hidden independently.
  //   - showMyDrawings / showOthersDrawings → green strokes, same idea.
  const [showMyPins, setShowMyPins] = useState(true);
  const [showOthersPins, setShowOthersPins] = useState(true);
  const [showMyDrawings, setShowMyDrawings] = useState(true);
  const [showOthersDrawings, setShowOthersDrawings] = useState(true);

  // Strokes the user has just deleted (undo / clear / per-stroke erase).
  // Used to suppress realtime echoes from re-introducing them while the DB
  // delete is still in flight, which previously caused undone strokes to
  // briefly reappear when the user immediately drew again.
  const recentlyDeletedRef = useRef<Set<string>>(new Set());

  // Custom cursor position (in viewport coords) for the annotate-mode crosshair.
  // We render an SVG that follows the pointer with mix-blend-mode: difference,
  // so it appears black on light areas and white on dark areas — and never shows
  // a shadow.
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );
  // Tracks whether the pointer is currently hovering the image bounds. The
  // crosshair / hidden cursor only applies inside this rectangle so the user
  // sees the regular pointer over the surrounding lightbox chrome.
  const [isOverImage, setIsOverImage] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  // Persist the in-flight stroke (the one tagged `pending`). Called on
  // pointer-up. We resolve the scene_round_id lazily (same pattern as pins)
  // so the Lightbox API stays minimal.
  const persistCurrentStroke = useCallback(async () => {
    const tempId = currentStrokeIdRef.current;
    currentStrokeIdRef.current = null;
    if (ephemeral) {
      // Promote the in-flight stroke to a "saved" local stroke. No DB.
      if (!tempId) return;
      setStrokes((prev) =>
        prev.map((s) => (s.id === tempId ? { ...s, pending: false } : s))
          .filter((s) => s.id !== tempId || s.points.length > 0)
      );
      return;
    }
    if (!tempId || !assetId || !userId) return;

    // Snapshot the stroke to insert.
    // We use a Promise that resolves inside the setState updater so we read
    // the latest committed strokes (rather than a stale closure value), but
    // still get a synchronous reference for the insert below. This avoids
    // React 18 strict-mode pitfalls where reading a let-captured value
    // immediately after `setStrokes` can race against the updater.
    const toInsert = await new Promise<Stroke | null>((resolve) => {
      setStrokes((prev) => {
        const found = prev.find((s) => s.id === tempId) ?? null;
        resolve(found);
        return prev;
      });
    });
    if (!toInsert || toInsert.points.length === 0) {
      // Drop empty strokes (a click that didn't produce a path).
      setStrokes((prev) => prev.filter((s) => s.id !== tempId));
      return;
    }

    try {
      const sceneRoundIdResolved = await resolveSceneRoundId(assetId);
      const { data, error } = await supabase
        .from("asset_drawings")
        .insert({
          asset_id: assetId,
          scene_round_id: sceneRoundIdResolved,
          created_by: userId,
          points: toInsert.points,
          color: PEN_COLOR,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Insert failed");
      // Replace the temp id with the real one, but KEEP the `pending` flag
      // set until the realtime echo (`fetchDrawings`) confirms the row is
      // visible in SELECT. Otherwise a fetch that fires before replication
      // catches up would wipe the just-saved stroke from local state.
      setStrokes((prev) =>
        prev.map((s) =>
          s.id === tempId ? { ...s, id: data.id as string } : s
        )
      );
    } catch (err) {
      console.error("Stroke persist error:", err);
      // Roll back — don't silently keep a stroke the server didn't accept.
      setStrokes((prev) => prev.filter((s) => s.id !== tempId));
      toast({
        title: "Couldn't save drawing",
        description: "Your latest stroke wasn't saved. Try again.",
        variant: "destructive",
      });
    }
  }, [assetId, userId, toast, ephemeral]);

  // Delete a single stroke from the database. RLS guarantees clients can
  // only erase their own strokes; admins can erase anything.
  const eraseStroke = useCallback(
    async (strokeId: string) => {
      // Optimistic remove.
      const snapshot: Stroke[] = [];
      setStrokes((prev) => {
        snapshot.push(...prev);
        return prev.filter((s) => s.id !== strokeId);
      });
      // Pending strokes only live locally — nothing to delete server-side.
      const target = snapshot.find((s) => s.id === strokeId);
      if (!target || target.pending) return;
      if (ephemeral) return; // Local-only mode — nothing to delete server-side.
      // Remember this id briefly so the realtime echo of our own DELETE
      // (or a stale fetchDrawings re-pull) cannot re-introduce the row
      // we just removed locally.
      recentlyDeletedRef.current.add(strokeId);
      window.setTimeout(() => {
        recentlyDeletedRef.current.delete(strokeId);
      }, 8000);

      const { error } = await supabase
        .from("asset_drawings")
        .delete()
        .eq("id", strokeId);
      if (error) {
        console.error("Stroke erase error:", error);
        // The delete failed — allow the row to come back via fetch.
        recentlyDeletedRef.current.delete(strokeId);
        // Restore on failure.
        setStrokes(snapshot);
        toast({
          title: "Couldn't erase",
          description: error.message,
          variant: "destructive",
        });
      }
    },
    [toast, ephemeral]
  );

  // Hit-test: return the id of the closest erasable stroke to a viewport
  // (clientX, clientY) point, or null if none is within the tolerance.
  // Used by both single-click and drag-sweep erasing so the behaviour is
  // consistent.
  const findStrokeAt = useCallback(
    (
      svg: SVGSVGElement,
      clientX: number,
      clientY: number,
      tolerancePx?: number
    ): string | null => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const cx = (clientX - rect.left) / rect.width;
      const cy = (clientY - rect.top) / rect.height;
      // Default ~16 CSS px tolerance for mouse pointers, scaled per axis
      // since the viewBox is 1×1 stretched with preserveAspectRatio="none".
      // Callers (touch / pen) can pass a larger value derived from the
      // pointer's contact size and the device pixel ratio.
      const TOL_PX = tolerancePx ?? 16;
      const tolX = TOL_PX / rect.width;
      const tolY = TOL_PX / rect.height;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const s of strokes) {
        if (!(s.created_by === userId || isAdmin)) continue;
        if (!showMyDrawings && s.created_by === userId) continue;
        if (s.points.length === 0) continue;
        for (let i = 0; i < s.points.length; i++) {
          const a = s.points[i];
          const b = s.points[i + 1] ?? a;
          const ax = (a.x - cx) / tolX;
          const ay = (a.y - cy) / tolY;
          const bx = (b.x - cx) / tolX;
          const by = (b.y - cy) / tolY;
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy;
          let t = 0;
          if (len2 > 0) {
            t = -(ax * dx + ay * dy) / len2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
          }
          const px = ax + t * dx;
          const py = ay + t * dy;
          const d = Math.sqrt(px * px + py * py);
          if (d < bestDist) {
            bestDist = d;
            bestId = s.id;
          }
        }
      }
      return bestDist <= 1 ? bestId : null;
    },
    [strokes, userId, isAdmin, showMyDrawings]
  );

  // Compute a CSS-pixel erase tolerance that adapts to the input device.
  //   • Mouse: keeps the tight 16px default — precise pointing is expected.
  //   • Touch / pen: starts from a larger 28px base (closer to a fingertip)
  //     and grows further when the browser reports a contact size via
  //     pointerEvent.width/height (Android, some styluses).
  //   • High-DPI screens: a small DPR-based bonus so retina/AMOLED phones
  //     don't end up with a tolerance that's tiny in physical millimetres.
  // The result is clamped so a single tap can never wipe out a huge area.
  const tolerancePxFor = useCallback(
    (e: React.PointerEvent): number => {
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 4));
      if (e.pointerType === "mouse") {
        return 16 + (dpr - 1) * 2; // 16–22px depending on DPR
      }
      // Touch / pen path. PointerEvent.width|height is in CSS px and
      // approximates the contact ellipse; many browsers report 1 when the
      // hardware doesn't expose it, so we floor the contribution.
      const contact = Math.max(e.width || 0, e.height || 0);
      const base = 28 + (dpr - 1) * 4; // 28–40px depending on DPR
      const fromContact = contact > 1 ? contact * 0.75 : 0;
      const tol = base + fromContact;
      // Clamp: never below the mouse default, never above ~64px so accuracy
      // stays reasonable when strokes are densely packed.
      return Math.min(64, Math.max(20, tol));
    },
    []
  );

  // rAF-batched flush for the latest erase pointer-move sample. Runs the
  // expensive findStrokeAt + setHoveredEraseId + (optional) eraseStroke
  // path at most once per animation frame, regardless of how many native
  // pointermove events fired.
  const flushErasePointerSample = useCallback(() => {
    erasePendingFrameRef.current = null;
    const sample = erasePendingSampleRef.current;
    erasePendingSampleRef.current = null;
    if (!sample) return;
    if (!eraseMode) return;
    const { svg, clientX, clientY, tolerancePx, pointerType, isDragging } =
      sample;
    const hit = findStrokeAt(svg, clientX, clientY, tolerancePx);
    if (pointerType !== "touch") {
      setHoveredEraseId((prev) => (prev === hit ? prev : hit));
    }
    if (
      isDragging &&
      hit &&
      !erasedDuringDragRef.current.has(hit)
    ) {
      erasedDuringDragRef.current.add(hit);
      eraseStroke(hit);
    }
  }, [eraseMode, findStrokeAt, eraseStroke]);

  // Cancel any queued erase frame on unmount so we don't run a stale
  // hit-test against an unmounted SVG.
  useEffect(() => {
    return () => {
      if (erasePendingFrameRef.current !== null) {
        cancelAnimationFrame(erasePendingFrameRef.current);
        erasePendingFrameRef.current = null;
      }
      erasePendingSampleRef.current = null;
    };
  }, []);

  // Load pins for this asset.
  const fetchPins = useCallback(async () => {
    if (!assetId) return;
    const { data, error } = await supabase
      .from("asset_pins")
      .select("id, x, y, created_by, resolved_at")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Pins fetch error:", error);
      return;
    }
    setPins(
      (data || []).map((p: any) => ({
        ...p,
        x: Number(p.x),
        y: Number(p.y),
      }))
    );
  }, [assetId]);

  useEffect(() => {
    if (ephemeral) return;
    fetchPins();
    if (!assetId) return;
    const channel = supabase
      .channel(`pins-${assetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "asset_pins",
          filter: `asset_id=eq.${assetId}`,
        },
        () => fetchPins()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [assetId, fetchPins, ephemeral]);

  // Load freehand drawings for this asset (persisted in `asset_drawings`).
  // Strokes coexist with pins: same lifecycle, same anchoring, same realtime
  // refresh pattern.
  const fetchDrawings = useCallback(async () => {
    if (!assetId) return;
    const { data, error } = await supabase
      .from("asset_drawings")
      .select("id, points, created_by")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Drawings fetch error:", error);
      return;
    }
    setStrokes((prev) => {
      const persisted: Stroke[] = (data || []).map((d: any) => ({
        id: d.id as string,
        points: Array.isArray(d.points) ? d.points : [],
        created_by: d.created_by as string | null,
      })).filter((s) => !recentlyDeletedRef.current.has(s.id));
      const persistedIds = new Set(persisted.map((p) => p.id));
      // Preserve any in-flight stroke (pending insert) so the current pen
      // gesture doesn't blink out when the realtime echo arrives. Drop
      // pendings that have already been confirmed by the persisted set so
      // we don't render duplicates of the same stroke.
      const pending = prev.filter((s) => s.pending && !persistedIds.has(s.id));
      return [...persisted, ...pending];
    });
  }, [assetId]);

  useEffect(() => {
    if (ephemeral) return;
    fetchDrawings();
    if (!assetId) return;
    const channel = supabase
      .channel(`drawings-${assetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "asset_drawings",
          filter: `asset_id=eq.${assetId}`,
        },
        () => fetchDrawings()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [assetId, fetchDrawings, ephemeral]);

  // Resolve two initials (first + last name) for every pin author so the
  // bubble can show them. Falls back to the first two letters of full_name,
  // then a single letter, then "?".
  useEffect(() => {
    const ids = Array.from(
      new Set(pins.map((p) => p.created_by).filter(Boolean))
    ).filter((id) => !(id in pinInitials));
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name, full_name")
        .in("user_id", ids);
      if (cancelled || error || !data) return;
      setPinInitials((prev) => {
        const next = { ...prev };
        for (const row of data as any[]) {
          const first = row.first_name ? String(row.first_name).trim() : "";
          const last = row.last_name ? String(row.last_name).trim() : "";
          let initials = "";
          if (first || last) {
            initials = `${first[0] ?? ""}${last[0] ?? ""}`;
          } else if (row.full_name) {
            // Use first letter of first two whitespace-separated tokens.
            const parts = String(row.full_name).trim().split(/\s+/);
            initials = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`;
          }
          next[row.user_id] = initials ? initials.toUpperCase() : "?";
        }
        // Mark any unresolved id as "?" so we don't refetch each render.
        for (const id of ids) if (!(id in next)) next[id] = "?";
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pins, pinInitials]);

  // Close on Escape — keeps parent component clean.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openPinId) setOpenPinId(null);
        else onClose();
        return;
      }
      // Ignore shortcuts when typing in an input/textarea/contenteditable
      // (e.g. a pin chat) so we don't hijack normal text entry.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      // Tools
      if (k === "p") {
        if (isLocked) return;
        setAnnotateMode((v) => {
          const next = !v;
          if (next) {
            setDrawMode(false);
            setEraseMode(false);
          }
          return next;
        });
      } else if (k === "d") {
        if (isLocked) return;
        setDrawMode((v) => {
          const next = !v;
          if (next) {
            setAnnotateMode(false);
            setEraseMode(false);
          }
          return next;
        });
      } else if (k === "e") {
        if (isLocked) return;
        setEraseMode((v) => {
          const next = !v;
          if (next) {
            setDrawMode(false);
            setAnnotateMode(false);
          }
          return next;
        });
      }
      // Visibility toggles
      else if (k === "1") setShowMyPins((v) => !v);
      else if (k === "2") setShowOthersPins((v) => !v);
      else if (k === "3") setShowMyDrawings((v) => !v);
      else if (k === "4") setShowOthersDrawings((v) => !v);
      // Close
      else if (k === "c") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, openPinId]);

  // Disable native page scroll while the lightbox is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Delete a pin (and its messages) by id. Used by both the chat panel's
  // delete button and the inline × badge on the marker. Shows an "Undo"
  // toast that restores the pin and its conversation if clicked.
  const deletePinById = useCallback(
    async (pinId: string) => {
      const pinIndex = pins.findIndex((p) => p.id === pinId);
      if (pinIndex === -1) return;
      const pin = pins[pinIndex];
      // Pin numbers are 1-based, matching the order shown in PinChat.
      const pinNumber = pinIndex + 1;

      // Snapshot the pin + its full conversation so we can restore them.
      const { data: msgRows } = await supabase
        .from("asset_pin_messages")
        .select("*")
        .eq("pin_id", pinId);
      const messageBackup = msgRows || [];

      await supabase.from("asset_pin_messages").delete().eq("pin_id", pinId);
      const { error } = await supabase
        .from("asset_pins")
        .delete()
        .eq("id", pinId);
      if (error) {
        toast({
          title: "Couldn't delete pin",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const deletedPin = pin;
      setPins((prev) => prev.filter((p) => p.id !== pinId));
      if (openPinId === pinId) setOpenPinId(null);

      sonnerToast.success(`Pin #${pinNumber} deleted`, {
        description: messageBackup.length
          ? `${messageBackup.length} message${messageBackup.length === 1 ? "" : "s"} removed.`
          : undefined,
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            const restoredSceneRoundId = await resolveSceneRoundId(assetId!);
            const { error: pinErr } = await supabase
              .from("asset_pins")
              .insert({
                id: deletedPin.id,
                asset_id: assetId!,
                scene_round_id: restoredSceneRoundId,
                x: deletedPin.x,
                y: deletedPin.y,
                created_by: deletedPin.created_by,
                resolved_at: deletedPin.resolved_at,
              });
            if (pinErr) {
              sonnerToast.error("Couldn't restore pin", {
                description: pinErr.message,
              });
              return;
            }
            if (messageBackup.length > 0) {
              const { error: msgErr } = await supabase
                .from("asset_pin_messages")
                .insert(messageBackup as any);
              if (msgErr) console.error("Restore messages error:", msgErr);
            }
            setPins((prev) => [...prev, deletedPin]);
            sonnerToast.success(`Pin #${pinNumber} restored`);
          },
        },
      });
    },
    [pins, openPinId, assetId, toast]
  );

  // Wheel handler. We attach it as a non-passive listener so we can preventDefault
  // (React's onWheel is passive by default in modern browsers).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Cursor position relative to the container center (image is centered).
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;

      // Smooth exponential zoom — feels natural across the full 1×–20× range.
      const zoomFactor = Math.exp(-e.deltaY * 0.0015);

      setScale((prevScale) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * zoomFactor));
        if (next === prevScale) return prevScale;

        // Anchor zoom at the cursor: keep the image point under the cursor fixed.
        // Image-space coord under cursor before zoom: (cx - tx) / prevScale.
        // After zoom we want the same image point at the same screen point, so:
        //   cx = nextTx + imgX * next  →  nextTx = cx - imgX * next.
        setTx((prevTx) => cx - ((cx - prevTx) / prevScale) * next);
        setTy((prevTy) => cy - ((cy - prevTy) / prevScale) * next);

        // When fully zoomed out, recenter so the image fits cleanly.
        if (next === MIN_SCALE) {
          setTx(0);
          setTy(0);
        }
        return next;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Pan only kicks in when zoomed; otherwise we leave click handling to
      // the image (pin drop) and the backdrop (close).
      didPan.current = false;
      if (drawMode) return;
      if (scale <= MIN_SCALE) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    },
    [scale, tx, ty, drawMode]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Track pointer for the custom blended crosshair cursor.
      setCursorPos({ x: e.clientX, y: e.clientY });
      if (!isPanning || !panStart.current) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) didPan.current = true;
      setTx(panStart.current.tx + dx);
      setTy(panStart.current.ty + dy);
    },
    [isPanning]
  );

  const endPan = useCallback(() => {
    setIsPanning(false);
    panStart.current = null;
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  // Click on the backdrop (outside the image) closes — but only when not zoomed
  // and not in the middle of a pan gesture.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (didPan.current) return;
    if (e.target === e.currentTarget && scale <= MIN_SCALE && !openPinId) {
      onClose();
    }
  };

  // Drop a pin where the user clicks on the image. Coordinates are normalized
  // against the image's intrinsic box so they survive zoom/pan and re-renders.
  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (didPan.current) return;
    if (isLocked) return;
    if (drawMode) return;
    if (!annotateMode) return;
    if (ephemeral) return; // No DB-backed pins in ephemeral mode (no chat target).
    if (!assetId || !userId) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    // Optimistic insert with a temporary id; replaced once the realtime
    // subscription returns the persisted row.
    const { data, error } = await supabase
      .from("asset_pins")
      .insert({
        asset_id: assetId,
        scene_round_id: await resolveSceneRoundId(assetId),
        x,
        y,
        created_by: userId,
      })
      .select("id, x, y, created_by, resolved_at")
      .single();

    if (error) {
      console.error("Pin insert error:", error);
      toast({
        title: "Couldn't drop pin",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setPins((prev) => [
      ...prev,
      { ...(data as any), x: Number(data.x), y: Number(data.y) },
    ]);
    setOpenPinId(data.id);
  }

  return createPortal(
    <div
      ref={containerRef}
      onClick={onBackdropClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => setCursorPos(null)}
      onDoubleClick={reset}
      className="fixed inset-0 z-[100] overflow-hidden bg-black/95 animate-fade-in select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Full size image"
      style={{
        cursor:
          // Annotate / draw modes always keep their target cursor over the
          // image, even after zooming in — otherwise the user loses the
          // crosshair the moment they magnify and can't place pins
          // accurately.
          isOverImage && drawMode
            ? "crosshair"
            : isOverImage && annotateMode
            ? "none"
            : scale > MIN_SCALE
            ? isPanning
              ? "grabbing"
              : "grab"
            : isOverImage
            ? "zoom-in"
            : "default",
      }}
    >
      {/* Top-right controls */}
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <div className="absolute top-5 right-5 z-30 flex items-center gap-1 rounded-full border border-white/10 bg-black/50 backdrop-blur-md px-2 py-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]">
        {/* ───────────── Tools ───────────── */}
        {/* Pin tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isLocked) return;
                setAnnotateMode((v) => {
                  const next = !v;
                  if (next) {
                    setDrawMode(false);
                    setEraseMode(false);
                  }
                  return next;
                });
              }}
              disabled={isLocked}
              className={cn(
                "rounded-full p-2 transition-colors",
                annotateMode
                  ? "border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
                  : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white",
                isLocked && "opacity-40 cursor-not-allowed hover:bg-white/10 hover:text-white/80"
              )}
              aria-label={annotateMode ? "Disable pin tool" : "Enable pin tool"}
            >
              <MousePointer2 size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="end"
            collisionPadding={12}
            avoidCollisions
            className="font-sans text-xs"
          >
            <span className="flex items-center gap-2">
              {annotateMode
                ? "Pin tool on — click the image to drop a pin"
                : "Pin tool — leave a comment on a spot"}
              <Kbd>P</Kbd>
            </span>
          </TooltipContent>
        </Tooltip>

        {/* Draw tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isLocked) return;
                setDrawMode((v) => {
                  const next = !v;
                  if (next) {
                    setAnnotateMode(false);
                    setEraseMode(false);
                  }
                  return next;
                });
              }}
              disabled={isLocked}
              className={cn(
                "rounded-full p-2 transition-colors",
                drawMode
                  ? "text-[#0a1a0a] hover:opacity-90"
                  : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white",
                isLocked && "opacity-40 cursor-not-allowed hover:bg-white/10 hover:text-white/80"
              )}
              style={drawMode ? { backgroundColor: PEN_COLOR } : undefined}
              aria-label={drawMode ? "Disable draw tool" : "Enable draw tool"}
            >
              <Pencil size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="end"
            collisionPadding={12}
            avoidCollisions
            className="font-sans text-xs"
          >
            <span className="flex items-center gap-2">
              {drawMode
                ? "Draw tool on — click and drag on the image"
                : "Draw tool — sketch on top of the image"}
              <Kbd>D</Kbd>
            </span>
          </TooltipContent>
        </Tooltip>

        {/* Per-stroke eraser — only meaningful when there are strokes. */}
        {strokes.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEraseMode((v) => {
                    const next = !v;
                    if (next) {
                      setDrawMode(false);
                      setAnnotateMode(false);
                    }
                    return next;
                  });
                }}
                className={cn(
                  "rounded-full p-2 transition-colors",
                  eraseMode
                    ? "bg-white text-[#0a1a0a] hover:opacity-90"
                    : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                )}
                aria-label={eraseMode ? "Disable per-stroke eraser" : "Erase a single stroke"}
              >
                <Scissors size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              <span className="flex items-center gap-2">
                {eraseMode
                  ? "Eraser on — click a stroke to remove it"
                  : "Erase a single stroke"}
                <Kbd>E</Kbd>
              </span>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Confirm-before-erase toggle — only while eraser is active. */}
        {eraseMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmErase((v) => !v);
                }}
                className={cn(
                  "rounded-full p-2 transition-colors",
                  confirmErase
                    ? "bg-white text-[#0a1a0a] hover:opacity-90"
                    : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                )}
                aria-label={
                  confirmErase
                    ? "Disable confirm before erasing"
                    : "Confirm before erasing a single stroke"
                }
              >
                <ShieldQuestion size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              {confirmErase
                ? "Confirm on — single-click erases will ask first"
                : "Ask to confirm single-click erases"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Undo last stroke (mine only) */}
        {strokes.some((s) => s.created_by === userId) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const mine = strokes
                    .filter((s) => s.created_by === userId)
                    .slice(-1)[0];
                  if (!mine) return;
                  setRedoStack((prev) => [...prev, mine]);
                  await eraseStroke(mine.id);
                }}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Undo last stroke"
              >
                <Undo2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              Undo your last stroke
            </TooltipContent>
          </Tooltip>
        )}

        {/* Redo */}
        {redoStack.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const last = redoStack[redoStack.length - 1];
                  setRedoStack((prev) => prev.slice(0, -1));
                  if (!assetId || !userId) return;
                  const tempId = `redo-${Date.now()}-${Math.random()}`;
                  setStrokes((prev) => [
                    ...prev,
                    { ...last, id: tempId, pending: true },
                  ]);
                  try {
                    const sceneRoundIdResolved = await resolveSceneRoundId(assetId);
                    const { data, error } = await supabase
                      .from("asset_drawings")
                      .insert({
                        asset_id: assetId,
                        scene_round_id: sceneRoundIdResolved,
                        created_by: userId,
                        points: last.points,
                        color: PEN_COLOR,
                      })
                      .select("id")
                      .single();
                    if (error || !data) throw error ?? new Error("Insert failed");
                    setStrokes((prev) =>
                      prev.map((s) =>
                        s.id === tempId
                          ? { ...s, id: data.id as string, pending: false }
                          : s
                      )
                    );
                  } catch (err) {
                    console.error("Redo error:", err);
                    setStrokes((prev) => prev.filter((s) => s.id !== tempId));
                    setRedoStack((prev) => [...prev, last]);
                    toast({
                      title: "Couldn't redo",
                      description: "Your stroke wasn't restored. Try again.",
                      variant: "destructive",
                    });
                  }
                }}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Redo stroke"
              >
                <Redo2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              Redo last undone stroke
            </TooltipContent>
          </Tooltip>
        )}

        {/* Clear all my strokes */}
        {strokes.some((s) => s.created_by === userId && !s.pending) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const mineIds = strokes
                    .filter((s) => s.created_by === userId && !s.pending)
                    .map((s) => s.id);
                  if (mineIds.length === 0) return;
                  setStrokes((prev) => prev.filter((s) => !mineIds.includes(s.id)));
                  mineIds.forEach((id) => {
                    recentlyDeletedRef.current.add(id);
                    window.setTimeout(
                      () => recentlyDeletedRef.current.delete(id),
                      8000
                    );
                  });
                  // Clearing also wipes the redo branch — those strokes are
                  // gone for good unless re-drawn manually.
                  setRedoStack([]);
                  const { error } = await supabase
                    .from("asset_drawings")
                    .delete()
                    .in("id", mineIds);
                  if (error) {
                    console.error("Clear drawings error:", error);
                    mineIds.forEach((id) => recentlyDeletedRef.current.delete(id));
                    fetchDrawings();
                    toast({
                      title: "Couldn't clear drawings",
                      description: error.message,
                      variant: "destructive",
                    });
                  }
                }}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Clear all your drawings"
              >
                <Eraser size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              Clear all your drawings
            </TooltipContent>
          </Tooltip>
        )}

        {/* ───────────── Visibility ───────────── */}
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />

        {/* Single eye button → dropdown with two toggles
            (hide my inputs / hide others' inputs). Each toggle controls both
            pins and drawings for that audience. */}
        {(() => {
          const hideMine = !showMyPins || !showMyDrawings;
          const hideOthers = !showOthersPins || !showOthersDrawings;
          const filtering = hideMine || hideOthers;
          return (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "rounded-full p-2 transition-colors relative",
                    "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                  )}
                  aria-label="Visibility filters"
                >
                  {filtering ? <EyeOff size={16} /> : <Eye size={16} />}
                  {filtering && (
                    <span
                      className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: "hsl(var(--gold))" }}
                      aria-hidden
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
                onClick={(e) => e.stopPropagation()}
                className="z-[200] w-auto p-2 font-sans text-xs text-white/90 rounded-full border border-white/10 bg-black/50 backdrop-blur-md shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 duration-150"
              >
                <div className="flex flex-col gap-1">
                  {[
                    {
                      label: "Hide my inputs",
                      active: hideMine,
                      toggle: () => {
                        const next = !hideMine;
                        setShowMyPins(!next);
                        setShowMyDrawings(!next);
                      },
                    },
                    {
                      label: "Hide others' inputs",
                      active: hideOthers,
                      toggle: () => {
                        const next = !hideOthers;
                        setShowOthersPins(!next);
                        setShowOthersDrawings(!next);
                      },
                    },
                  ].map((row) => (
                    <button
                      key={row.label}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        row.toggle();
                      }}
                      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      {row.active ? <EyeOff size={16} /> : <Eye size={16} />}
                      <span className="whitespace-nowrap">{row.label}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          );
        })()}

        {/* ───────────── Exports & Close ───────────── */}
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />

        {/* Download with comments — image + numbered pins + side legend
            of every pin's chat thread. Always available so users can capture
            the conversation as it stands. */}
        {pins.filter((p) => !p.resolved_at).length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await downloadWithComments({
                      src,
                      pins: pins.filter((p) => !p.resolved_at),
                      strokes,
                      penColor: PEN_COLOR,
                      filename: buildMarkupFilename(
                        projectName,
                        sceneName,
                        roundNumber,
                        "Comments"
                      ),
                    });
                  } catch (err) {
                    console.error("Download with comments failed:", err);
                    toast({
                      title: "Download failed",
                      description: "Could not export the commented image.",
                      variant: "destructive",
                    });
                  }
                }}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Download with comments"
              >
                <MessageSquare size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              Download image with numbered pins &amp; comment legend
            </TooltipContent>
          </Tooltip>
        )}

        {/* Download with drawings — moved to the right, just left of close. */}
        {strokes.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = imgRef.current?.getBoundingClientRect();
                  const natural = imgRef.current?.naturalWidth ?? 0;
                  const displayed = rect?.width ?? 0;
                  const ratio = displayed > 0 ? natural / displayed : 1;
                  downloadWithDrawings(
                    src,
                    strokes,
                    PEN_COLOR,
                    {
                      cssStrokeWidth: 3,
                      cssGlowBlur: 2,
                      pxPerCss: ratio,
                    },
                    buildMarkupFilename(
                      projectName,
                      sceneName,
                      roundNumber,
                      "Markup"
                    )
                  ).catch((err) => {
                    console.error("Download with drawings failed:", err);
                    toast({
                      title: "Download failed",
                      description: "Could not export the annotated image.",
                      variant: "destructive",
                    });
                  });
                }}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Download with drawings"
              >
                <ImageDown size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              Download image with your drawings burned in
            </TooltipContent>
          </Tooltip>
        )}

        {/* Save (ephemeral mode) — flatten image + strokes into a PNG and
            hand it back to the parent. Replaces the Close-only flow used by
            the round viewer. */}
        {ephemeral && onSaveAnnotation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const dataUrl = await flattenAnnotation(src, strokes, PEN_COLOR);
                    onSaveAnnotation(dataUrl);
                    onClose();
                  } catch (err) {
                    console.error("Annotation save failed:", err);
                    toast({
                      title: "Couldn't save annotation",
                      description: "Try again.",
                      variant: "destructive",
                    });
                  }
                }}
                className="rounded-full border border-gold bg-transparent p-2 text-gold hover:bg-[#1C1A17] transition-colors"
                aria-label={saveLabel}
              >
                <Check size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              collisionPadding={12}
              avoidCollisions
              className="font-sans text-xs"
            >
              {saveLabel}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Close */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="end"
            collisionPadding={12}
            avoidCollisions
            className="font-sans text-xs"
          >
            <span className="flex items-center gap-2">
              Close
              <Kbd>Esc</Kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
      </TooltipProvider>

      {/* Zoom indicator — top-left, vertically aligned with top-right toolbar */}
      <div
        className={cn(
          "pointer-events-none absolute top-5 left-5 z-30 flex h-9 items-center px-2 text-[11px] font-medium text-white transition-opacity font-sans tracking-wide",
          scale > MIN_SCALE ? "opacity-60" : "opacity-25"
        )}
      >
        {scale.toFixed(1)}× · scroll to zoom · drag to pan · click image to pin
      </div>

      {/* Next-round CTA — vertically centered on the right edge */}
      {/* Only the last delivered round on a scene exposes the action bar.
          Older rounds are locked (a successor exists) and must show no
          action affordances at all. */}
      {onRequestNextRound && !isLocked && (
        <NextRoundCTA
          sceneRoundId={sceneRoundId}
          roundNumber={roundNumber}
          onRequestNextRound={() => {
            // Close the lightbox first so the parent's confirm modal
            // (NewRoundModal) renders above the page rather than being
            // hidden underneath the z-[100] full-screen overlay.
            // Defer the parent action to the next tick so Radix has
            // time to release focus traps from both the AlertDialog and
            // the Lightbox portal before the new modal mounts.
            onClose();
            setTimeout(() => onRequestNextRound(), 0);
          }}
          nextRoundNumber={nextRoundNumber}
        />
      )}

      {/* Centered, transformed image */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative will-change-transform"
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 80ms ease-out",
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            onClick={handleImageClick}
            onPointerEnter={() => setIsOverImage(true)}
            onPointerLeave={() => setIsOverImage(false)}
            onPointerDown={(e) => {
              if (isLocked) return;
              if (!drawMode) return;
              e.stopPropagation();
              e.preventDefault();
              const img = imgRef.current;
              if (!img) return;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              const rect = img.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width;
              const y = (e.clientY - rect.top) / rect.height;
              isDrawing.current = true;
              const tempId = `pending-${Date.now()}-${Math.random()}`;
              currentStrokeIdRef.current = tempId;
              setStrokes((prev) => [
                ...prev,
                { id: tempId, points: [{ x, y }], created_by: userId, pending: true },
              ]);
              // A fresh stroke invalidates any pending redo history.
              setRedoStack([]);
            }}
            onPointerMove={(e) => {
              if (!drawMode || !isDrawing.current) return;
              e.stopPropagation();
              const img = imgRef.current;
              if (!img) return;
              const rect = img.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width;
              const y = (e.clientY - rect.top) / rect.height;
              setStrokes((prev) => {
                if (prev.length === 0) return prev;
                const next = prev.slice();
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, points: [...last.points, { x, y }] };
                return next;
              });
            }}
            onPointerUp={async (e) => {
              if (!drawMode) return;
              e.stopPropagation();
              isDrawing.current = false;
              await persistCurrentStroke();
            }}
            onPointerCancel={async () => {
              if (isDrawing.current) {
                isDrawing.current = false;
                await persistCurrentStroke();
              }
            }}
            className="block max-h-[96vh] max-w-[96vw] object-contain"
          />

          {/* Drawing overlay — fluo green strokes anchored to the image */}
          {strokes.length > 0 && (
            <svg
              className={cn(
                "absolute inset-0 h-full w-full",
                eraseMode ? "pointer-events-auto" : "pointer-events-none"
              )}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={eraseMode ? { cursor: "crosshair" } : undefined}
              onPointerDown={(e) => {
                if (!eraseMode) return;
                // Prevent the lightbox container from starting a pan while
                // the user sweeps the eraser.
                e.stopPropagation();
                isErasing.current = true;
                erasedDuringDragRef.current = new Set();
                eraseDragMovedRef.current = false;
                eraseDownPosRef.current = { x: e.clientX, y: e.clientY };
                // Capture the pointer so we keep getting move/up events even
                // if the cursor leaves the SVG bounds during the drag.
                try {
                  (e.currentTarget as SVGSVGElement).setPointerCapture(
                    e.pointerId
                  );
                } catch {
                  /* ignore — capture is best-effort */
                }
                const tol = tolerancePxFor(e);
                const hit = findStrokeAt(
                  e.currentTarget,
                  e.clientX,
                  e.clientY,
                  tol
                );
                eraseDownHitRef.current = hit;
                // When confirmation is required, defer erasing until we know
                // whether this is a click (→ confirm) or a drag (→ sweep).
                if (confirmErase) return;
                if (hit && !erasedDuringDragRef.current.has(hit)) {
                  erasedDuringDragRef.current.add(hit);
                  eraseStroke(hit);
                }
              }}
              onPointerMove={(e) => {
                if (!eraseMode) return;
                e.stopPropagation();
                // Promote to a drag once the pointer has moved past a small
                // threshold. ~4 CSS px keeps tiny shakes from suppressing the
                // confirm dialog while still feeling instant for real drags.
                if (
                  isErasing.current &&
                  !eraseDragMovedRef.current &&
                  eraseDownPosRef.current
                ) {
                  const dx = e.clientX - eraseDownPosRef.current.x;
                  const dy = e.clientY - eraseDownPosRef.current.y;
                  if (dx * dx + dy * dy > 16) {
                    eraseDragMovedRef.current = true;
                    // If confirmation was deferred at pointer-down, erase the
                    // initial hit now that we know it's a sweep.
                    if (
                      confirmErase &&
                      eraseDownHitRef.current &&
                      !erasedDuringDragRef.current.has(eraseDownHitRef.current)
                    ) {
                      erasedDuringDragRef.current.add(eraseDownHitRef.current);
                      eraseStroke(eraseDownHitRef.current);
                    }
                  }
                }
                // Whether this move should also delete strokes (vs. just
                // refresh the hover highlight). Mirrors the previous logic:
                // requires an active drag, and — when confirm-on-erase is on
                // — requires that the drag has been promoted past the click
                // threshold.
                const isDragging =
                  isErasing.current &&
                  (!confirmErase || eraseDragMovedRef.current);
                // Coalesce the pointer sample. The rAF callback will run at
                // most once per frame even under 240Hz pointer streams.
                erasePendingSampleRef.current = {
                  svg: e.currentTarget,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  tolerancePx: tolerancePxFor(e),
                  pointerType: e.pointerType,
                  isDragging,
                };
                if (erasePendingFrameRef.current === null) {
                  erasePendingFrameRef.current = requestAnimationFrame(
                    flushErasePointerSample
                  );
                }
              }}
              onPointerLeave={() => {
                if (hoveredEraseId !== null) setHoveredEraseId(null);
              }}
              onPointerUp={(e) => {
                if (!eraseMode) return;
                const wasClick = !eraseDragMovedRef.current;
                const downHit = eraseDownHitRef.current;
                isErasing.current = false;
                erasedDuringDragRef.current = new Set();
                eraseDownHitRef.current = null;
                eraseDownPosRef.current = null;
                eraseDragMovedRef.current = false;
                // Drop any queued hit-test — the gesture is over.
                if (erasePendingFrameRef.current !== null) {
                  cancelAnimationFrame(erasePendingFrameRef.current);
                  erasePendingFrameRef.current = null;
                }
                erasePendingSampleRef.current = null;
                try {
                  (e.currentTarget as SVGSVGElement).releasePointerCapture(
                    e.pointerId
                  );
                } catch {
                  /* ignore */
                }
                // Single click + confirmation requested → open dialog.
                if (wasClick && confirmErase && downHit) {
                  setPendingEraseId(downHit);
                }
              }}
              onPointerCancel={() => {
                isErasing.current = false;
                erasedDuringDragRef.current = new Set();
                eraseDownHitRef.current = null;
                eraseDownPosRef.current = null;
                eraseDragMovedRef.current = false;
                if (erasePendingFrameRef.current !== null) {
                  cancelAnimationFrame(erasePendingFrameRef.current);
                  erasePendingFrameRef.current = null;
                }
                erasePendingSampleRef.current = null;
              }}
            >
              {/* Transparent capture surface so the SVG receives clicks
                  anywhere over the image while erasing. Without this, only
                  hits on a stroke pixel would fire onClick. */}
              {eraseMode && (
                <rect
                  x={0}
                  y={0}
                  width={1}
                  height={1}
                  fill="rgba(0,0,0,0)"
                  style={{ pointerEvents: "all" }}
                />
              )}
              {strokes
                // Audience-aware visibility: each toggle hides only its own
                // bucket (mine vs. someone else's), so the user can declutter
                // exactly what they want.
                .filter((s) => {
                  const isMine = s.created_by === userId;
                  if (isMine) return showMyDrawings;
                  return showOthersDrawings;
                })
                .map((s, i) =>
                s.points.length === 0 ? null : (
                  <g key={s.id ?? i}>
                    {/* Hover preview — a brighter white halo behind the
                        stroke that's currently under the eraser cursor.
                        Renders only in erase mode for strokes the user is
                        allowed to remove (RLS still has the final say). */}
                    {eraseMode &&
                      hoveredEraseId === s.id &&
                      (s.created_by === userId || isAdmin) && (
                        <polyline
                          points={s.points
                            .map((p) => `${p.x},${p.y}`)
                            .join(" ")}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                          style={{
                            filter: `drop-shadow(0 0 4px ${PEN_COLOR})`,
                            pointerEvents: "none",
                            opacity: 0.9,
                          }}
                        />
                      )}
                    {/* Visible stroke. */}
                    <polyline
                      points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke={PEN_COLOR}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      style={{
                        filter: `drop-shadow(0 0 2px ${PEN_COLOR})`,
                        pointerEvents: "none",
                      }}
                    />
                  </g>
                )
              )}
            </svg>
          )}

          {/* Pin overlay — pointy gold markers anchored to the image */}
          {pins
            .filter((p) => !p.resolved_at)
            // Audience-aware visibility, mirroring drawings.
            .filter((p) => {
              const isMine = p.created_by === userId;
              if (isMine) return showMyPins;
              return showOthersPins;
            })
            .map((p, idx) => {
              const isOpen = openPinId === p.id;
              const canDeletePin =
                isAdmin ||
                (!!userId && p.created_by === userId && !p.resolved_at);
              return (
                <div
                  key={p.id}
                  className={cn("absolute", isOpen ? "z-40" : "z-10")}
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    // Anchor the SW-pointing tail tip at the click location.
                    // The marker SVG is designed so its tail point sits at the
                    // bottom-left corner of the SVG.
                    transform: `translate(0, -100%) scale(${1 / scale})`,
                    transformOrigin: "bottom left",
                  }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenPinId(isOpen ? null : p.id);
                    }}
                    className="block focus:outline-none"
                    aria-label={`Pin ${idx + 1}`}
                  >
                    <PinMarker
                      number={idx + 1}
                      active={isOpen}
                      initial={pinInitials[p.created_by] ?? ""}
                      mine={!!userId && p.created_by === userId}
                      canDelete={canDeletePin}
                      onRequestDelete={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (skipDeleteConfirm) {
                          // User opted out of confirmations this session —
                          // delete immediately. The Undo toast is still
                          // shown by deletePinById as a safety net.
                          await deletePinById(p.id);
                          return;
                        }
                        setPendingDeletePinId(p.id);
                      }}
                    />
                  </button>
                  {/* Per-pin chat popover — anchored to the marker, sized to
                      its content. Inherits the counter-scale from the parent
                      so it stays visually constant regardless of zoom. */}
                  {isOpen && (
                    <div
                      className="absolute left-full top-0 ml-2 z-30"
                      style={{ pointerEvents: "auto" }}
                    >
                      <PinChat
                        pinId={p.id}
                        pinNumber={idx + 1}
                        currentUserId={userId}
                        onClose={() => setOpenPinId(null)}
                        canDelete={canDeletePin}
                        onDelete={async () => {
                          await deletePinById(p.id);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Custom blended crosshair cursor — shown whenever annotating, at any
          zoom level. Position is in viewport pixels so its on-screen size
          stays constant regardless of image zoom. mix-blend-mode: difference
          inverts the backdrop so it reads black on light areas and white on
          dark areas. No shadow. */}
      {annotateMode && cursorPos && isOverImage && !openPinId && (
        <BlendedCrosshair x={cursorPos.x} y={cursorPos.y} />
      )}
      {/* Confirm dialog for single-click erases when the safety toggle is
          on. Drag-sweep erases skip this — the gesture is its own intent. */}
      <AlertDialog
        open={pendingEraseId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingEraseId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this stroke?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected drawing will be removed. You can still bring it
              back with Undo. Drag the eraser to remove multiple strokes
              without confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = pendingEraseId;
                setPendingEraseId(null);
                if (id) eraseStroke(id);
              }}
            >
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Inline pin delete confirmation — triggered from the × badge on
          each pin marker. The chat panel has its own confirm flow. */}
      <AlertDialog
        open={pendingDeletePinId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletePinId(null);
            // Reset checkbox so it doesn't carry over to the next prompt.
            setDontAskAgainChecked(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pin?</AlertDialogTitle>
            <AlertDialogDescription>
              The pin and its conversation will be removed. You'll have a
              brief moment to undo right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <Checkbox
              checked={dontAskAgainChecked}
              onCheckedChange={(v) => setDontAskAgainChecked(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-muted-foreground leading-snug">
              Don't ask again for this session
              <span className="block text-xs opacity-70">
                You can still undo each deletion from the toast.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const id = pendingDeletePinId;
                if (dontAskAgainChecked) setSkipDeleteConfirm(true);
                setPendingDeletePinId(null);
                setDontAskAgainChecked(false);
                if (id) await deletePinById(id);
              }}
              className="bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500"
            >
              Delete pin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>,
    document.body
  );
}

/**
 * The pin marker: a teardrop / raindrop shape with a round bulb in the
 * upper-right and a pointed tail anchored at the lower-left of the SVG
 * box. The parent button anchors that exact corner to the click location
 * (transformOrigin: "bottom left" + translate(0, -100%)), so the tail tip
 * lands precisely on the pinned point.
 *
 * Geometry is hand-drawn in a square viewBox so it scales crisply at any
 * size. The bulb radius and shoulder curves are tuned to match the
 * reference vector while keeping the apex at (0, H).
 */
function PinMarker({
  number,
  active,
  initial,
  mine,
  canDelete,
  onRequestDelete,
}: {
  number: number;
  active: boolean;
  initial: string;
  mine?: boolean;
  canDelete?: boolean;
  onRequestDelete?: (e: React.MouseEvent) => void;
}) {
  // Square SVG box. The tail apex sits at (0, SIZE) so it lines up with
  // the parent's "bottom left" transform origin — same anchoring contract
  // as the previous triangle marker.
  // Marker box halved (was 44) for a more discreet pin. The initial's absolute
  // pixel size is left untouched below — fontSize is in SVG user units which
  // equal CSS pixels here since width/height match the viewBox.
  const SIZE = 22;
  const APEX_X = 0;
  const APEX_Y = SIZE;

  // Bulb geometry: a circle in the upper-right of the box.
  // R is sized so the bulb fills the upper portion while leaving room for
  // a smooth concave shoulder that flows down to the apex.
  const R = SIZE * 0.42;                     // bulb radius
  const CX = SIZE - R;                       // bulb centre x (right-aligned)
  const CY = R;                              // bulb centre y (top-aligned)

  // Shoulder tangent points on the bulb. The teardrop outline leaves the
  // circle at ~135° (upper-left) and ~315° (lower-right) measured from the
  // centre, then curves into the apex with a gentle inward bow.
  const t1x = CX - R * Math.SQRT1_2;         // upper-left tangent
  const t1y = CY - R * Math.SQRT1_2;
  const t2x = CX + R * Math.SQRT1_2;         // lower-right tangent
  const t2y = CY + R * Math.SQRT1_2;

  // Control points pull the curves toward the apex direction so the silhouette
  // mirrors the reference: a soft concave on the upper-left side and a fuller
  // sweep on the lower-right side.
  const c1x = APEX_X;
  const c1y = t1y + (APEX_Y - t1y) * 0.15;
  const c2x = t2x;
  const c2y = APEX_Y - (APEX_Y - t2y) * 0.15;

  // Sweep large enough to draw 3/4 of the circle from t1 → t2 (the
  // upper-right outer arc of the bulb).
  const arc = `A ${R} ${R} 0 1 1 ${t2x} ${t2y}`;
  const teardropPath = [
    `M ${APEX_X} ${APEX_Y}`,
    `Q ${c1x} ${c1y} ${t1x} ${t1y}`,
    arc,
    `Q ${c2x} ${c2y} ${APEX_X} ${APEX_Y}`,
    "Z",
  ].join(" ");

  // Initial sits in the bulb centre.
  const labelX = CX;
  const labelY = CY;

  // Delete-badge anchor: the upper-right "shoulder" point on the bulb circle
  // (45° above the centre). We place the badge outside that point with two
  // independent SIZE-relative offsets so horizontal and vertical spacing can
  // be tuned separately and stay consistent at any pin size.
  const BADGE_NUDGE_X = SIZE * 0.10; // push further right (away from bulb centre)
  const BADGE_NUDGE_Y = SIZE * 0.06; // lift slightly upward
  const badgeCxSvg = CX + R * Math.SQRT1_2 + BADGE_NUDGE_X;
  const badgeCySvg = CY - R * Math.SQRT1_2 - BADGE_NUDGE_Y;
  // Convert SVG-coord centre into a percentage of the rendered SVG box so it
  // tracks correctly even if the SVG is later scaled.
  const badgeLeftPct = (badgeCxSvg / SIZE) * 100;
  const badgeTopPct = (badgeCySvg / SIZE) * 100;

  // Color scheme:
  // - active (open): deep red regardless of ownership
  // - mine (current user): white bulb with black initial
  // - others: gold bulb with white initial
  const fillColor = active
    ? "#7a1f2b"
    : mine
    ? "#ffffff"
    : "hsl(var(--gold))";
  const textColor = active ? "#ffffff" : mine ? "#000000" : "#ffffff";

  return (
    <div className="relative cursor-pointer group">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
        className={cn(
          "transition-transform duration-200 ease-out",
          active ? "scale-110" : "group-hover:scale-[1.18]"
        )}
      >
        {/* Teardrop / raindrop pin: round bulb in the upper-right with a
            pointed tail at (0, SIZE). The bulb is a 3/4 circular arc; the
            two flanks sweep from the bulb tangents down to the apex. */}
        <path
          d={teardropPath}
          fill={fillColor}
          strokeLinejoin="round"
        />
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={700}
          fontSize={(initial || "?").length > 1 ? 11 : 14}
          fill={textColor}
        >
          {(initial || "?").toUpperCase()}
        </text>
      </svg>
      {canDelete && onRequestDelete && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={onRequestDelete}
          aria-label={`Delete pin ${number}`}
          title="Delete pin"
          style={{
            // Position the badge centre at the computed point, then offset
            // each half of its own size via -translate-x-1/2 / -translate-y-1/2.
            left: `${badgeLeftPct}%`,
            top: `${badgeTopPct}%`,
          }}
          className={cn(
            // Larger tap target on mobile (28px = comfortably above the 24px
            // a11y minimum once you account for the visual badge itself);
            // back to a tighter 20px on hover-capable pointers (desktop).
            "absolute flex items-center justify-center touch-manipulation",
            "-translate-x-1/2 -translate-y-1/2",
            "h-7 w-7 md:h-5 md:w-5",
            "rounded-full border border-gold bg-[#1C1A17] text-gold shadow-md ring-2 ring-background",
            "transition-all duration-150 ease-out",
            // On touch (no hover) keep the badge visible so it's always
            // tappable; on hover-capable devices reveal it on hover/focus.
            "opacity-100 scale-100",
            "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:scale-75",
            "[@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:scale-100",
            "focus:opacity-100 focus:scale-100 focus:outline-none"
          )}
        >
          <X className="h-4 w-4 md:h-3 md:w-3" strokeWidth={3} />
        </button>
      )}
      <span className="sr-only">Pin {number}</span>
    </div>
  );
}

/**
 * Custom crosshair cursor used in annotate mode.
 *
 * Four short segments around a tiny center dot, drawn with mix-blend-mode:
 * difference so the marks invert against the underlying image — black on
 * light areas, white on dark areas. No shadow, no fill, just clean strokes.
 */
function BlendedCrosshair({ x, y }: { x: number; y: number }) {
  const SIZE = 56; // viewport px
  const HALF = SIZE / 2;
  const GAP = 8;   // empty space around the center dot
  const ARM = 16;  // length of each segment
  const STROKE = 2;
  const DOT = 1.6;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[110]"
      style={{
        left: x - HALF,
        top: y - HALF,
        width: SIZE,
        height: SIZE,
        // Difference blend on white shows: black on light backgrounds,
        // white on dark backgrounds.
        mixBlendMode: "difference",
      }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
      >
        {/* Top */}
        <line
          x1={HALF}
          y1={HALF - GAP}
          x2={HALF}
          y2={HALF - GAP - ARM}
          stroke="#ffffff"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Bottom */}
        <line
          x1={HALF}
          y1={HALF + GAP}
          x2={HALF}
          y2={HALF + GAP + ARM}
          stroke="#ffffff"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Left */}
        <line
          x1={HALF - GAP}
          y1={HALF}
          x2={HALF - GAP - ARM}
          y2={HALF}
          stroke="#ffffff"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Right */}
        <line
          x1={HALF + GAP}
          y1={HALF}
          x2={HALF + GAP + ARM}
          y2={HALF}
          stroke="#ffffff"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={HALF} cy={HALF} r={DOT} fill="#ffffff" />
      </svg>
    </div>
  );
}

/**
 * Resolve the scene_round_id for an asset. We could pass it as a prop, but
 * looking it up keeps the Lightbox API minimal and avoids prop-drilling
 * through the AssetViewer state.
 */
async function resolveSceneRoundId(assetId: string): Promise<string> {
  const { data, error } = await supabase
    .from("round_assets")
    .select("scene_round_id")
    .eq("id", assetId)
    .single();
  if (error || !data) throw error ?? new Error("Asset not found");
  return data.scene_round_id as string;
}

/**
 * Render the current image and the user's normalized polyline strokes onto a
 * canvas, then trigger a PNG download. Strokes are stored in [0..1] image
 * coordinates so we can scale them up to the image's intrinsic resolution
 * without losing precision.
 *
 * Notes:
 *   - We set crossOrigin="anonymous" so the canvas stays untainted when the
 *     thumbnail is served from Supabase Storage / Dropbox temporary links
 *     (both send permissive CORS headers).
 *   - Stroke width and glow scale with the image's smaller dimension so the
 *     export visually matches what's on screen, regardless of resolution.
 */
async function downloadWithDrawings(
  src: string,
  strokes: { points: { x: number; y: number }[] }[],
  penColor: string,
  /**
   * Pixel-matching options. When provided, the canvas stroke width and glow
   * are computed from the on-screen CSS values × the natural/displayed pixel
   * ratio, so the exported PNG matches the screen exactly at the current
   * zoom level. When omitted we fall back to a resolution-relative default.
   */
  options?: {
    cssStrokeWidth: number;
    cssGlowBlur: number;
    pxPerCss: number;
  },
  /** Optional explicit filename (without extension is fine — `.png` will be added). */
  filename?: string
): Promise<void> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // 1) Base image.
  ctx.drawImage(img, 0, 0, w, h);

  // 2) Strokes — match the on-screen vector style (3px non-scaling stroke +
  //    a soft fluo glow). When the caller passes `options`, we honour the
  //    exact pixel thickness shown on screen at the current zoom; otherwise
  //    we fall back to a resolution-relative default.
  const baseStroke = options
    ? Math.max(1, options.cssStrokeWidth * options.pxPerCss)
    : Math.max(2, Math.round(Math.min(w, h) * 0.003));
  const glowBlur = options
    ? Math.max(0, options.cssGlowBlur * options.pxPerCss)
    : baseStroke * 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = penColor;
  ctx.shadowColor = penColor;
  ctx.shadowBlur = glowBlur;
  ctx.lineWidth = baseStroke;

  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = p.x * w;
      const py = p.y * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    // For a single-point "tap", draw a small dot so it's still visible.
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.arc(p.x * w, p.y * h, baseStroke / 2, 0, Math.PI * 2);
      ctx.fillStyle = penColor;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }

  // 3) Trigger download.
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png"
    )
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ensurePngExt(filename ?? `annotated-${Date.now()}`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Flatten the base image and any green strokes into a single PNG data URL.
 * Used by the ephemeral / no-persist Lightbox flow (e.g. the new-task
 * popup) to hand the parent a finished annotation snapshot.
 */
async function flattenAnnotation(
  src: string,
  strokes: { points: { x: number; y: number }[] }[],
  penColor: string
): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  const baseStroke = Math.max(2, Math.round(Math.min(w, h) * 0.003));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = penColor;
  ctx.shadowColor = penColor;
  ctx.shadowBlur = baseStroke * 1.5;
  ctx.lineWidth = baseStroke;
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = p.x * w;
      const py = p.y * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.arc(p.x * w, p.y * h, baseStroke / 2, 0, Math.PI * 2);
      ctx.fillStyle = penColor;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function ensurePngExt(name: string): string {
  return name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
}

/**
 * Build the human-friendly file name used when exporting a marked-up
 * lightbox image. Format:
 *
 *   `<Project> - <Scene> - <Kind> Round XX - YYYY-MM-DD at HH.mm.ss`
 *
 * `Kind` is e.g. "Markup" (drawings) or "Comments" (pin chat). The date
 * and time are computed at download time so the filename always matches
 * when the export was triggered.
 */
function buildMarkupFilename(
  projectName: string | undefined,
  sceneName: string,
  roundNumber: number,
  kind: "Markup" | "Comments"
): string {
  const project = (projectName ?? "Project").trim();
  const scene = (sceneName ?? "Scene").trim();
  const round = `Round ${String(roundNumber).padStart(2, "0")}`;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(
    d.getHours()
  )}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  // Strip any filesystem-hostile characters; keep spaces, hyphens, dots.
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ");
  return `${safe(project)} - ${safe(scene)} - ${kind} ${round} - ${stamp}`;
}

/**
 * Export the asset image with every (unresolved) pin drawn as a numbered
 * gold disc, plus a vertical "legend" panel on the right that lists the
 * conversation thread under each pin. Strokes are honoured so users can
 * capture the full annotated state in one PNG.
 */
async function downloadWithComments(args: {
  src: string;
  pins: {
    id: string;
    x: number;
    y: number;
    created_by: string;
    resolved_at: string | null;
  }[];
  strokes: { points: { x: number; y: number }[] }[];
  penColor: string;
  filename: string;
}): Promise<void> {
  const { src, pins, strokes, penColor, filename } = args;
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  // Pull the chat threads for each pin in parallel. Failures fall back to
  // an empty list so the export still succeeds even if a single thread
  // can't be loaded.
  const threads = await Promise.all(
    pins.map(async (p) => {
      const { data } = await supabase
        .from("asset_pin_messages")
        .select("body, created_at, user_id")
        .eq("pin_id", p.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as { body: string | null; created_at: string; user_id: string }[];
    })
  );

  // Resolve author names for every distinct user_id across all threads
  // (fallbacks: full_name, then "Anonymous").
  const userIds = Array.from(
    new Set(threads.flat().map((m) => m.user_id).filter(Boolean))
  );
  const nameById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name, full_name")
      .in("user_id", userIds);
    for (const row of (data ?? []) as any[]) {
      const first = row.first_name ? String(row.first_name).trim() : "";
      const last = row.last_name ? String(row.last_name).trim() : "";
      const composed = `${first} ${last}`.trim();
      nameById[row.user_id] =
        composed || (row.full_name ? String(row.full_name).trim() : "Anonymous");
    }
  }

  // Layout — image on the left, fixed-width legend on the right.
  const LEGEND_W = Math.round(Math.max(420, w * 0.32));
  const PADDING = Math.round(Math.min(w, h) * 0.025);
  const totalW = w + LEGEND_W;
  const totalH = h;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // 1) Background — soft black so the legend reads on any image.
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, totalW, totalH);

  // 2) Base image (left).
  ctx.drawImage(img, 0, 0, w, h);

  // 3) Strokes (re-using the same fluo-green look as the on-screen overlay).
  const baseStroke = Math.max(2, Math.round(Math.min(w, h) * 0.003));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = penColor;
  ctx.shadowColor = penColor;
  ctx.shadowBlur = baseStroke * 1.5;
  ctx.lineWidth = baseStroke;
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = p.x * w;
      const py = p.y * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.arc(p.x * w, p.y * h, baseStroke / 2, 0, Math.PI * 2);
      ctx.fillStyle = penColor;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
  ctx.restore();

  // 4) Numbered pins on the image. Order follows the input array so the
  //    legend numbering matches the visual badges.
  const pinRadius = Math.max(16, Math.round(Math.min(w, h) * 0.022));
  const pinFont = `700 ${Math.round(pinRadius * 1.1)}px Inter, system-ui, sans-serif`;
  pins.forEach((p, i) => {
    const cx = p.x * w;
    const cy = p.y * h;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = pinRadius * 0.6;
    ctx.fillStyle = "hsl(40, 35%, 60%)"; // approximate gold
    ctx.beginPath();
    ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = Math.max(1, pinRadius * 0.08);
    ctx.stroke();
    ctx.fillStyle = "#1a1308";
    ctx.font = pinFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx, cy + 1);
    ctx.restore();
  });

  // 5) Legend panel on the right.
  const legendX = w;
  ctx.save();
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(legendX, 0, LEGEND_W, totalH);

  // Logo at the top of the panel.
  let headerOffset = PADDING;
  try {
    const { SILVERSHADOW_LOGO_DATA_URL } = await import("@/lib/brandLogo");
    const logo = await loadImage(SILVERSHADOW_LOGO_DATA_URL);
    const logoW = Math.min(LEGEND_W - PADDING * 2, Math.round(LEGEND_W * 0.55));
    const logoH = Math.round((logo.naturalHeight / logo.naturalWidth) * logoW);
    const logoX = legendX + (LEGEND_W - logoW) / 2;
    ctx.drawImage(logo, logoX, PADDING, logoW, logoH);
    headerOffset = PADDING + logoH + PADDING;
  } catch {
    // If the logo fails to load, fall back to plain header position.
  }

  // Header.
  ctx.fillStyle = "#e8e0d4";
  ctx.font = `600 ${Math.round(PADDING * 0.7)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Comments", legendX + PADDING, headerOffset);

  // Body. We word-wrap each message body to the panel width.
  const bodyFont = `400 ${Math.round(PADDING * 0.55)}px Inter, system-ui, sans-serif`;
  const metaFont = `500 ${Math.round(PADDING * 0.45)}px Inter, system-ui, sans-serif`;
  const numFont = `700 ${Math.round(PADDING * 0.6)}px Inter, system-ui, sans-serif`;
  const lineHeight = Math.round(PADDING * 0.85);
  const innerW = LEGEND_W - PADDING * 2;
  let cursorY = headerOffset + PADDING * 1.2;

  const wrap = (text: string, font: string, maxWidth: number): string[] => {
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const trial = current ? `${current} ${word}` : word;
      if (ctx.measureText(trial).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = trial;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  pins.forEach((p, idx) => {
    if (cursorY > totalH - PADDING) return; // out of room
    // Number badge.
    ctx.save();
    ctx.fillStyle = "hsl(40, 35%, 60%)";
    ctx.beginPath();
    ctx.arc(legendX + PADDING + PADDING * 0.35, cursorY + PADDING * 0.35, PADDING * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1308";
    ctx.font = numFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(idx + 1), legendX + PADDING + PADDING * 0.35, cursorY + PADDING * 0.4);
    ctx.restore();

    const textX = legendX + PADDING + PADDING * 1.1;
    const textW = innerW - PADDING * 1.1;

    const messages = threads[idx] ?? [];
    if (messages.length === 0) {
      ctx.fillStyle = "rgba(232,224,212,0.45)";
      ctx.font = bodyFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("(no messages)", textX, cursorY + PADDING * 0.05);
      cursorY += lineHeight + PADDING * 0.5;
      return;
    }

    let firstInPin = true;
    for (const m of messages) {
      if (cursorY > totalH - PADDING) break;
      const author = nameById[m.user_id] ?? "Anonymous";
      const date = new Date(m.created_at);
      const meta = `${author} · ${date.toLocaleDateString()} ${date
        .getHours()
        .toString()
        .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;

      ctx.fillStyle = "rgba(232,224,212,0.65)";
      ctx.font = metaFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(meta, textX, cursorY + (firstInPin ? PADDING * 0.05 : 0));
      cursorY += Math.round(lineHeight * 0.65);

      const bodyLines = wrap(m.body ?? "(attachment)", bodyFont, textW);
      ctx.fillStyle = "#e8e0d4";
      ctx.font = bodyFont;
      for (const line of bodyLines) {
        if (cursorY > totalH - PADDING) break;
        ctx.fillText(line, textX, cursorY);
        cursorY += lineHeight;
      }
      cursorY += Math.round(lineHeight * 0.3);
      firstInPin = false;
    }
    cursorY += Math.round(lineHeight * 0.6);
  });

  ctx.restore();

  // 6) Trigger download.
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png"
    )
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ensurePngExt(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Bottom-right CTA shown over the lightbox once a round has been delivered.
 * Two stacked elements:
 *   1. Tiny status line:  "Delivery on <Mon DD MMM> at 11:00AM. Order within Xd Xh Xm Xs."
 *      - Order deadline = the sibling review round's `end_date` (Friday 14:00).
 *      - Delivery date  = the next Monday at 11:00 after that deadline.
 *   2. Gold "Request Round NN" button (NN = current round + 1).
 *
 * The countdown ticks every second. If no review window can be found yet
 * (e.g. the round hasn't been delivered, or data is still loading) the CTA
 * is hidden gracefully.
 */
function NextRoundCTA({
  sceneRoundId,
  roundNumber,
  onRequestNextRound,
  nextRoundNumber,
}: {
  sceneRoundId: string;
  roundNumber: number;
  onRequestNextRound?: () => void;
  nextRoundNumber?: number;
}) {
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Resolve the order-by deadline. Preferred source is the sibling
  // `kind='review'` row (created by `deliverRoundAndStartReview`). For older
  // rounds delivered before that mechanism existed — or any round missing
  // its review sibling — we fall back to computing the window directly from
  // the production round's `delivered_at`, so the CTA is never silently
  // hidden when a delivered asset is on screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: prod } = await supabase
        .from("scene_rounds")
        .select("scene_id, round_number, delivered_at")
        .eq("id", sceneRoundId)
        .maybeSingle();
      if (cancelled || !prod) return;
      const { data: review } = await supabase
        .from("scene_rounds")
        .select("end_date")
        .eq("scene_id", prod.scene_id)
        .eq("round_number", prod.round_number)
        .eq("kind", "review")
        .maybeSingle();
      if (cancelled) return;
      if (review?.end_date) {
        setDeadline(new Date(review.end_date));
      } else if (prod.delivered_at) {
        const { end } = computeReviewWindow(new Date(prod.delivered_at));
        setDeadline(end);
      } else {
        // No delivery timestamp yet — assume "just now" so the countdown is
        // still accurate enough for clients viewing a freshly delivered round
        // whose review sibling hasn't been backfilled.
        const { end } = computeReviewWindow(new Date());
        setDeadline(end);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sceneRoundId]);

  // Tick once a second for the countdown.
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;

  // Delivery date = first Monday at 11:00 strictly after the deadline.
  const delivery = new Date(deadline.getTime());
  const daysUntilMonday = ((1 - delivery.getDay() + 7) % 7) || 7;
  delivery.setDate(delivery.getDate() + daysUntilMonday);
  delivery.setHours(11, 0, 0, 0);

  const remainingMs = Math.max(0, deadline.getTime() - now.getTime());
  const totalSecs = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  const countdown =
    days > 0
      ? `${days}d ${hours}h ${minutes}m ${seconds}s`
      : hours > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes}m ${seconds}s`;

  const deliveryLabel = delivery.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const nextRound = (nextRoundNumber ?? roundNumber + 1)
    .toString()
    .padStart(2, "0");
  const expired = remainingMs <= 0;
  const ctaEnabled = !!onRequestNextRound && !expired;

  return (
    <>
      <div
        className="absolute inset-x-0 bottom-6 z-30 flex justify-center px-6 pointer-events-none"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-auto relative flex items-center gap-6 border border-white/10 bg-black/60 backdrop-blur-md pl-7 pr-2 py-2 rounded-full">
          <span className="hidden sm:block h-1 w-1 rounded-full bg-gold/70" />

          {expired ? (
            <p className="text-[11px] leading-relaxed text-white/75 font-sans tracking-wide whitespace-nowrap">
              Feedback window closed. Contact us to schedule Round {nextRound}.
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-white/75 font-sans tracking-wide whitespace-nowrap">
              Next delivery on{" "}
              <span className="text-white font-medium text-[14px]">
                {deliveryLabel} at 11:00AM
              </span>
              <span className="mx-2 text-white/30">·</span>
              Feedback within{" "}
              <span className="text-gold font-semibold tabular-nums">
                {countdown}
              </span>
            </p>
          )}

          <button
            type="button"
            disabled={!ctaEnabled}
            onClick={() => setConfirmOpen(true)}
            className="group relative inline-flex items-center justify-center rounded-full bg-gradient-to-b from-gold to-[#9a7f55] px-7 py-2.5 text-[12px] font-medium uppercase tracking-[0.18em] text-[#1a1308] transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed font-sans focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black whitespace-nowrap"
          >
            <span className="relative">Request Round {nextRound}</span>
          </button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              Request Round {nextRound}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You're about to start a new production round. You'll be able to
              add instructions and supporting files in the next step.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onRequestNextRound?.();
              }}
              className="border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Small overlay badge shown on top of the round preview image.
 * Displays the original dimensions, file size and format so the client
 * can see at a glance that the asset is full-resolution.
 */
function AssetMetaBadge({
  filename,
  fileSize,
  width,
  height,
}: {
  filename: string;
  fileSize: number | null;
  width?: number;
  height?: number;
}) {
  const ext = (filename.split(".").pop() || "").toUpperCase();
  const formatSize = (bytes: number | null) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  const sizeLabel = formatSize(fileSize);
  const dimsLabel = width && height ? `${width} × ${height} px` : null;

  if (!ext && !sizeLabel && !dimsLabel) return null;

  return (
    <div className="flex justify-end font-sans text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
      <div className="flex items-center gap-3 text-right">
        {dimsLabel && <span>{dimsLabel}</span>}
        {dimsLabel && (sizeLabel || ext) && <span className="text-border">·</span>}
        {sizeLabel && <span>{sizeLabel}</span>}
        {sizeLabel && ext && <span className="text-border">·</span>}
        {ext && <span className="font-semibold text-foreground">{ext}</span>}
      </div>
    </div>
  );
}