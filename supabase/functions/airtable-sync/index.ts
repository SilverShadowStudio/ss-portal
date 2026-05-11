// airtable-sync/index.ts
// Bidirectional sync between Supabase (portal) and Airtable (Kieran's production tracker).
//
// Actions:
//   push-scene   — portal → Airtable: create or update a scene record
//   push-status  — portal → Airtable: update status on a scene's Airtable record
//   pull-status  — Airtable → portal: read status + deadline, update the active scene_round
//   get-config   — return current field mapping config
//   set-config   — save field mapping config

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Default config — reflects Kieran's Airtable setup ────────────────────────
const DEFAULT_CONFIG = {
  // Airtable table name
  scenes_table: "Tasks",

  // Field names in the Airtable Tasks table
  field_scene_name: "Name",
  field_project_name: "Project",
  field_status: "Status",
  field_delivery_date: "Deadline",
  field_round: "Round",
  field_portal_scene_id: "Portal Scene ID",

  // Airtable status values → portal scene_round status mapping
  // Format: status_<portal_value>: "<Airtable value>"
  status_pending: "TO DO",
  status_in_production: "IN PROGRESS",
  status_awaiting_review: "REVIEW",
  status_approved: "DONE",
  // delivered has no Airtable equivalent; leave blank
  status_delivered: "",
  status_client_review: "",
};

type Config = typeof DEFAULT_CONFIG;

async function getConfig(supabase: ReturnType<typeof createClient>): Promise<Config> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "airtable_field_config")
    .maybeSingle();

  if (data?.value && typeof data.value === "object") {
    return { ...DEFAULT_CONFIG, ...(data.value as Partial<Config>) };
  }
  return DEFAULT_CONFIG;
}

async function saveConfig(supabase: ReturnType<typeof createClient>, config: Config) {
  await supabase
    .from("app_settings")
    .upsert({ key: "airtable_field_config", value: config }, { onConflict: "key" });
}

// Build reverse map: portal status → Airtable value
function buildPushMap(config: Config): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    if (key.startsWith("status_") && typeof val === "string" && val !== "") {
      const portalStatus = key.replace("status_", "");
      map[portalStatus] = val;
    }
  }
  return map;
}

// Build forward map: Airtable value → portal status
function buildPullMap(config: Config): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    if (key.startsWith("status_") && typeof val === "string" && val !== "") {
      const portalStatus = key.replace("status_", "");
      map[val] = portalStatus;
    }
  }
  return map;
}

function airtableHeaders(): Record<string, string> {
  const pat = Deno.env.get("AIRTABLE_PAT");
  if (!pat) throw new Error("AIRTABLE_PAT not configured");
  return { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" };
}

async function findAirtableRecord(
  baseId: string,
  tableId: string,
  fieldName: string,
  value: string,
  headers: Record<string, string>,
) {
  const filter = `{${fieldName}} = "${value}"`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.records?.[0] as Record<string, unknown>) ?? null;
}

async function upsertAirtableRecord(
  baseId: string,
  tableId: string,
  recordId: string | null,
  fields: Record<string, unknown>,
  headers: Record<string, string>,
) {
  if (recordId) {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${recordId}`,
      { method: "PATCH", headers, body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw new Error(`Airtable PATCH failed: ${await res.text()}`);
    return res.json();
  } else {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`,
      { method: "POST", headers, body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw new Error(`Airtable POST failed: ${await res.text()}`);
    return res.json();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin
    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authedClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { action } = body;
    const config = await getConfig(supabase);

    // ── get-config ────────────────────────────────────────────────────────────
    if (action === "get-config") {
      return new Response(JSON.stringify({ config }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── set-config ────────────────────────────────────────────────────────────
    if (action === "set-config") {
      const newConfig = { ...config, ...(body.config as Partial<Config> ?? {}) };
      await saveConfig(supabase, newConfig);
      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseId = Deno.env.get("AIRTABLE_BASE_ID");
    if (!baseId) {
      return new Response(JSON.stringify({ error: "AIRTABLE_BASE_ID not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const atHeaders = airtableHeaders();
    const tableId = config.scenes_table;

    // ── push-scene ────────────────────────────────────────────────────────────
    // Creates or updates the scene row in Airtable
    if (action === "push-scene") {
      const { sceneId } = body as { sceneId?: string };
      if (!sceneId) throw new Error("sceneId required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("id, name, airtable_record_id, current_round, project_id, projects(name)")
        .eq("id", sceneId)
        .single();
      if (!scene) throw new Error("Scene not found");

      // Get the latest active round's status for the Airtable status field
      const { data: round } = await supabase
        .from("scene_rounds")
        .select("status, round_number, delivery_due_at")
        .eq("scene_id", sceneId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const pushMap = buildPushMap(config);
      const atStatus = round?.status ? (pushMap[round.status] ?? "") : "";

      const fields: Record<string, unknown> = {
        [config.field_scene_name]: scene.name,
        [config.field_project_name]: (scene.projects as { name?: string } | null)?.name ?? "",
        [config.field_portal_scene_id]: scene.id,
      };
      if (atStatus) fields[config.field_status] = atStatus;
      if (round?.round_number) fields[config.field_round] = round.round_number;
      if (round?.delivery_due_at) {
        fields[config.field_delivery_date] = (round.delivery_due_at as string).split("T")[0];
      }

      // Find existing Airtable record
      let recordId = scene.airtable_record_id ?? null;
      if (!recordId) {
        const existing = await findAirtableRecord(
          baseId, tableId, config.field_portal_scene_id, scene.id, atHeaders,
        );
        recordId = (existing?.id as string) ?? null;
      }

      const result = await upsertAirtableRecord(baseId, tableId, recordId, fields, atHeaders) as { id: string };

      if (result.id && result.id !== recordId) {
        await supabase.from("scenes").update({ airtable_record_id: result.id }).eq("id", sceneId);
      }

      return new Response(JSON.stringify({ success: true, airtableId: result.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── push-status ───────────────────────────────────────────────────────────
    // Called when a portal round status changes — writes the Airtable value
    if (action === "push-status") {
      const { sceneId, status } = body as { sceneId?: string; status?: string };
      if (!sceneId || !status) throw new Error("sceneId and status required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("airtable_record_id")
        .eq("id", sceneId)
        .single();

      if (!scene?.airtable_record_id) {
        return new Response(
          JSON.stringify({ error: "Scene has no Airtable record. Run push-scene first." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const pushMap = buildPushMap(config);
      const atValue = pushMap[status];
      if (!atValue) {
        return new Response(
          JSON.stringify({ error: `No Airtable mapping for portal status "${status}"` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await upsertAirtableRecord(baseId, tableId, scene.airtable_record_id, {
        [config.field_status]: atValue,
      }, atHeaders);

      return new Response(JSON.stringify({ success: true, airtableValue: atValue }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── pull-status ───────────────────────────────────────────────────────────
    // Reads Status + Deadline from Airtable, updates the active scene_round
    if (action === "pull-status") {
      const { sceneId } = body as { sceneId?: string };
      if (!sceneId) throw new Error("sceneId required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("airtable_record_id")
        .eq("id", sceneId)
        .single();

      if (!scene?.airtable_record_id) {
        return new Response(
          JSON.stringify({ error: "Scene has no Airtable record. Run push-scene first." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${scene.airtable_record_id}`;
      const res = await fetch(url, { headers: atHeaders });
      if (!res.ok) throw new Error(`Airtable fetch failed: ${await res.text()}`);
      const record = await res.json() as { fields: Record<string, unknown> };

      const atStatus = record.fields?.[config.field_status] as string | undefined;
      const atDeadline = record.fields?.[config.field_delivery_date] as string | undefined;

      // Map Airtable status → portal status
      const pullMap = buildPullMap(config);
      const portalStatus = atStatus ? (pullMap[atStatus] ?? null) : null;

      // Find the latest scene_round for this scene
      const { data: round } = await supabase
        .from("scene_rounds")
        .select("id, status, round_number")
        .eq("scene_id", sceneId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!round) {
        return new Response(
          JSON.stringify({ error: "No scene rounds found for this scene" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const updates: Record<string, unknown> = {};
      if (portalStatus) updates.status = portalStatus;
      if (atDeadline) {
        // Airtable date fields are YYYY-MM-DD strings; store as midnight UTC
        updates.delivery_due_at = new Date(atDeadline).toISOString();
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("scene_rounds").update(updates).eq("id", round.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          airtableStatus: atStatus ?? null,
          portalStatus: portalStatus ?? null,
          deliveryDueAt: atDeadline ?? null,
          roundId: round.id,
          roundNumber: round.round_number,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[airtable-sync]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
