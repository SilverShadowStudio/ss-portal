// airtable-auto-sync/index.ts
//
// Called automatically by Supabase DB triggers on scene_rounds changes.
// Three events, identified via the x-trigger-name header:
//   round_created          — INSERT on scene_rounds
//   status_changed         — UPDATE where status changed
//   instructions_submitted — UPDATE where instructions changed
//
// Email notifications go out via Resend.
// Required Supabase secrets:
//   AIRTABLE_PAT       — Airtable personal access token (already set)
//   AIRTABLE_BASE_ID   — Airtable base ID (already set)
//   RESEND_API_KEY     — Resend API key (set via Supabase dashboard > Settings > Edge Functions)
//
// Resend setup (one-time):
//   1. Sign up at resend.com, create an API key
//   2. Add the silvershadowstudio.com domain, verify DNS records
//   3. Add RESEND_API_KEY as a Supabase secret
//   Until the domain is verified, emails are skipped with a logged warning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trigger-name",
};

const NOTIFY_EMAILS = ["fred@silvershadowstudio.com", "kieran@silvershadowstudio.com"];
const FROM_ADDRESS = "Silvershadow Portal <portal@silvershadowstudio.com>";
const PORTAL_ADMIN_URL = "https://portal.silvershadowstudio.com/admin";

// ── Airtable config (mirrors airtable-sync defaults) ─────────────────────────
const DEFAULT_CONFIG = {
  scenes_table: "Tasks",
  field_scene_name: "Task name",
  field_project_name: "",
  field_status: "Status",
  field_delivery_date: "Deadline",
  field_round: "",
  field_portal_scene_id: "",
  status_pending: "🔴 TO DO",
  status_in_production: "🟡 IN PROGRESS",
  status_awaiting_review: "🔵 REVIEW",
  status_approved: "🟢 DONE",
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

function buildPushMap(config: Config): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    if (key.startsWith("status_") && typeof val === "string" && val !== "") {
      map[key.replace("status_", "")] = val;
    }
  }
  return map;
}

async function upsertAirtableRecord(
  baseId: string,
  tableId: string,
  recordId: string | null,
  fields: Record<string, unknown>,
  pat: string,
): Promise<{ id: string }> {
  const headers = { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" };
  if (recordId) {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${recordId}`,
      { method: "PATCH", headers, body: JSON.stringify({ fields }) },
    );
    if (!res.ok) throw new Error(`Airtable PATCH failed: ${await res.text()}`);
    return res.json() as Promise<{ id: string }>;
  }
  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`,
    { method: "POST", headers, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`Airtable POST failed: ${await res.text()}`);
  return res.json() as Promise<{ id: string }>;
}

// ── Email via Resend ──────────────────────────────────────────────────────────
async function sendNotification(subject: string, htmlBody: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("[airtable-auto-sync] RESEND_API_KEY not set — email skipped");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: NOTIFY_EMAILS, subject, html: htmlBody }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[airtable-auto-sync] Resend error:", err);
    } else {
      console.log("[airtable-auto-sync] Email sent:", subject);
    }
  } catch (e) {
    console.error("[airtable-auto-sync] Email exception:", e);
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function emailRow(label: string, value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  return `<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;white-space:nowrap">${label}</td><td style="padding:4px 0;font-size:13px">${value}</td></tr>`;
}

function buildEmailHtml(rows: string[], noteLines?: string[]): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
    <table style="border-collapse:collapse;margin-bottom:16px">${rows.join("")}</table>
    ${noteLines ? `<div style="margin-top:12px;padding:12px;background:#f5f5f5;border-left:3px solid #ccc;font-size:13px">${noteLines.join("<br>")}</div>` : ""}
    <p style="margin-top:20px"><a href="${PORTAL_ADMIN_URL}" style="color:#9a7d4f;font-size:13px">View in portal →</a></p>
  </div>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const airtablePat = Deno.env.get("AIRTABLE_PAT");
  const airtableBaseId = Deno.env.get("AIRTABLE_BASE_ID");

  try {
    // The trigger sends the Supabase webhook body:
    // { type, table, schema, record, old_record }
    const body = await req.json() as {
      type: string;
      table: string;
      record: Record<string, unknown>;
      old_record: Record<string, unknown> | null;
    };

    const triggerName = req.headers.get("x-trigger-name") ?? "";
    const record = body.record;
    const oldRecord = body.old_record;

    if (!triggerName || !record) {
      return new Response(JSON.stringify({ error: "Missing trigger name or record" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roundId = record.id as string;
    const sceneId = record.scene_id as string;
    const roundNumber = record.round_number as number;

    console.log(`[airtable-auto-sync] trigger=${triggerName} round=${roundId} scene=${sceneId}`);

    const supabase = createClient(supabaseUrl, serviceKey);

    // Load scene + project name for all events
    const { data: scene } = await supabase
      .from("scenes")
      .select("id, name, airtable_record_id, projects(name)")
      .eq("id", sceneId)
      .single();

    if (!scene) {
      console.error("[airtable-auto-sync] Scene not found:", sceneId);
      return new Response(JSON.stringify({ skipped: true, reason: "scene_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sceneName = scene.name as string;
    const projectName = (scene.projects as { name?: string } | null)?.name ?? "";
    const roundLabel = `Round ${String(roundNumber).padStart(2, "0")}`;

    // If Airtable is not configured, notify by email but skip Airtable sync
    const airtableConfigured = !!(airtablePat && airtableBaseId);
    if (!airtableConfigured) {
      console.warn("[airtable-auto-sync] Airtable not configured — skipping sync, sending email only");
    }

    // ── round_created ─────────────────────────────────────────────────────────
    if (triggerName === "round_created") {
      const status = record.status as string;
      const deliveryDueAt = record.delivery_due_at as string | null;
      const instructions = record.instructions as string | null;

      let airtableId: string | null = scene.airtable_record_id ?? null;

      if (airtableConfigured) {
        const config = await getConfig(supabase);
        const pushMap = buildPushMap(config);
        const atStatus = status ? (pushMap[status] ?? "") : "";

        const fields: Record<string, unknown> = {};
        if (config.field_scene_name) fields[config.field_scene_name] = sceneName;
        if (atStatus && config.field_status) fields[config.field_status] = atStatus;
        if (deliveryDueAt && config.field_delivery_date) {
          fields[config.field_delivery_date] = deliveryDueAt.split("T")[0];
        }

        const result = await upsertAirtableRecord(
          airtableBaseId!, config.scenes_table, airtableId, fields, airtablePat!,
        );

        if (result.id && result.id !== airtableId) {
          await supabase.from("scenes").update({ airtable_record_id: result.id }).eq("id", sceneId);
          airtableId = result.id;
        }

        console.log(`[airtable-auto-sync] round_created synced → Airtable ${airtableId}`);
      }

      await sendNotification(
        `[Portal] New round — ${sceneName} ${roundLabel}`,
        buildEmailHtml([
          emailRow("Project", projectName),
          emailRow("Scene", sceneName),
          emailRow("Round", roundLabel),
          emailRow("Status", status ?? "pending"),
          emailRow("Deadline", fmtDate(deliveryDueAt)),
          emailRow("Airtable", airtableId ? `<a href="https://airtable.com" style="color:#9a7d4f">Record linked</a>` : "Not yet linked"),
        ], instructions ? [instructions] : undefined),
      );

      return new Response(JSON.stringify({ success: true, airtableId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── status_changed ────────────────────────────────────────────────────────
    if (triggerName === "status_changed") {
      const newStatus = record.status as string;
      const oldStatus = oldRecord?.status as string | undefined;
      const deliveryDueAt = record.delivery_due_at as string | null;

      if (airtableConfigured) {
        const recordId = scene.airtable_record_id;
        if (!recordId) {
          console.warn("[airtable-auto-sync] No Airtable record for scene — status push skipped");
        } else {
          const config = await getConfig(supabase);
          const pushMap = buildPushMap(config);
          const atValue = pushMap[newStatus];

          if (!atValue) {
            console.warn(`[airtable-auto-sync] No Airtable mapping for status "${newStatus}" — skipped`);
          } else {
            const fields: Record<string, unknown> = { [config.field_status]: atValue };
            // Also update deadline if it's set
            if (deliveryDueAt && config.field_delivery_date) {
              fields[config.field_delivery_date] = deliveryDueAt.split("T")[0];
            }
            await upsertAirtableRecord(
              airtableBaseId!, config.scenes_table, recordId, fields, airtablePat!,
            );
            console.log(`[airtable-auto-sync] status_changed synced: ${newStatus} → ${atValue}`);
          }
        }
      }

      await sendNotification(
        `[Portal] Status changed — ${sceneName} ${roundLabel} → ${newStatus}`,
        buildEmailHtml([
          emailRow("Project", projectName),
          emailRow("Scene", sceneName),
          emailRow("Round", roundLabel),
          emailRow("New status", newStatus),
          emailRow("Previous status", oldStatus ?? "—"),
          emailRow("Deadline", fmtDate(deliveryDueAt)),
        ]),
      );

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── instructions_submitted ────────────────────────────────────────────────
    if (triggerName === "instructions_submitted") {
      const instructions = record.instructions as string;

      if (airtableConfigured) {
        const recordId = scene.airtable_record_id;
        if (!recordId) {
          console.warn("[airtable-auto-sync] No Airtable record for scene — instructions push skipped");
        } else {
          const config = await getConfig(supabase);
          try {
            await upsertAirtableRecord(
              airtableBaseId!, config.scenes_table, recordId, { Brief: instructions }, airtablePat!,
            );
            console.log("[airtable-auto-sync] instructions_submitted synced to Brief field");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.toLowerCase().includes("unknown_field") || msg.toLowerCase().includes("brief")) {
              console.warn(
                "[airtable-auto-sync] 'Brief' field not found in Airtable Tasks table. " +
                "Add a single-line or long-text field named 'Brief' to enable instructions sync.",
              );
            } else {
              throw e;
            }
          }
        }
      }

      await sendNotification(
        `[Portal] Instructions submitted — ${sceneName} ${roundLabel}`,
        buildEmailHtml(
          [
            emailRow("Project", projectName),
            emailRow("Scene", sceneName),
            emailRow("Round", roundLabel),
          ],
          instructions.split("\n"),
        ),
      );

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.warn(`[airtable-auto-sync] Unknown trigger: ${triggerName}`);
    return new Response(JSON.stringify({ skipped: true, reason: `unknown_trigger:${triggerName}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[airtable-auto-sync] Unhandled error:", msg);
    // Return 200 so the DB trigger doesn't retry — errors are logged but shouldn't
    // block the transaction or cause trigger retries.
    return new Response(JSON.stringify({ error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
