// airtable-sync/index.ts
// Bidirectional sync between Supabase (portal) and Airtable (Kieran's production tracker).
//
// Actions:
//   push-scene   — portal → Airtable: create or update a scene record
//   push-status  — portal → Airtable: update delivery status on a scene record
//   pull-status  — Airtable → portal: read status from Airtable and update scene_rounds
//   get-config   — return current field mapping config
//   set-config   — save field mapping config

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Default field mapping — Kieran can override these via set-config ──────────
const DEFAULT_CONFIG = {
  // Airtable table IDs / names
  projects_table: "",   // e.g. "tblXXX" or "Projects"
  scenes_table: "",     // e.g. "tblYYY" or "Scenes"
  
  // Field names in Airtable scenes table
  field_scene_name: "Name",
  field_project_name: "Project",
  field_status: "Status",
  field_delivery_date: "Delivery Date",
  field_round: "Round",
  field_portal_scene_id: "Portal Scene ID",  // We write this so we can match records
  
  // Status value mappings (Airtable value → portal status)
  status_in_production: "In Progress",
  status_awaiting_review: "Awaiting Review",
  status_approved: "Approved",
  status_delivered: "Delivered",
};

async function getConfig(supabase: any) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "airtable_field_config")
    .maybeSingle();
  
  if (data?.value) {
    return { ...DEFAULT_CONFIG, ...data.value };
  }
  return DEFAULT_CONFIG;
}

async function saveConfig(supabase: any, config: any) {
  await supabase
    .from("app_settings")
    .upsert({ key: "airtable_field_config", value: config }, { onConflict: "key" });
}

async function getAirtableHeaders() {
  const pat = Deno.env.get("AIRTABLE_PAT");
  if (!pat) throw new Error("AIRTABLE_PAT not configured");
  return {
    Authorization: `Bearer ${pat}`,
    "Content-Type": "application/json",
  };
}

async function findAirtableRecord(baseId: string, tableId: string, fieldName: string, value: string, headers: any) {
  const filterFormula = `{${fieldName}} = "${value}"`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

async function createAirtableRecord(baseId: string, tableId: string, fields: any, headers: any) {
  const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable create failed: ${err}`);
  }
  return res.json();
}

async function updateAirtableRecord(baseId: string, tableId: string, recordId: string, fields: any, headers: any) {
  const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable update failed: ${err}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin
    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authedClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const baseId = Deno.env.get("AIRTABLE_BASE_ID");
    if (!baseId && action !== "get-config" && action !== "set-config") {
      return new Response(JSON.stringify({ error: "AIRTABLE_BASE_ID not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = await getConfig(supabase);

    // ── get-config ───────────────────────────────────────────────────────────
    if (action === "get-config") {
      return new Response(JSON.stringify({ config }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── set-config ───────────────────────────────────────────────────────────
    if (action === "set-config") {
      const newConfig = { ...config, ...body.config };
      await saveConfig(supabase, newConfig);
      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const atHeaders = await getAirtableHeaders();
    const tableId = config.scenes_table || Deno.env.get("AIRTABLE_TABLE_ID") || "";

    // ── push-scene ───────────────────────────────────────────────────────────
    // Push a scene to Airtable (create or update)
    if (action === "push-scene") {
      const { sceneId } = body;
      if (!sceneId) throw new Error("sceneId required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("id, name, status, current_round, next_delivery_at, project_id, projects(name)")
        .eq("id", sceneId)
        .single();

      if (!scene) throw new Error("Scene not found");

      const fields: any = {
        [config.field_scene_name]: scene.name,
        [config.field_project_name]: (scene.projects as any)?.name || "",
        [config.field_status]: scene.status,
        [config.field_round]: scene.current_round,
        [config.field_portal_scene_id]: scene.id,
      };

      if (scene.next_delivery_at) {
        fields[config.field_delivery_date] = scene.next_delivery_at.split("T")[0];
      }

      // Check if record already exists
      const existing = await findAirtableRecord(baseId!, tableId, config.field_portal_scene_id, scene.id, atHeaders);

      let result;
      if (existing) {
        result = await updateAirtableRecord(baseId!, tableId, existing.id, fields, atHeaders);
      } else {
        result = await createAirtableRecord(baseId!, tableId, fields, atHeaders);
      }

      // Store the Airtable record ID on the scene for future updates
      if (result.id) {
        await supabase.from("scenes").update({ airtable_record_id: result.id }).eq("id", sceneId);
      }

      return new Response(JSON.stringify({ success: true, airtableId: result.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── push-status ──────────────────────────────────────────────────────────
    // Update just the status field in Airtable
    if (action === "push-status") {
      const { sceneId, status } = body;
      if (!sceneId || !status) throw new Error("sceneId and status required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("airtable_record_id")
        .eq("id", sceneId)
        .single();

      if (!scene?.airtable_record_id) {
        return new Response(JSON.stringify({ error: "Scene not synced to Airtable yet. Run push-scene first." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await updateAirtableRecord(baseId!, tableId, scene.airtable_record_id, {
        [config.field_status]: status,
      }, atHeaders);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── pull-status ──────────────────────────────────────────────────────────
    // Read status from Airtable and update portal scene status
    if (action === "pull-status") {
      const { sceneId } = body;
      if (!sceneId) throw new Error("sceneId required");

      const { data: scene } = await supabase
        .from("scenes")
        .select("airtable_record_id")
        .eq("id", sceneId)
        .single();

      if (!scene?.airtable_record_id) {
        return new Response(JSON.stringify({ error: "Scene not synced to Airtable" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${scene.airtable_record_id}`;
      const res = await fetch(url, { headers: atHeaders });
      if (!res.ok) throw new Error(`Airtable fetch failed: ${await res.text()}`);
      const record = await res.json();

      const atStatus = record.fields?.[config.field_status];
      
      // Map Airtable status back to portal status
      let portalStatus = null;
      if (atStatus === config.status_in_production) portalStatus = "in_production";
      else if (atStatus === config.status_awaiting_review) portalStatus = "awaiting_review";
      else if (atStatus === config.status_approved) portalStatus = "approved";
      else if (atStatus === config.status_delivered) portalStatus = "delivered";

      if (portalStatus) {
        await supabase.from("scenes").update({ status: portalStatus }).eq("id", sceneId);
      }

      return new Response(JSON.stringify({ success: true, airtableStatus: atStatus, portalStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
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
