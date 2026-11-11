import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { FeedList } from "@/components/ui/FeedList";
import { ACTION_LABELS } from "@/lib/activityLog";
import { aggregateSessions, loginDurationSuffix, type SessionSummary } from "@/lib/clientActivity";

interface ActivityRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  description: string;
  project_name: string | null;
  scene_name: string | null;
  round_number: number | null;
}

/**
 * Compact preview of the production activity log shown on the admin
 * dashboard. Clicking a row dismisses it from THIS admin's preview only;
 * the full log (accessed by clicking the section title) remains intact.
 */
export function ActivityLogPreview() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      const [{ data: logs }, { data: dismissals }] = await Promise.all([
        supabase
          .from("activity_log")
          .select(
            "id, created_at, actor_user_id, actor_name, actor_role, action, description, project_name, scene_name, round_number",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("activity_log_dismissals")
          .select("activity_id")
          .eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const logList = (logs ?? []) as ActivityRow[];
      setRows(logList);
      setDismissed(new Set((dismissals ?? []).map((d: any) => d.activity_id)));
      setLoading(false);

      // Reconstruct sessions for the client_login rows (render-time duration).
      const logins = logList.filter((r) => r.action === "client_login" && r.actor_user_id);
      const userIds = Array.from(new Set(logins.map((r) => r.actor_user_id as string)));
      if (userIds.length === 0) return;
      const earliest = logins.reduce(
        (min, r) => Math.min(min, new Date(r.created_at).getTime()),
        Date.now(),
      );
      const { data: acts } = await supabase
        .from("client_activity")
        .select("user_id, kind, session_id, started_at, ended_at, duration_ms")
        .in("user_id", userIds)
        .gte("started_at", new Date(earliest - 60_000).toISOString())
        .order("started_at", { ascending: false })
        .limit(8000);
      if (cancelled) return;
      setSessions(aggregateSessions((acts ?? []) as never));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function dismiss(id: string) {
    if (!user) return;
    // Optimistic
    setDismissed((prev) => new Set(prev).add(id));
    const { error } = await supabase
      .from("activity_log_dismissals")
      .insert({ user_id: user.id, activity_id: id });
    if (error) {
      // revert
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // The shared feed: fixed window, click a line to clear it, title → full log.
  return (
    <div className="mb-4 ssr-zone animate-fade-in">
      <FeedList
        title="Activity Log"
        historyHref="/admin/activity"
        items={rows}
        dismissed={dismissed}
        onDismiss={dismiss}
        loading={loading}
        renderItem={(row) => (
          <div className="ssr-tile ssr-tile-hover flex w-full items-start gap-4 p-4 pr-10 text-left transition-colors">
            <span className="mt-1 inline-flex h-5 min-w-[60px] items-center justify-center rounded bg-gold/20 px-2 text-[8px] font-bold uppercase tracking-[0.18em] text-[#ecd39c]">
              {ACTION_LABELS[row.action] ?? row.action}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-standard">
                {row.description}
                {row.action === "client_login" && (() => {
                  const suffix = loginDurationSuffix(sessions, row.actor_user_id ?? "", row.created_at);
                  return suffix ? <span className="text-[var(--text-label)]"> — {suffix}</span> : null;
                })()}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-label)]">
                {row.actor_name ?? "Unknown"}
                {row.project_name ? ` · ${row.project_name}` : ""}
                {row.scene_name ? ` · ${row.scene_name}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.15em] text-[var(--text-label)]">
              {format(new Date(row.created_at), "d MMM HH:mm")}
            </span>
          </div>
        )}
      />
    </div>
  );
}