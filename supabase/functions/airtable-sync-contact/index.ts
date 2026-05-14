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

  const configKeys: (keyof ContactConfig)[] = [
    "base_id", "table_id", "field_first_name", "field_surname",
    "field_role", "field_type_of_client", "field_email",
  ];
  const emptyKeys = configKeys.filter((k) => !cfg[k]);
  if (emptyKeys.length > 0) {
    console.warn("[airtable-sync-contact] Config incomplete — skipping. Empty fields:", emptyKeys.join(", "));
    return new Response(JSON.stringify({ skipped: true, reason: "config_incomplete" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const c = cfg as ContactConfig;
  const fields: Record<string, string> = {
    [c.field_first_name]: body.first_name ?? "",
    [c.field_surname]: body.surname ?? "",
    [c.field_role]: body.role ?? "",
    [c.field_type_of_client]: body.type_of_client ?? "",
    [c.field_email]: body.email ?? "",
  };

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(c.table_id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${airtableKey}`,
          "Content-Type": "application/json",
        },
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
    console.log("[airtable-sync-contact] Created record:", result.id);
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
