import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Counts leave requests awaiting a decision, across every team member. Feeds the
// sidebar badge on /admin/team — without it a pending request is only visible by
// opening that specific person's calendar, so it could sit unseen indefinitely.
// Live: 60s poll + realtime bump on team_leave_requests.
export function usePendingLeaveCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const { count: n, error } = await supabase
      .from("team_leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (!error) setCount(n ?? 0);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("admin-pending-leave")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_leave_requests" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, refresh]);

  return count;
}
