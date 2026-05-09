import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Root route redirector. Sends authenticated users to the right home:
 *   • admins → /admin
 *   • clients → /portfolio
 * Unauthenticated users go to /auth.
 */
export function RootRedirect() {
  const { user, loading } = useAuth();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setTarget(data?.role === "admin" ? "/admin" : "/portfolio");
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || (user && !target)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  return <Navigate to={target!} replace />;
}
