// Edge function: team-contract-templates-manage
// Admin-gated CRUD for team_contract_templates.
//
// Actions (POST body: { action, ...params }):
//   list     — all non-archived templates ordered by sort_order
//   create   — { name, description?, default_fields? }
//   update   — { id, name?, description?, default_fields? }
//   archive  — { id }  soft-delete via archived_at
//   restore  — { id }  clears archived_at
//   reorder  — { id, direction: "up"|"down" }  swaps sort_order with neighbour

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : null;
  if (!action) return json({ error: "action is required" }, 400);

  // ── list ────────────────────────────────────────────────────────────────────
  if (action === "list") {
    const { data, error } = await admin
      .from("team_contract_templates")
      .select("id, name, description, default_fields, sort_order, archived_at, created_at, updated_at")
      .order("sort_order", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ templates: data });
  }

  // ── create ──────────────────────────────────────────────────────────────────
  if (action === "create") {
    const name = typeof body?.name === "string" ? body.name.trim() : null;
    if (!name) return json({ error: "name is required" }, 400);
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    const defaultFields = body?.default_fields && typeof body.default_fields === "object" ? body.default_fields : {};

    // Place at end: max sort_order + 1
    const { data: maxRow } = await admin
      .from("team_contract_templates")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;

    const { data, error } = await admin
      .from("team_contract_templates")
      .insert({ name, description, default_fields: defaultFields, sort_order: sortOrder, created_by: user.id })
      .select("id, name, description, default_fields, sort_order, archived_at, created_at, updated_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ template: data });
  }

  // ── update ──────────────────────────────────────────────────────────────────
  if (action === "update") {
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return json({ error: "id is required" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body?.name === "string") patch.name = body.name.trim();
    if (typeof body?.description === "string") patch.description = body.description.trim();
    if (body?.default_fields && typeof body.default_fields === "object") patch.default_fields = body.default_fields;

    const { data, error } = await admin
      .from("team_contract_templates")
      .update(patch)
      .eq("id", id)
      .select("id, name, description, default_fields, sort_order, archived_at, created_at, updated_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ template: data });
  }

  // ── archive ─────────────────────────────────────────────────────────────────
  if (action === "archive") {
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return json({ error: "id is required" }, 400);
    const { error } = await admin
      .from("team_contract_templates")
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  // ── restore ─────────────────────────────────────────────────────────────────
  if (action === "restore") {
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return json({ error: "id is required" }, 400);
    const { error } = await admin
      .from("team_contract_templates")
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  // ── reorder ─────────────────────────────────────────────────────────────────
  // Swaps sort_order of the target row with its immediate neighbour in the
  // given direction. Only moves among non-archived templates.
  if (action === "reorder") {
    const id = typeof body?.id === "string" ? body.id : null;
    const direction = body?.direction === "up" || body?.direction === "down" ? body.direction : null;
    if (!id || !direction) return json({ error: "id and direction (up|down) are required" }, 400);

    const { data: all, error: listErr } = await admin
      .from("team_contract_templates")
      .select("id, sort_order")
      .is("archived_at", null)
      .order("sort_order", { ascending: true });
    if (listErr) return json({ error: listErr.message }, 500);

    const idx = (all ?? []).findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "Template not found" }, 404);

    const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= (all ?? []).length) {
      return json({ success: true, noop: true }); // already at boundary
    }

    const target = all![idx];
    const neighbour = all![neighbourIdx];

    // Swap sort_order values
    const [errA, errB] = await Promise.all([
      admin.from("team_contract_templates")
        .update({ sort_order: neighbour.sort_order, updated_at: new Date().toISOString() })
        .eq("id", target.id)
        .then(({ error }) => error),
      admin.from("team_contract_templates")
        .update({ sort_order: target.sort_order, updated_at: new Date().toISOString() })
        .eq("id", neighbour.id)
        .then(({ error }) => error),
    ]);
    if (errA || errB) return json({ error: (errA ?? errB)!.message }, 500);

    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
