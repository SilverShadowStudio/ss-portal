import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProjectConfig {
  base_id: string;
  table_id: string;                    // tblB4sEUfuFQOv2lA
  field_project_name: string;          // "Project name"
  field_client_facing_name: string;    // "Client Facing Project Name"
  field_client_link: string;           // "Client"
  field_project_type: string;          // "Project Type"
  field_contract_or_subscription: string; // "Contract or Subscription"
  field_status: string;                // "Status"
  // Clients table (shared with contact sync)
  clients_table_id?: string;           // tblWDmSeRB4P88ALw
  field_company_name?: string;         // "Company name"
}

const REQUIRED_KEYS: (keyof ProjectConfig)[] = [
  "base_id", "table_id",
  "field_project_name", "field_client_facing_name", "field_client_link",
  "field_project_type", "field_contract_or_subscription", "field_status",
];

const CLIENTS_TABLE_ID = "tblWDmSeRB4P88ALw";
const CLIENTS_COMPANY_FIELD = "Company name";

function codePrefix(accountType: string | null): "CP" | "RUP" {
  return accountType === "partnership" ? "RUP" : "CP";
}

function contractOrSubscription(accountType: string | null): string {
  return accountType === "partnership" ? "Subscription" : "Contract";
}

// Find the highest existing project number for the given prefix in the Airtable Projects table.
// Returns 0 if none found.
async function getHighestProjectNumber(
  baseId: string,
  tableId: string,
  projectNameField: string,
  prefix: string,
  headers: Record<string, string>,
): Promise<number> {
  let offset: string | undefined;
  let highest = 0;
  // Read up to 200 records (two pages) to find the max safely
  for (let page = 0; page < 2; page++) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}`);
    url.searchParams.set("fields[]", projectNameField);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.warn("[airtable-sync-project] Failed to list Projects:", await res.text());
      break;
    }
    const data = await res.json() as {
      records: Array<{ fields: Record<string, unknown> }>;
      offset?: string;
    };

    for (const rec of data.records) {
      const name = rec.fields[projectNameField] as string | undefined;
      if (!name) continue;
      // Match prefix followed immediately by digits (e.g. CP107, RUP42)
      const m = name.match(new RegExp(`^${prefix}(\\d+)`, "i"));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }

    if (!data.offset) break;
    offset = data.offset;
  }
  return highest;
}

// Verify an Airtable Clients record id still exists. 200 → true,
// 404 → false. Any other non-2xx trusts the stored id so a transient
// Airtable hiccup doesn't fork the link.
async function airtableRecordExists(
  baseId: string,
  tableId: string,
  recordId: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}/${recordId}`,
    { headers },
  );
  if (res.ok) return true;
  if (res.status === 404) return false;
  console.warn(
    "[airtable-sync-project] Clients record existence check returned non-2xx:",
    res.status,
    await res.text(),
  );
  return true;
}

// Look up or create a Clients record by company name. Returns record id
// or null.
async function searchOrCreateCompanyByName(
  baseId: string,
  clientsTableId: string,
  companyNameField: string,
  companyName: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const filter = encodeURIComponent(`{${companyNameField}} = "${companyName.replace(/"/g, '\\"')}"`);
  const searchRes = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientsTableId)}?filterByFormula=${filter}&maxRecords=1`,
    { headers },
  );
  if (!searchRes.ok) {
    console.warn("[airtable-sync-project] Clients search failed:", await searchRes.text());
    return null;
  }
  const data = await searchRes.json() as { records: Array<{ id: string }> };
  if (data.records?.length > 0) {
    console.log("[airtable-sync-project] Found existing Clients record by name:", data.records[0].id);
    return data.records[0].id;
  }

  const createRes = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientsTableId)}`,
    { method: "POST", headers, body: JSON.stringify({ fields: { [companyNameField]: companyName } }) },
  );
  if (!createRes.ok) {
    console.warn("[airtable-sync-project] Clients create failed:", await createRes.text());
    return null;
  }
  const created = await createRes.json() as { id: string };
  console.log("[airtable-sync-project] Created Clients record:", created.id);
  return created.id;
}

// Stored-id-first resolution. Checks accounts.airtable_client_id and
// verifies the record still exists; falls back to a by-name search and
// persists the resolved id for future syncs.
async function resolveAndStoreCompanyRecordId(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  storedAirtableClientId: string | null,
  companyName: string | null,
  baseId: string,
  clientsTableId: string,
  companyNameField: string,
  headers: Record<string, string>,
): Promise<string | null> {
  if (storedAirtableClientId) {
    const stillExists = await airtableRecordExists(
      baseId, clientsTableId, storedAirtableClientId, headers,
    );
    if (stillExists) return storedAirtableClientId;
    console.warn(
      "[airtable-sync-project] Stored airtable_client_id no longer exists in Airtable; re-resolving:",
      storedAirtableClientId,
    );
  }

  if (!companyName) return null;

  const resolvedId = await searchOrCreateCompanyByName(
    baseId, clientsTableId, companyNameField, companyName, headers,
  );
  if (!resolvedId) return null;

  const { error: updErr } = await supabase
    .from("accounts")
    .update({ airtable_client_id: resolvedId } as Record<string, unknown>)
    .eq("id", accountId);
  if (updErr) {
    console.warn("[airtable-sync-project] Failed to persist airtable_client_id:", updErr.message);
  } else {
    console.log("[airtable-sync-project] Stored airtable_client_id on account", accountId, "→", resolvedId);
  }
  return resolvedId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: admin JWT — the only caller is the Add Project flow in
  // AdminProjects.tsx, which runs as a signed-in admin. The cron-secret branch
  // is accepted too, for a future server-side backfill. Previously ungated,
  // which left an anonymous write path into Kieran's Airtable base.
  const auth = await requireCronOrAdmin(req, {
    secretEnvVar: "CRON_SECRET",
    corsHeaders,
  });
  if (!auth.ok) return auth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const airtableKey = Deno.env.get("AIRTABLE_API_KEY") || Deno.env.get("AIRTABLE_PAT");

  if (!airtableKey) {
    console.warn("[airtable-sync-project] AIRTABLE_API_KEY not set — skipping");
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (Deno.env.get("AIRTABLE_WRITES_ENABLED") !== "true") {
    console.log("[airtable-sync-project] Airtable writes paused (AIRTABLE_WRITES_ENABLED=false)");
    return new Response(JSON.stringify({ skipped: true, reason: "writes_paused" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { project_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.project_id) {
    return new Response(JSON.stringify({ error: "project_id is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Load config
  const { data: cfgRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "airtable_project_field_config")
    .maybeSingle();

  const cfg = (cfgRow?.value ?? {}) as Partial<ProjectConfig>;
  const missing = REQUIRED_KEYS.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    console.warn("[airtable-sync-project] Config incomplete — skipping. Missing:", missing.join(", "));
    return new Response(JSON.stringify({ skipped: true, reason: "config_incomplete", missing }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const c = cfg as ProjectConfig;
  const atHeaders: Record<string, string> = {
    Authorization: `Bearer ${airtableKey}`,
    "Content-Type": "application/json",
  };

  // Load project + account from portal
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, name, account_id, project_code")
    .eq("id", body.project_id)
    .single();

  if (projErr || !project) {
    console.error("[airtable-sync-project] Project not found:", body.project_id);
    return new Response(JSON.stringify({ error: "project_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let companyName: string | null = null;
  let accountType: string | null = null;
  let storedAirtableClientId: string | null = null;
  if (project.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("company_name, account_type, airtable_client_id")
      .eq("id", project.account_id)
      .maybeSingle();
    const a = account as Record<string, unknown> | null;
    companyName = (a?.company_name as string | null) ?? null;
    accountType = (a?.account_type as string | null) ?? null;
    storedAirtableClientId = (a?.airtable_client_id as string | null) ?? null;
  }

  const prefix = codePrefix(accountType);

  // ── Step 1: Project code — use pre-set value or auto-generate ─────────────
  // Dropbox-only linked projects arrive with project_code already set from the
  // folder name (e.g. CP107). Use it directly to avoid minting a duplicate code.
  const existingCode = (project as Record<string, unknown>).project_code as string | null;
  let projectCode: string;
  if (existingCode) {
    projectCode = existingCode;
    console.log(`[airtable-sync-project] Using supplied project_code: ${projectCode}`);
  } else {
    const highest = await getHighestProjectNumber(c.base_id, c.table_id, c.field_project_name, prefix, atHeaders);
    projectCode = `${prefix}${highest + 1}`;
    console.log(`[airtable-sync-project] Generated project code: ${projectCode}`);
  }

  // ── Step 2: Resolve Clients (company) record ──────────────────────────────
  // Prefer accounts.airtable_client_id; fall back to a by-name lookup
  // and persist the resolved id for future syncs.
  const clientsTableId = c.clients_table_id ?? CLIENTS_TABLE_ID;
  const companyNameField = c.field_company_name ?? CLIENTS_COMPANY_FIELD;
  let companyRecordId: string | null = null;
  if (project.account_id) {
    companyRecordId = await resolveAndStoreCompanyRecordId(
      supabase,
      project.account_id,
      storedAirtableClientId,
      companyName,
      c.base_id,
      clientsTableId,
      companyNameField,
      atHeaders,
    );
  }

  // ── Step 3: Create Projects record ────────────────────────────────────────
  const fields: Record<string, unknown> = {
    [c.field_project_name]: projectCode,
    [c.field_client_facing_name]: project.name,
    [c.field_project_type]: "Client Project",
    [c.field_contract_or_subscription]: contractOrSubscription(accountType),
    [c.field_status]: "TO START",
  };
  if (companyRecordId) {
    fields[c.field_client_link] = [companyRecordId];
  }

  const createRes = await fetch(
    `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.table_id)}`,
    { method: "POST", headers: atHeaders, body: JSON.stringify({ fields }) },
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("[airtable-sync-project] Projects create failed:", errText);
    return new Response(JSON.stringify({ error: errText }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const created = await createRes.json() as { id: string };
  console.log("[airtable-sync-project] Created Projects record:", created.id);

  // ── Step 4: Store airtable_project_id + project_code back in portal ───────
  await supabase
    .from("projects")
    .update({ airtable_project_id: created.id, project_code: projectCode } as Record<string, unknown>)
    .eq("id", body.project_id);

  return new Response(JSON.stringify({ success: true, project_code: projectCode, airtable_id: created.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
