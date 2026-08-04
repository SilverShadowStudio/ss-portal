// admin-check-airtable-user
//
// Does this email exist in the Airtable Users table?
//
// A freelancer's worked days and earnings are matched to Airtable ON EMAIL. If
// the address we invite them with differs from the one in Airtable, their
// calendar and Earnings page stay silently empty — no error, just nothing. This
// lets the Add Member dialog catch that while it's still one keystroke to fix.
//
// Body: { email }  →  { found, name?, role?, airtable_email? }
// Read-only on Airtable. Admin only.
//
// Deploy: npx supabase functions deploy admin-check-airtable-user \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const USERS_TABLE = "tbl8V5Hd20UN9Jax6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await uc.auth.getUser();
  if (!u?.user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email) return json({ error: "email is required" }, 400);

  const pat = Deno.env.get("AIRTABLE_PAT");
  const base = Deno.env.get("AIRTABLE_BASE_ID");
  // Not configured is not a failure — just don't claim anything either way.
  if (!pat || !base) return json({ checked: false });

  const formula = `LOWER({Email})="${email.replace(/"/g, '\\"')}"`;
  const url = `https://api.airtable.com/v0/${base}/${USERS_TABLE}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) return json({ checked: false });   // never block the invite on a lookup hiccup

  const data = await r.json().catch(() => ({}));
  const rec = (data?.records ?? [])[0];
  if (!rec) return json({ checked: true, found: false });

  const f = rec.fields ?? {};
  return json({
    checked: true,
    found: true,
    name: f["Full Name"] ?? f["Name"] ?? null,
    role: f["Role"] ?? null,
    airtable_email: f["Email"] ?? null,
  });
});
