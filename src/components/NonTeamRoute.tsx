import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Wraps client-only routes that team members must not access (portfolio,
 * lanes, timeline, deliveries, …). Team members are sent to their own home.
 * Nested inside ProtectedClient, so auth + accountType are already resolved.
 */
export function NonTeamRoute({ children }: { children: ReactNode }) {
  const { accountType } = useAuth();
  if (accountType === "team") return <Navigate to="/earnings" replace />;
  return <>{children}</>;
}
