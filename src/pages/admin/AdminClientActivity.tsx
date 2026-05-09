import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceStrict, subDays } from "date-fns";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity } from "lucide-react";

interface Row {
  id: string;
  user_id: string;
  actor_name: string | null;
  actor_role: string | null;
  kind: "session_start" | "session_end" | "page_view";
  session_id: string | null;
  path: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

interface ClientOption {
  user_id: string;
  label: string;
}

interface SessionSummary {
  sessionId: string;
  userId: string;
  actorName: string | null;
  start: string;
  end: string | null;
  durationMs: number;
}

interface PageSummary {
  path: string;
  visits: number;
  totalMs: number;
}

function formatDuration(ms: number) {
  if (!ms || ms < 1000) return "<1s";
  return formatDistanceStrict(0, ms);
}

export default function AdminClientActivity() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [from, setFrom] = useState<string>(
    format(subDays(new Date(), 30), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());

  // Load client list (non-admin profiles)
  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");
      const admins = new Set(
        (roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
      );
      setAdminIds(admins);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, first_name, last_name, company");
      const opts: ClientOption[] = (profiles ?? [])
        .filter((p) => !admins.has(p.user_id))
        .map((p) => ({
          user_id: p.user_id,
          label:
            [p.first_name, p.last_name].filter(Boolean).join(" ") ||
            p.full_name ||
            p.company ||
            "Unknown",
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setClients(opts);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from("client_activity")
        .select(
          "id, user_id, actor_name, actor_role, kind, session_id, path, started_at, ended_at, duration_ms",
        )
        .gte("created_at", `${from}T00:00:00Z`)
        .lte("created_at", `${to}T23:59:59Z`)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (selectedUser !== "all") q = q.eq("user_id", selectedUser);
      const { data } = await q;
      const filtered = ((data ?? []) as Row[]).filter(
        (r) => !adminIds.has(r.user_id),
      );
      setRows(filtered);
      setLoading(false);
    })();
  }, [selectedUser, from, to, adminIds]);

  // Aggregate sessions
  const sessions: SessionSummary[] = useMemo(() => {
    const bySid = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.session_id) continue;
      const arr = bySid.get(r.session_id) ?? [];
      arr.push(r);
      bySid.set(r.session_id, arr);
    }
    const out: SessionSummary[] = [];
    bySid.forEach((items, sid) => {
      const sortedAsc = [...items].sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      );
      const start = sortedAsc.find((i) => i.kind === "session_start");
      const end = [...items]
        .reverse()
        .find((i) => i.kind === "session_end");
      const startTs = new Date(
        (start ?? sortedAsc[0]).started_at,
      ).getTime();
      const endTs = end
        ? new Date(end.ended_at ?? end.started_at).getTime()
        : new Date(
            sortedAsc[sortedAsc.length - 1].ended_at ??
              sortedAsc[sortedAsc.length - 1].started_at,
          ).getTime();
      // Sum page_view durations as a more reliable engagement metric
      const pageMs = items
        .filter((i) => i.kind === "page_view")
        .reduce((s, i) => s + (i.duration_ms ?? 0), 0);
      out.push({
        sessionId: sid,
        userId: sortedAsc[0].user_id,
        actorName: sortedAsc[0].actor_name,
        start: new Date(startTs).toISOString(),
        end: end ? new Date(endTs).toISOString() : null,
        durationMs: pageMs > 0 ? pageMs : Math.max(0, endTs - startTs),
      });
    });
    return out.sort(
      (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
    );
  }, [rows]);

  // Aggregate pages
  const pages: PageSummary[] = useMemo(() => {
    const byPath = new Map<string, PageSummary>();
    for (const r of rows) {
      if (r.kind !== "page_view" || !r.path) continue;
      const cur = byPath.get(r.path) ?? {
        path: r.path,
        visits: 0,
        totalMs: 0,
      };
      cur.visits += 1;
      cur.totalMs += r.duration_ms ?? 0;
      byPath.set(r.path, cur);
    }
    return Array.from(byPath.values()).sort((a, b) => b.totalMs - a.totalMs);
  }, [rows]);

  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold" />
          <span className="text-label-gold">Engagement</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          CLIENT ACTIVITY
        </h1>
        <p className="text-sm text-muted-foreground">
          Login sessions and per-page time for every client.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-4 animate-fade-in">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
            Client
          </label>
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
            From
          </label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
            To
          </label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground tracking-wider">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Activity className="h-5 w-5 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-serif text-base text-muted-foreground">
            No client activity in this range.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Sessions */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-6">
            <h2 className="font-serif text-lg mb-4 flex items-center gap-2">
              <span className="h-px w-6 bg-gold" />
              Sessions ({sessions.length})
            </h2>
            <ul className="divide-y divide-border/40 max-h-[60vh] overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.sessionId} className="py-4 grid grid-cols-3 items-center gap-4">
                  <p className="text-sm font-medium text-foreground truncate">
                    {s.actorName ?? "Unknown"}
                  </p>
                  <div className="text-left">
                    <p className="font-serif text-base text-foreground tracking-wide">
                      {format(new Date(s.start), "HH:mm")}
                      {" — "}
                      {s.end ? format(new Date(s.end), "HH:mm") : (
                        <span className="italic text-muted-foreground">ongoing</span>
                      )}
                    </p>
                    <p className="mt-1 text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                      {format(new Date(s.start), "d MMM yyyy")}
                    </p>
                  </div>
                  <span className="justify-self-end text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
                    {formatDuration(s.durationMs)}
                  </span>
                </li>
              ))}
              {sessions.length === 0 && (
                <li className="py-6 text-center text-xs text-muted-foreground">
                  No sessions
                </li>
              )}
            </ul>
          </div>

          {/* Pages */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-6">
            <h2 className="font-serif text-lg mb-4 flex items-center gap-2">
              <span className="h-px w-6 bg-gold" />
              Pages visited
            </h2>
            <ul className="divide-y divide-border/40 max-h-[60vh] overflow-y-auto">
              {pages.map((p) => (
                <li key={p.path} className="py-3 flex items-center gap-4">
                  <code className="text-xs text-foreground truncate flex-1">
                    {p.path}
                  </code>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {p.visits} visit{p.visits === 1 ? "" : "s"}
                  </span>
                  <span className="shrink-0 text-[11px] tracking-[0.12em] uppercase text-muted-foreground w-20 text-right">
                    {formatDuration(p.totalMs)}
                  </span>
                </li>
              ))}
              {pages.length === 0 && (
                <li className="py-6 text-center text-xs text-muted-foreground">
                  No page views
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}