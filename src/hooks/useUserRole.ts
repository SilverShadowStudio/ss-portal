import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "client";

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
          // Prefer admin if user has multiple roles
          const roles = data.map((r) => r.role as AppRole);
          setRole(roles.includes("admin") ? "admin" : roles[0]);
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

  const isAdmin = role === "admin";
  const isClient = role === "client" || role === null;

  return { role, isAdmin, isClient, loading: authLoading || loading };
}
