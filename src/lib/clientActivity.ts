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