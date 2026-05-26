import { ReactNode, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Wraps Manager-only client routes (/team and, in Commit 3, the finance/legal
 * pages). Client-Invitees are redirected home with a toast.
 *
 * Always nested inside `ProtectedClient`, so by the time this mounts the auth
 * and agreement gates have already resolved — which means `memberRole` (set in
 * the same AuthContext effect as the agreement status) is resolved too. We can
 * therefore decide on `isClientManager` without a separate loading window.
 */
export function ManagerOnlyRoute({ children }: { children: ReactNode }) {
  const { isClientManager } = useAuth();

  useEffect(() => {
    if (!isClientManager) {
      toast.error("Access restricted — Manager only");
    }
  }, [isClientManager]);

  if (!isClientManager) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
