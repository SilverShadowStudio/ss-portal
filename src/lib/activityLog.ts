import { supabase } from "@/integrations/supabase/client";

/**
 * Production-critical events tracked in the admin activity log.
 */
export type ActivityAction =
  | "project_created"
  | "project_archived"
  | "project_restored"
  | "scene_created"
  | "round_created"
  | "round_rescheduled"
  | "round_delivered"
  | "asset_uploaded"
  | "asset_deleted"
  | "asset_approved"
  | "revision_requested"
  | "scene_status_changed"
  | "client_created"
  | "client_registered"
  | "client_login"
  | "password_set"
  | "manual_invite_generated"
  | "agreement_signed"
  | "dropbox_file_received";

/** Shared badge labels used by both the dashboard preview and the full log page. */
export const ACTION_LABELS: Record<string, string> = {
  project_created: "Project",
  project_archived: "Project",
  project_restored: "Project",
  scene_created: "Scene",
  round_created: "Round",
  round_rescheduled: "Reschedule",
  round_delivered: "Delivery",
  asset_uploaded: "Upload",
  asset_deleted: "Removed",
  asset_approved: "Approved",
  revision_requested: "Revision",
  scene_status_changed: "Status",
  client_created: "Client",
  client_registered: "Client",
  client_login: "Client",
  password_set: "Password",
  manual_invite_generated: "Manual",
  agreement_signed: "Agreement",
  dropbox_file_received: "Delivery",
};

interface LogActivityInput {
  action: ActivityAction;
  description: string;
  /** Explicit role override — pass "admin" from admin-only code paths to bypass the DB lookup. */
  actorRole?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string | null;
  projectName?: string | null;
  sceneId?: string | null;
  sceneName?: string | null;
  roundId?: string | null;
  roundNumber?: number | null;
  metadata?: Record<string, unknown>;
}

// Cache is keyed by userId so it stays valid for the current session only.
let cachedActor: { userId: string; name: string | null; role: string } | null = null;

async function getActor() {
  const { data: session } = await supabase.auth.getSession();
  const user = session?.session?.user;
  if (!user) return { name: null, role: "client" };

  if (cachedActor?.userId === user.id) return cachedActor;

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.full_name ||
    user.email ||
    null;

  // Only admins have a row in user_roles; everyone else is a client.
  cachedActor = { userId: user.id, name, role: roleRow?.role ?? "client" };
  return cachedActor;
}

/**
 * Insert an activity log row. Failures are swallowed (best-effort logging
 * must never block the user's primary action).
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const user = session?.session?.user;
    if (!user) return;

    const actor = await getActor();

    await supabase.from("activity_log").insert({
      actor_user_id: user.id,
      actor_name: actor.name,
      actor_role: input.actorRole ?? actor.role,
      action: input.action,
      description: input.description,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      project_id: input.projectId ?? null,
      project_name: input.projectName ?? null,
      scene_id: input.sceneId ?? null,
      scene_name: input.sceneName ?? null,
      round_id: input.roundId ?? null,
      round_number: input.roundNumber ?? null,
      metadata: (input.metadata as never) ?? {},
    });
  } catch (err) {
    console.warn("logActivity failed", err);
  }
}