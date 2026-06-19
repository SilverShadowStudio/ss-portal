import { useState, useEffect } from "react";
import { ImageIcon, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { SmartImage } from "@/components/ui/SmartImage";

interface SceneRound {
  id: string;
  round_number: number;
  status: string;
}

interface SceneCardProps {
  scene: {
    id: string;
    name: string;
    status: string;
    current_round: number;
    paid_rounds: number;
    projectName: string;
    clientName: string;
    assetCount: number;
    currentRoundId: string | null;
    reviewDeadline: string | null;
  };
  index: number;
  onFolderMappingClick: () => void;
  onDeleted?: () => void;
}

export function SceneCard({ scene, index, onFolderMappingClick, onDeleted }: SceneCardProps) {
  const [rounds, setRounds] = useState<SceneRound[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [deadlineProgress, setDeadlineProgress] = useState<number>(100);

  useEffect(() => {
    fetchRoundsAndThumbnail();
  }, [scene.id]);

  // Countdown timer effect
  useEffect(() => {
    if (!scene.reviewDeadline) {
      setTimeRemaining(null);
      setDeadlineProgress(100);
      return;
    }

    const calculateTimeRemaining = () => {
      const now = new Date();
      const deadline = new Date(scene.reviewDeadline!);
      const diff = deadline.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining("Overdue");
        setDeadlineProgress(0);
        return;
      }

      // Calculate progress (assume 7 days total window for the bar)
      const totalWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
      const progress = Math.max(0, Math.min(100, (diff / totalWindow) * 100));
      setDeadlineProgress(progress);

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeRemaining(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m remaining`);
      } else {
        setTimeRemaining(`${minutes}m remaining`);
      }
    };

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [scene.reviewDeadline]);

  async function fetchRoundsAndThumbnail() {
    // Fetch rounds
    const { data: roundsData } = await supabase
      .from("scene_rounds")
      .select("id, round_number, status")
      .eq("scene_id", scene.id)
      // Review rounds are a timeline-only artifact and must not influence
      // the admin scene-card status / asset preview.
      .eq("kind", "production")
      .order("round_number", { ascending: true });

    setRounds(roundsData || []);

    // Fetch thumbnail from first available asset
    if (roundsData && roundsData.length > 0) {
      for (const round of roundsData) {
        const { data: assets } = await supabase
          .from("round_assets")
          .select("thumbnail_url, storage_path, source")
          .eq("scene_round_id", round.id)
          .eq("is_current", true)
          .limit(1);

        if (assets && assets.length > 0) {
          const asset = assets[0];
          
          // For uploaded assets, use storage URL; for Dropbox, use thumbnail_url
          if (asset.source === "upload" && asset.storage_path) {
            const { data: urlData } = supabase.storage
              .from("scene-assets")
              .getPublicUrl(asset.storage_path);
            setThumbnailUrl(urlData.publicUrl);
            break;
          } else if (asset.thumbnail_url) {
            setThumbnailUrl(asset.thumbnail_url);
            break;
          }
        }
      }
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, { text: string; class: string }> = {
      pending_instruction: { text: "AWAITING ROUND 01 BRIEF", class: "bg-muted text-muted-foreground" },
      in_production: { text: "IN PRODUCTION", class: "bg-muted text-foreground" },
      delivered: { text: "CLIENT REVIEW", class: "bg-[#1C1A17] text-gold" },
      approved: { text: "APPROVED", class: "bg-primary/20 text-primary" },
    };
    return labels[status] || labels.pending_instruction;
  };

  const getPhaseLabel = (status: string) => {
    const phases: Record<string, string> = {
      pending_instruction: "SETUP",
      in_production: "IN PROGRESS",
      delivered: "UNDER REVIEW",
      approved: "FINALIZED",
    };
    return phases[status] || "SETUP";
  };

  const statusInfo = getStatusLabel(scene.status);
  const progress = (scene.current_round / scene.paid_rounds) * 100;

  return (
    <div 
      className="group overflow-hidden rounded-lg border border-border bg-card transition-smooth hover:border-gold/30 animate-fade-in"
      style={{ animationDelay: `${0.1 + index * 0.05}s` }}
    >
      <div className="flex flex-col lg:flex-row">
        {/* Thumbnail Section */}
        <div className="relative aspect-[4/3] w-full lg:aspect-square lg:w-80 flex-shrink-0 bg-secondary">
          <SmartImage
            src={thumbnailUrl}
            alt={scene.name}
            className="h-full w-full object-cover grayscale"
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
              </div>
            }
          />
          
          {/* Corner Frame Overlay */}
          <div className="pointer-events-none absolute inset-4">
            {/* Top-left corner */}
            <div className="absolute left-0 top-0 h-6 w-6 border-l border-t border-white/30" />
            {/* Bottom-left corner */}
            <div className="absolute bottom-0 left-0 h-6 w-6 border-b border-l border-white/30" />
            {/* Top-right corner */}
            <div className="absolute right-0 top-0 h-6 w-6 border-r border-t border-white/30" />
            {/* Bottom-right corner */}
            <div className="absolute bottom-0 right-0 h-6 w-6 border-b border-r border-white/30" />
          </div>

          {/* Status Badge */}
          <div className="absolute left-4 top-4">
            <span className={`px-3 py-1.5 text-[10px] font-medium tracking-wider ${statusInfo.class}`}>
              {statusInfo.text}
            </span>
          </div>
        </div>

        {/* Content Section */}
        <div className="flex flex-1 flex-col justify-between p-6 lg:p-8">
          <div>
            {/* Scene Number & Label */}
            <div className="mb-3 flex items-center gap-3">
              <span className="text-xs font-medium tracking-wider text-gold">
                #{String(index + 1).padStart(3, "0")}
              </span>
              <div className="h-px w-4 bg-gold-muted" />
              <span className="text-[10px] tracking-wider text-muted-foreground">
                PRODUCTION SCENE
              </span>
            </div>

            {/* Scene Name */}
            <h3 className="font-serif text-2xl font-normal tracking-tight text-foreground lg:text-3xl">
              {scene.name.toUpperCase()}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {scene.projectName} — {scene.clientName}
            </p>

            {/* Round Buttons */}
            <div className="mt-6 flex flex-wrap gap-2">
              {rounds.map((round) => {
                const isCurrent = round.round_number === scene.current_round;
                const isDelivered = round.status === "delivered" || round.status === "approved";
                
                return (
                  <div key={round.id} className="group relative">
                    <button
                      className={`px-4 py-2 text-[10px] font-medium tracking-wider transition-smooth ${
                        isCurrent
                          ? "border border-gold bg-[#1C1A17] text-gold"
                          : isDelivered
                          ? "border border-border text-foreground hover:border-gold/50"
                          : "border border-border/50 text-muted-foreground opacity-60"
                      }`}
                    >
                      ROUND {String(round.round_number).padStart(2, "0")}
                    </button>
                    <button
                      title={`Delete round ${round.round_number}`}
                      className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full border border-destructive bg-background text-destructive group-hover:flex"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = window.confirm(
                          `Delete Round ${round.round_number} of "${scene.name}"?\n\nAll its assets will be removed.`,
                        );
                        if (!ok) return;
                        const { error } = await supabase
                          .from("scene_rounds")
                          .delete()
                          .eq("id", round.id);
                        if (error) {
                          alert(`Could not delete round: ${error.message}`);
                          return;
                        }
                        // Refresh local rounds list
                        setRounds((prev) => prev.filter((r) => r.id !== round.id));
                      }}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
              {/* Show placeholder rounds if not all created yet */}
              {Array.from({ length: scene.paid_rounds - rounds.length }).map((_, i) => (
                <button
                  key={`placeholder-${i}`}
                  className="px-4 py-2 text-[10px] font-medium tracking-wider border border-border/30 text-muted-foreground/40 cursor-not-allowed"
                  disabled
                >
                  ROUND {String(rounds.length + i + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>

          {/* Phase & Progress */}
          <div className="mt-8">
            {/* Deadline Countdown */}
            {timeRemaining && (
              <div className="mb-4 rounded bg-secondary/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-gold" />
                    <span className="text-[10px] font-medium tracking-wider text-gold">
                      REVIEW DEADLINE
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${timeRemaining === "Overdue" ? "text-destructive" : "text-foreground"}`}>
                    {timeRemaining}
                  </span>
                </div>
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                      deadlineProgress < 20 ? "bg-destructive" : deadlineProgress < 50 ? "bg-gold" : "bg-primary"
                    }`}
                    style={{ width: `${deadlineProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Current Phase Label */}
            <div className="mb-4">
              <span className="text-[10px] tracking-wider text-muted-foreground">
                CURRENT PHASE
              </span>
              <p className="text-sm font-medium tracking-wide text-foreground">
                {getPhaseLabel(scene.status)}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="relative">
                <div className="h-px w-full bg-border" />
                <div
                  className="absolute top-0 h-px bg-gold-muted transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute -top-1 h-2 w-2 rounded-full border border-gold bg-background transition-all duration-700"
                  style={{
                    left: `${progress}%`,
                    transform: "translateX(-50%)",
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] tracking-wider text-muted-foreground">
                <span>KICKOFF</span>
                <span>FINAL REVIEW</span>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={onFolderMappingClick}
              >
                Manage Folder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto gap-2 text-xs text-destructive hover:text-destructive"
                onClick={async () => {
                  const ok = window.confirm(
                    `Permanently delete scene "${scene.name}"?\n\nAll its rounds and assets will be removed. This cannot be undone.`,
                  );
                  if (!ok) return;
                  const { error } = await supabase.from("scenes").delete().eq("id", scene.id);
                  if (error) {
                    alert(`Could not delete scene: ${error.message}`);
                    return;
                  }
                  onDeleted?.();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete scene
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
