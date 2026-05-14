import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ContactBody {
  first_name?: string;
  surname?: string;
  role?: string;
  type_of_client?: string;
  email?: string;
  account_id?: string;
}

interface ContactConfig {
  base_id: string;
  table_id: string;
  field_first_name: string;
  field_surname: string;
  field_role: string;
  field_type_of_client: string;
  field_email: string;
  // Optional — client table linking
  clients_table_id: string;
  field_company_name: string;
  field_client_link: string;
}

// Search Clients table for a matching company name; create one if not found.
// Returns the Airtable record ID to use as a linked-record value, or null on error.
async function resolveClientRecordId(
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
    console.log("[airtable-sync-contact] Found existing client record:", searchData.records[0].id);
    return searchData.records[0].id;
  }

  // Not found — create a new Clients record
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
  console.log("[airtable-sync-contact] Created new client record:", created.id);
  return created.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const airtableKey = Deno.env.get("AIRTABLE_API_KEY");

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

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: cfgRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "airtable_contact_field_config")
    .maybeSingle();

  const cfg = (cfgRow?.value ?? {}) as Partial<ContactConfig>;

  // Core fields required for any contact creation
  const coreKeys: (keyof ContactConfig)[] = [
    "base_id", "table_id", "field_first_name", "field_surname",
    "field_role", "field_type_of_client", "field_email",
  ];
  const emptyCore = coreKeys.filter((k) => !cfg[k]);
  if (emptyCore.length > 0) {
    console.warn("[airtable-sync-contact] Config incomplete — skipping. Empty:", emptyCore.join(", "));
    return new Response(JSON.stringify({ skipped: true, reason: "config_incomplete" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const c = cfg as ContactConfig;
  const atHeaders: Record<string, string> = {
    Authorization: `Bearer ${airtableKey}`,
    "Content-Type": "application/json",
  };

  // Build contact fields
  const fields: Record<string, unknown> = {
    [c.field_first_name]: body.first_name ?? "",
    [c.field_surname]: body.surname ?? "",
    [c.field_role]: body.role ?? "",
    [c.field_type_of_client]: body.type_of_client ?? "",
    [c.field_email]: body.email ?? "",
  };

  // Optional: resolve and link client record
  const linkConfigured = c.clients_table_id && c.field_company_name && c.field_client_link;
  if (linkConfigured && body.account_id) {
    const { data: account } = await supabase
      .from("accounts")
      .select("company_name")
      .eq("id", body.account_id)
      .maybeSingle();

    if (account?.company_name) {
      const clientRecordId = await resolveClientRecordId(
        c.base_id, c.clients_table_id, c.field_company_name, account.company_name, atHeaders,
      );
      if (clientRecordId) {
        fields[c.field_client_link] = [clientRecordId];
      }
    } else {
      console.warn("[airtable-sync-contact] No company_name found for account_id:", body.account_id);
    }
  } else if (!linkConfigured) {
    console.log("[airtable-sync-contact] Client link fields not configured — skipping link step");
  }

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.table_id)}`,
      {
        method: "POST",
        headers: atHeaders,
        body: JSON.stringify({ fields }),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("[airtable-sync-contact] Airtable POST failed:", errText);
      return new Response(JSON.stringify({ error: errText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await res.json() as { id: string };
    console.log("[airtable-sync-contact] Created contact record:", result.id);
    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[airtable-sync-contact]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
