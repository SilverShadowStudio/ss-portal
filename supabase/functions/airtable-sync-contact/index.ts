import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ContactBody {
  first_name?: string;
  surname?: string;
  email?: string;
  account_id?: string;
}

interface ContactConfig {
  base_id: string;
  table_id: string;             // Users table  (tbl8V5Hd20UN9Jax6)
  field_first_name: string;
  field_surname: string;
  field_role: string;
  field_type_of_client: string;
  field_email: string;
  field_client_link: string;    // "Clients"  — linked to Clients table
  field_company_link: string;   // "Company"  — also linked to Clients table
  clients_table_id: string;     // Clients table (tblWDmSeRB4P88ALw)
  field_company_name: string;   // "Company name" in Clients table
  field_client_representative: string; // "Client Representative" in Clients table
  // Optional Clients-table columns. Only patched when the config key is
  // set to a non-empty Airtable column name. If a key is absent the
  // function silently skips that field — Fred can add columns to Kieran's
  // base and then enable them by updating app_settings.
  field_client_address?: string;
  field_client_registration_number?: string;
  field_client_country?: string;
}

interface AccountProfile {
  id: string;
  company_name: string | null;
  account_type: string | null;
  airtable_client_id: string | null;
  building_number: string | null;
  street_name: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  registration_number: string | null;
}

const REQUIRED_KEYS: (keyof ContactConfig)[] = [
  "base_id", "table_id",
  "field_first_name", "field_surname", "field_role", "field_type_of_client", "field_email",
  "field_client_link", "field_company_link",
  "clients_table_id", "field_company_name", "field_client_representative",
];

function mapAccountType(accountType: string | null): string[] {
  if (accountType === "partnership") return ["Subscription"];
  if (accountType === "project") return ["Contract"];
  return [];
}

// Compose a single-line address from the portal account fields. Empty
// pieces are dropped; if nothing survives the function returns null so
// the caller can skip the field rather than push an empty string.
function composeAddress(account: AccountProfile): string | null {
  const line1 = [account.building_number, account.street_name]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(" ");
  const parts = [line1, account.city?.trim(), account.postcode?.trim(), account.country?.trim()]
    .filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

// Verify an Airtable Clients record id still exists. Returns true on 200,
// false on 404. A non-2xx that isn't 404 is treated as "trust the stored
// id" — we don't want a transient Airtable hiccup to fork the link.
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
    "[airtable-sync-contact] Clients record existence check returned non-2xx:",
    res.status,
    await res.text(),
  );
  return true;
}

// Search Clients table for a matching company name; create one if not
// found. Returns { id, created } where `created` flags whether the row
// was newly created (so the caller can log appropriately).
async function searchOrCreateCompanyByName(
  baseId: string,
  clientsTableId: string,
  companyNameField: string,
  companyName: string,
  headers: Record<string, string>,
): Promise<{ id: string; created: boolean } | null> {
  const filter = encodeURIComponent(`{${companyNameField}} = "${companyName.replace(/"/g, '\\"')}"`);
  const searchRes = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientsTableId)}?filterByFormula=${filter}&maxRecords=1`,
    { headers },
  );
  if (!searchRes.ok) {
    console.warn("[airtable-sync-contact] Clients search failed:", await searchRes.text());
    return null;
  }
  const searchData = await searchRes.json() as { records: Array<{ id: string }> };
  if (searchData.records?.length > 0) {
    console.log("[airtable-sync-contact] Found existing Clients record by name:", searchData.records[0].id);
    return { id: searchData.records[0].id, created: false };
  }

  const createRes = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientsTableId)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ fields: { [companyNameField]: companyName } }),
    },
  );
  if (!createRes.ok) {
    console.warn("[airtable-sync-contact] Clients create failed:", await createRes.text());
    return null;
  }
  const created = await createRes.json() as { id: string };
  console.log("[airtable-sync-contact] Created new Clients record:", created.id);
  return { id: created.id, created: true };
}

// Resolve the Airtable Clients record for an account using the stored
// airtable_client_id first; fall back to by-name lookup if NULL or the
// stored id has been deleted in Airtable. Persists the resolved id back
// to accounts.airtable_client_id whenever we just learned (or relearned)
// the link.
async function resolveAndStoreCompanyRecordId(
  supabase: ReturnType<typeof createClient>,
  account: AccountProfile,
  baseId: string,
  clientsTableId: string,
  companyNameField: string,
  headers: Record<string, string>,
): Promise<string | null> {
  if (account.airtable_client_id) {
    const stillExists = await airtableRecordExists(
      baseId, clientsTableId, account.airtable_client_id, headers,
    );
    if (stillExists) return account.airtable_client_id;
    console.warn(
      "[airtable-sync-contact] Stored airtable_client_id no longer exists in Airtable; re-resolving:",
      account.airtable_client_id,
    );
  }

  if (!account.company_name) return null;

  const resolved = await searchOrCreateCompanyByName(
    baseId, clientsTableId, companyNameField, account.company_name, headers,
  );
  if (!resolved) return null;

  const { error: updErr } = await supabase
    .from("accounts")
    .update({ airtable_client_id: resolved.id } as Record<string, unknown>)
    .eq("id", account.id);
  if (updErr) {
    console.warn("[airtable-sync-contact] Failed to persist airtable_client_id:", updErr.message);
  } else {
    console.log("[airtable-sync-contact] Stored airtable_client_id on account", account.id, "→", resolved.id);
  }
  return resolved.id;
}

// Patch the Clients row with the portal-side company profile. Only
// fields whose config key is configured AND whose portal value is
// non-empty are sent. Field-level failures are logged but never break
// the user-sync flow.
async function patchClientProfileFields(
  baseId: string,
  clientsTableId: string,
  recordId: string,
  account: AccountProfile,
  cfg: ContactConfig,
  headers: Record<string, string>,
): Promise<void> {
  const fields: Record<string, unknown> = {};

  // Company name — always re-asserted in case it changed in the portal.
  if (cfg.field_company_name && account.company_name) {
    fields[cfg.field_company_name] = account.company_name;
  }

  if (cfg.field_client_address) {
    const composed = composeAddress(account);
    if (composed) fields[cfg.field_client_address] = composed;
  }
  if (cfg.field_client_registration_number && account.registration_number) {
    fields[cfg.field_client_registration_number] = account.registration_number;
  }
  if (cfg.field_client_country && account.country) {
    fields[cfg.field_client_country] = account.country;
  }

  if (Object.keys(fields).length === 0) return;

  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientsTableId)}/${recordId}`,
    { method: "PATCH", headers, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) {
    console.warn(
      "[airtable-sync-contact] Clients profile patch failed:",
      res.status,
      await res.text(),
    );
    return;
  }
  console.log("[airtable-sync-contact] Patched Clients profile fields:", Object.keys(fields).join(", "));
}

// Search Users table for an existing record by email; return record ID or null.
async function findUserByEmail(
  baseId: string,
  tableId: string,
  emailField: string,
  email: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const filter = encodeURIComponent(`{${emailField}} = "${email.replace(/"/g, '\\"')}"`);
  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableId)}?filterByFormula=${filter}&maxRecords=1`,
    { headers },
  );
  if (!res.ok) {
    console.warn("[airtable-sync-contact] Users email search failed:", await res.text());
    return null;
  }
  const data = await res.json() as { records: Array<{ id: string }> };
  return data.records?.[0]?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const airtableKey = Deno.env.get("AIRTABLE_API_KEY") || Deno.env.get("AIRTABLE_PAT");

  if (!airtableKey) {
    console.warn("[airtable-sync-contact] AIRTABLE_API_KEY not set — skipping");
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: ContactBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.email?.trim()) {
    return new Response(JSON.stringify({ error: "email is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: cfgRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "airtable_contact_field_config")
    .maybeSingle();

  const cfg = (cfgRow?.value ?? {}) as Partial<ContactConfig>;
  const missing = REQUIRED_KEYS.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    console.warn("[airtable-sync-contact] Config incomplete — skipping. Missing:", missing.join(", "));
    return new Response(JSON.stringify({ skipped: true, reason: "config_incomplete", missing }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const c = cfg as ContactConfig;
  const atHeaders: Record<string, string> = {
    Authorization: `Bearer ${airtableKey}`,
    "Content-Type": "application/json",
  };

  const email = body.email.trim().toLowerCase();

  // Load full account profile for company resolution + Clients patch.
  let account: AccountProfile | null = null;
  if (body.account_id) {
    const { data: accountRow } = await supabase
      .from("accounts")
      .select("id, company_name, account_type, airtable_client_id, building_number, street_name, city, country, postcode, registration_number")
      .eq("id", body.account_id)
      .maybeSingle();
    account = (accountRow as AccountProfile | null) ?? null;
  }
  const accountType = account?.account_type ?? null;

  // ── Step 1: Resolve company record in Clients table ───────────────────────
  // Prefer the stored airtable_client_id on accounts; fall back to a
  // by-name lookup and persist the resolved id for next time.
  let companyRecordId: string | null = null;
  if (account) {
    companyRecordId = await resolveAndStoreCompanyRecordId(
      supabase, account, c.base_id, c.clients_table_id, c.field_company_name, atHeaders,
    );
  } else {
    console.warn("[airtable-sync-contact] No account_id — skipping Clients table link");
  }

  // ── Step 1b: Patch Clients row with full portal company profile ──────────
  // Optional config keys (field_client_address, field_client_registration_number,
  // field_client_country) gate which Airtable columns are written. Field-level
  // failures don't break the user-sync flow.
  if (companyRecordId && account) {
    await patchClientProfileFields(
      c.base_id, c.clients_table_id, companyRecordId, account, c, atHeaders,
    );
  }

  // ── Step 2: Build Users record fields ────────────────────────────────────
  const typeOfClient = mapAccountType(accountType);
  const userFields: Record<string, unknown> = {
    [c.field_first_name]: body.first_name ?? "",
    [c.field_surname]: body.surname ?? "",
    [c.field_role]: "Client",
    [c.field_email]: email,
  };
  if (typeOfClient.length > 0) {
    userFields[c.field_type_of_client] = typeOfClient;
  }
  if (companyRecordId) {
    userFields[c.field_client_link] = [companyRecordId];
    userFields[c.field_company_link] = [companyRecordId];
  }

  // ── Step 3: Search Users table by email; PATCH or POST ───────────────────
  let userRecordId = await findUserByEmail(c.base_id, c.table_id, c.field_email, email, atHeaders);

  let userRes: Response;
  if (userRecordId) {
    // Update existing Users record
    userRes = await fetch(
      `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.table_id)}/${userRecordId}`,
      { method: "PATCH", headers: atHeaders, body: JSON.stringify({ fields: userFields }) },
    );
    console.log("[airtable-sync-contact] Updating existing Users record:", userRecordId);
  } else {
    // Create new Users record
    userRes = await fetch(
      `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.table_id)}`,
      { method: "POST", headers: atHeaders, body: JSON.stringify({ fields: userFields }) },
    );
    console.log("[airtable-sync-contact] Creating new Users record for:", email);
  }

  if (!userRes.ok) {
    const errText = await userRes.text();
    console.error("[airtable-sync-contact] Users upsert failed:", errText);
    return new Response(JSON.stringify({ error: errText }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userResult = await userRes.json() as { id: string };
  userRecordId = userResult.id;
  console.log("[airtable-sync-contact] Users record ID:", userRecordId);

  // ── Step 4: Set Client Representative on Clients record ──────────────────
  if (companyRecordId && userRecordId) {
    const repRes = await fetch(
      `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.clients_table_id)}/${companyRecordId}`,
      {
        method: "PATCH",
        headers: atHeaders,
        body: JSON.stringify({ fields: { [c.field_client_representative]: [userRecordId] } }),
      },
    );
    if (!repRes.ok) {
      console.warn("[airtable-sync-contact] Client Representative update failed:", await repRes.text());
    } else {
      console.log("[airtable-sync-contact] Set Client Representative on Clients record:", companyRecordId);
    }
  }

  return new Response(JSON.stringify({ success: true, user_id: userRecordId, company_id: companyRecordId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
