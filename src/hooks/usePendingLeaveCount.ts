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
    // Leave requests and extra hours both wait on the same person, so they share
    // the badge. team_hours isn't in the generated types yet, hence the cast.
    const [leave, hours] = await Promise.all([
      supabase.from("team_leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      (supabase as any).from("team_hours").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    if (!leave.error) setCount((leave.count ?? 0) + (hours.error ? 0 : hours.count ?? 0));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "team_hours" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, refresh]);

  return count;
}
