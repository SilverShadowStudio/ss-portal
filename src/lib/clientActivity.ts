import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";

const SESSION_KEY = "ss-client-activity-session";
const GHOST_KEY = "ss-ghost-mode";

function ghostActive(): boolean {
  try {
    return !!localStorage.getItem(GHOST_KEY);
  } catch {
    return false;
  }
}

export type ActivityKind = "session_start" | "session_end" | "page_view";

interface ActorInfo {
  user_id: string;
  actor_name: string | null;
  actor_role: string | null;
}

let cachedActor: ActorInfo | null = null;

export function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export function clearSessionId() {
  sessionStorage.removeItem(SESSION_KEY);
  cachedActor = null;
}

export async function resolveActor(userId: string): Promise<ActorInfo | null> {
  if (cachedActor && cachedActor.user_id === userId) return cachedActor;
  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.full_name ||
    null;
  cachedActor = {
    user_id: userId,
    actor_name: name,
    actor_role: roleRow?.role ?? null,
  };
  return cachedActor;
}

interface InsertInput {
  userId: string;
  kind: ActivityKind;
  path?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

export async function insertClientActivity(input: InsertInput): Promise<void> {
  // Hard guard: never log anything while Ghost Mode is active.
  if (ghostActive()) return;
  try {
    const actor = await resolveActor(input.userId);
    await supabase.from("client_activity").insert({
      user_id: input.userId,
      actor_name: actor?.actor_name ?? null,
      actor_role: actor?.actor_role ?? null,
      kind: input.kind,
      session_id: getOrCreateSessionId(),
      path: input.path ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
      ended_at: input.endedAt ?? null,
      duration_ms: input.durationMs ?? null,
      metadata: (input.metadata as never) ?? {},
    });
  } catch (err) {
    console.warn("client_activity insert failed", err);
  }
}

// ── Session aggregation + duration formatting (admin instrumentation) ──
// client_activity stores session_start / session_end / page_view as separate
// rows keyed by session_id. A session's duration is reconstructed by grouping
// rows by session_id — no single row carries the full duration. session_end is
// written via an unload beacon and is unreliable, so durations are always
// computed at read time. Mirrors the aggregation on /admin/client-activity.

export interface SessionActivityRow {
  user_id: string;
  kind: string;
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface SessionSummary {
  sessionId: string;
  userId: string;
  /** ISO timestamp of session start. */
  start: string;
  /** ISO timestamp of session end, or null while still open. */
  end: string | null;
  durationMs: number;
  pageViews: number;
}

/** Group client_activity rows by session_id into per-session summaries, newest first. */
export function aggregateSessions(rows: SessionActivityRow[]): SessionSummary[] {
  const bySid = new Map<string, SessionActivityRow[]>();
  for (const r of rows) {
    if (!r.session_id) continue;
    const arr = bySid.get(r.session_id) ?? [];
    arr.push(r);
    bySid.set(r.session_id, arr);
  }
  const out: SessionSummary[] = [];
  bySid.forEach((items, sid) => {
    const asc = [...items].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    );
    const startRow = asc.find((i) => i.kind === "session_start");
    const endRow = [...items].reverse().find((i) => i.kind === "session_end");
    const last = asc[asc.length - 1];
    const startTs = new Date((startRow ?? asc[0]).started_at).getTime();
    const endTs = endRow
      ? new Date(endRow.ended_at ?? endRow.started_at).getTime()
      : new Date(last.ended_at ?? last.started_at).getTime();
    const pageRows = items.filter((i) => i.kind === "page_view");
    const pageMs = pageRows.reduce((s, i) => s + (i.duration_ms ?? 0), 0);
    out.push({
      sessionId: sid,
      userId: asc[0].user_id,
      start: new Date(startTs).toISOString(),
      end: endRow ? new Date(endTs).toISOString() : null,
      durationMs: pageMs > 0 ? pageMs : Math.max(0, endTs - startTs),
      pageViews: pageRows.length,
    });
  });
  return out.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
}

/** Compact human duration. <1m → "<1m", <1h → "47m", <24h → "18h 22m", else "3d 4h". */
export function formatSessionDuration(ms: number): string {
  if (ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMin % 60}m`;
  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}

/** Session whose start is nearest a client_login event, within windowMs (default 60s). */
export function findSessionForLogin(
  sessions: SessionSummary[],
  userId: string,
  loginIso: string,
  windowMs = 60_000,
): SessionSummary | null {
  const t = new Date(loginIso).getTime();
  let best: SessionSummary | null = null;
  let bestDelta = Infinity;
  for (const s of sessions) {
    if (s.userId !== userId) continue;
    const delta = Math.abs(new Date(s.start).getTime() - t);
    if (delta <= windowMs && delta < bestDelta) {
      best = s;
      bestDelta = delta;
    }
  }
  return best;
}

/** Suffix for a client_login row: "18m session", "active" (open), or null (no match). */
export function loginDurationSuffix(
  sessions: SessionSummary[],
  userId: string,
  loginIso: string,
): string | null {
  const s = findSessionForLogin(sessions, userId, loginIso);
  if (!s) return null;
  if (!s.end) return "active";
  return `${formatSessionDuration(s.durationMs)} session`;
}

/**
 * Fire-and-forget beacon for unload events. Falls back to fetch keepalive.
 */
export function beaconClientActivity(payload: {
  userId: string;
  actorName: string | null;
  actorRole: string | null;
  kind: ActivityKind;
  sessionId: string;
  path: string | null;
  startedAt: string;
  durationMs: number | null;
}) {
  if (ghostActive()) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/client_activity`;
    const body = JSON.stringify({
      user_id: payload.userId,
      actor_name: payload.actorName,
      actor_role: payload.actorRole,
      kind: payload.kind,
      session_id: payload.sessionId,
      path: payload.path,
      started_at: payload.startedAt,
      ended_at: new Date().toISOString(),
      duration_ms: payload.durationMs,
      metadata: {},
    });
    const apikey = SUPABASE_PUBLISHABLE_KEY;
    const token =
      (window as any).__ss_access_token ?? apikey;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey,
      Authorization: `Bearer ${token}`,
      Prefer: "return=minimal",
    };
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      // sendBeacon can't set custom headers, so use fetch with keepalive when auth needed
      void fetch(url, { method: "POST", body, headers, keepalive: true }).catch(() => {});
      void blob; // referenced to avoid unused
    } else {
      void fetch(url, { method: "POST", body, headers, keepalive: true }).catch(() => {});
    }
  } catch {
    /* swallow */
  }
}