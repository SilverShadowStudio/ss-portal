import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Root route redirector. Sends authenticated users to the right home:
 *   • admins → /admin
 *   • team members → /earnings
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
      const [{ data: roleData }, { data: memberData }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("account_members").select("accounts(account_type)").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (roleData?.role === "admin") { setTarget("/admin"); return; }
      const accountType = (memberData as { accounts?: { account_type?: string } } | null)?.accounts?.account_type;
      setTarget(accountType === "team" ? "/earnings" : "/portfolio");
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || (user && !target)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BrandLoader size="lg" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  return <Navigate to={target!} replace />;
}
