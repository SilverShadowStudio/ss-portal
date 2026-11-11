import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { teamCategoryOf, hasEarnings } from "@/lib/teamCategory";
import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Root route redirector. Sends authenticated users to the right home:
 *   • admins → /admin
 *   • sales reps / sales managers → /admin/sales (the only admin pages they can open)
 *   • team members → /earnings, or /documents for categories without Earnings
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
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("account_members").select("accounts(account_type, employment_type, position, team_role)").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      // Read every role row: a rep can carry a leftover team or client row,
      // and maybeSingle() errors (and returns nothing) on more than one.
      const roles = ((roleData ?? []) as { role: string }[]).map((r) => r.role);
      if (roles.includes("admin")) { setTarget("/admin"); return; }
      // Sales shared with someone (a rep, or a team member like a freelancer
      // business developer): Sales is their main work, so they start there.
      if (roles.includes("sales") || roles.includes("sales_manager")) { setTarget("/admin/sales"); return; }
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
