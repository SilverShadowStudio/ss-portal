import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Counts unpaid overheads that need attention: due within the next 7 days
// OR already past due. Feeds the sidebar badge on /admin/finance/expenses.
// Live: 60s poll + realtime INSERT/UPDATE bump on the overheads table
// (already in supabase_realtime via 20260721000001_overhead_realtime.sql).
export function useDueOverheadsCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const in7d = new Date();
    in7d.setUTCHours(0, 0, 0, 0);
    in7d.setUTCDate(in7d.getUTCDate() + 7);
    const in7dIso = in7d.toISOString().slice(0, 10);

    const { count: n, error } = await supabase
      .from("overheads")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "unpaid")
      .not("due_date", "is", null)
      .lte("due_date", in7dIso);
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
      .channel("admin-due-overheads")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "overheads" },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "overheads" },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "overheads" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  return count;
}
