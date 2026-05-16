import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "client" | "team";

export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (error) {
          console.error("Error fetching user role:", error);
          setRole(null);
        } else if (data && data.length > 0) {
          // Precedence for users with multiple role rows: admin > client > team.
          // 'client' wins over 'team' because dual-account users (a real client
          // who is also part of a team account) should land on the client
          // portal as their primary experience.
          const roles = data.map((r) => r.role as AppRole);
          if (roles.includes("admin"))       setRole("admin");
          else if (roles.includes("client")) setRole("client");
          else if (roles.includes("team"))   setRole("team");
          else                                setRole(roles[0]);
        } else {
          setRole("client");
        }
      } catch (err) {
        console.error("Error fetching user role:", err);
        setRole(null);
      } finally {
        setLoading(false);
      }
    }

    if (!authLoading) {
      fetchRole();
    }
  }, [user, authLoading]);

  const isAdmin  = role === "admin";
  const isTeam   = role === "team";
  // isClient stays true for nulls so existing gates that fall back to the
  // client portal when the role lookup fails don't regress.
  const isClient = role === "client" || role === null;

  return { role, isAdmin, isClient, isTeam, loading: authLoading || loading };
}
