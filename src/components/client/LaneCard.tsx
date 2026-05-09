import { motion } from "framer-motion";
import { ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PHASE_DOT_TOOLTIPS } from "@/lib/scenePhase";
import { SmartImage } from "@/components/ui/SmartImage";

/**
 * Dot color shown next to a card's phase label. Mirrors the dashboard:
 *   - red    -> something the client owes (brief or review)
 *   - green  -> in production / on track
 *   - gold   -> awaiting review (delivered, action required)
 *   - muted  -> approved / done
 */
export type LaneDot = "red" | "green" | "gold" | "muted" | null;

interface LaneCardProps {
  id: string;
  phase?: string;
  dot?: LaneDot;
  title: string;
  previewUrl?: string | null;
  estimate?: string;
  lastUpdate?: string;
  onClick: () => void;
}

export function LaneCard({ id, phase, dot, title, previewUrl, estimate, lastUpdate, onClick }: LaneCardProps) {
  const isAwaiting = dot === "gold";
  const dotClass =
    dot === "red"
      ? "bg-rose-500"
      : dot === "green"
      ? "bg-emerald-500"
      : dot === "gold"
      ? "bg-gold"
      : dot === "muted"
      ? "bg-muted-foreground/40"
      : "";

  return (
    <motion.div
      layoutId={`task-${id}`}
      onClick={onClick}
      className={cn(
        "relative min-w-[320px] bg-card p-6 cursor-pointer group transition-smooth rounded-sm",
      )}
      style={{
        boxShadow:
          "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 24px 60px -24px rgba(0,0,0,0.5), 0 6px 18px -10px rgba(0,0,0,0.35)",
      }}
      whileHover={{ y: -2 }}
    >
      {isAwaiting && (
        <span
          aria-hidden
          className="absolute left-0 top-4 bottom-4 w-px now-beam"
        />
      )}
      <div className="flex justify-between items-start mb-6">
        <div>
          {phase && (
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-2 font-sans">
              {dot && !isAwaiting && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      aria-label={PHASE_DOT_TOOLTIPS[dot]}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full cursor-help",
                        dotClass
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[220px] text-xs leading-snug normal-case tracking-normal font-sans"
                  >
                    {PHASE_DOT_TOOLTIPS[dot]}
                  </TooltipContent>
                </Tooltip>
              )}
              <span>{phase}</span>
            </span>
          )}
          <h3 className="text-lg font-medium tracking-tight group-hover:text-primary font-serif leading-relaxed">
            {title}
          </h3>
        </div>
        <div className="p-2 group-hover:text-primary transition-all">
          <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary" />
        </div>
      </div>

      <div className="aspect-video rounded-sm overflow-hidden bg-muted mb-6">
        <SmartImage
          src={previewUrl ?? null}
          className="h-full w-full object-cover"
          alt={title}
          fallback={
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Clock size={24} />
            </div>
          }
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground font-sans leading-relaxed">
        <div className="flex items-center gap-1.5">
          <Clock size={14} />
          <span>{estimate || "Ready in 2 days"}</span>
        </div>
        {lastUpdate && <span>{lastUpdate}</span>}
      </div>
    </motion.div>
  );
}