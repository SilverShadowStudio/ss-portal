import { Ghost, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Persistent banner shown to an admin while impersonating a client.
 * Real clients never see this — it only renders when `isGhostMode` is true,
 * which requires the *real* signed-in user to have the `admin` role.
 */
export function GhostModeBanner() {
  const { isGhostMode, ghostTarget, exitGhostMode } = useAuth();
  const navigate = useNavigate();

  if (!isGhostMode || !ghostTarget) return null;

  const handleExit = async () => {
    await exitGhostMode();
    navigate("/admin/clients");
  };

  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] glass-pill"
      style={{ borderRadius: 0, borderTop: 0, borderLeft: 0, borderRight: 0, borderColor: "hsl(var(--gold) / 0.3)" }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <Ghost className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} />
          <p className="truncate text-xs font-medium uppercase tracking-[0.2em]">
            Ghost Mode · Viewing as{" "}
            <span className="text-gold">{ghostTarget.name}</span>
          </p>
        </div>
        <button
          onClick={handleExit}
          className="flex shrink-0 items-center gap-1.5 glass-pill px-3 py-1 text-xs font-medium text-foreground transition-colors hover:text-gold"
          style={{ borderRadius: 4, borderColor: "hsl(var(--gold) / 0.4)" }}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          Exit Ghost Mode
        </button>
      </div>
    </div>
  );
}