import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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

  const visible = rows.filter((r) => !dismissed.has(r.id));

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

  return (
    <div className="mb-14 rounded-xl border border-border bg-card shadow-sm p-8 md:p-10 animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-px w-6 bg-gold-muted" />
        <Link
          to="/admin/activity"
          className="group inline-flex items-center gap-2 text-label hover:text-foreground transition-colors"
          title="Open full activity log"
        >
          <span>Activity Log</span>
          <ArrowRight className="h-3 w-3 opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
        </Link>
        {!loading && (
          <span className="ml-auto text-[10px] tracking-[0.2em] text-muted-foreground">
            {visible.length} {visible.length === 1 ? "ENTRY" : "ENTRIES"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground text-sm tracking-wider">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center">
          <Clock className="h-4 w-4 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-serif text-base text-muted-foreground">All caught up</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/40 max-h-[28rem] overflow-y-auto">
          {visible.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => dismiss(row.id)}
                className={cn(
                  "group w-full text-left flex items-start gap-4 py-3 px-1",
                  "hover:bg-muted/30 transition-colors rounded-md",
                )}
                title="Click to dismiss from your preview"
              >
                <span className="mt-1 inline-flex h-5 min-w-[60px] items-center justify-center rounded bg-muted/60 px-2 text-[9px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
                  {ACTION_LABELS[row.action] ?? row.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {row.description}
                    {row.action === "client_login" && (() => {
                      const suffix = loginDurationSuffix(sessions, row.actor_user_id ?? "", row.created_at);
                      return suffix ? <span className="text-muted-foreground"> — {suffix}</span> : null;
                    })()}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {row.actor_name ?? "Unknown"}
                    {row.project_name ? ` · ${row.project_name}` : ""}
                    {row.scene_name ? ` · ${row.scene_name}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
                  {format(new Date(row.created_at), "d MMM HH:mm")}
                </span>
                <X className="h-3.5 w-3.5 shrink-0 mt-1 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}