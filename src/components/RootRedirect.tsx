import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { teamCategoryOf, hasEarnings } from "@/lib/teamCategory";
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
        supabase.from("account_members").select("accounts(account_type, employment_type, position, team_role)").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (roleData?.role === "admin") { setTarget("/admin"); return; }
      const account = (memberData as { accounts?: { account_type?: string; employment_type?: string; position?: string | null; team_role?: string | null } } | null)?.accounts;
      if (account?.account_type === "team") {
        // Only categories with an Earnings page land on it; the rest (employees,
        // freelancers) start on Documents.
        const category = teamCategoryOf(account.employment_type, account.position ?? account.team_role);
        setTarget(hasEarnings(category) ? "/earnings" : "/documents");
        return;
      }
      setTarget("/portfolio");
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
