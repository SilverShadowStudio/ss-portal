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

// Search Clients table for a matching company name; create one if not found.
async function resolveCompanyRecordId(
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
    console.warn("[airtable-sync-contact] Clients search failed:", await searchRes.text());
    return null;
  }
  const searchData = await searchRes.json() as { records: Array<{ id: string }> };
  if (searchData.records?.length > 0) {
    console.log("[airtable-sync-contact] Found existing Clients record:", searchData.records[0].id);
    return searchData.records[0].id;
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
  return created.id;
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

  // Load account for company_name and account_type
  let companyName: string | null = null;
  let accountType: string | null = null;
  if (body.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("company_name, account_type")
      .eq("id", body.account_id)
      .maybeSingle();
    companyName = account?.company_name ?? null;
    accountType = (account as Record<string, unknown> | null)?.account_type as string | null ?? null;
  }

  // ── Step 1: Resolve company record in Clients table ───────────────────────
  let companyRecordId: string | null = null;
  if (companyName) {
    companyRecordId = await resolveCompanyRecordId(
      c.base_id, c.clients_table_id, c.field_company_name, companyName, atHeaders,
    );
  } else {
    console.warn("[airtable-sync-contact] No company_name — skipping Clients table link");
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
