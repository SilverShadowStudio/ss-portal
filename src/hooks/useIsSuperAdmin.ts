import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns true if the current user has `profiles.is_super_admin = true`.
 *
 * Both Fred and Kieran are `user_roles.role = 'admin'` for RLS purposes;
 * `is_super_admin` is the Fred-only flag for feature gates (settings that
 * change studio-wide behaviour, dangerous actions, etc.) that Kieran
 * shouldn't be able to trigger.
 */
export function useIsSuperAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsSuperAdmin(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("is_super_admin")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setIsSuperAdmin(!!(data as any)?.is_super_admin);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isSuperAdmin, loading: authLoading || loading };
}
