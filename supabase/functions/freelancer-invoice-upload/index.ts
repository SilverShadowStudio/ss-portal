// freelancer-invoice-upload
//
// Files a historical freelancer invoice — one from a period before the portal
// started raising self-bills — so a month that shows "—" can be completed.
//
// The PDF goes to the same Dropbox folder and filename convention as a
// generated invoice, and a self_bill_invoices row is written with
// origin='uploaded' so it's always clear which the portal raised itself.
//
// Body: { payee_email, period_year, period_month, source_table?, pdf_base64, filename? }
// Admin only. Never overwrites an existing invoice for that period.
//
// Deploy: npx supabase functions deploy freelancer-invoice-upload \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DROPBOX_ROOT = "/03_Portal_Admin_Docs/03_Invoices/INV002_Payable/01_Freelancers";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ROLE_LABEL: Record<string, string> = {
  modeller_invoices: "3D modelling",
  scene_manager_invoice: "Scene management",
  photographer_invoice: "Photography",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function sanitize(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[/\\:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "supplier";
}
function teamCode(first: string, last: string): string {
  return ((first || "").replace(/[^A-Za-z]/g, "").slice(0, 1) + (last || "").replace(/[^A-Za-z]/g, "").slice(0, 4)).toUpperCase();
}

async function refreshToken(conn: Record<string, string>, sb: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${Deno.env.get("DROPBOX_APP_KEY")}:${Deno.env.get("DROPBOX_APP_SECRET")}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await sb.from("dropbox_connections").update({ access_token: data.access_token, token_expires_at: expiresAt }).eq("id", conn.id);
    return data.access_token;
  } catch { return null; }
}
async function rootNamespace(token: string): Promise<string | null> {
  const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return (await r.json())?.root_info?.root_namespace_id ?? null;
}

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

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const email = (typeof b.payee_email === "string" ? b.payee_email : "").trim().toLowerCase();
  const year = Number(b.period_year), month = Number(b.period_month);
  const source = typeof b.source_table === "string" && b.source_table ? b.source_table : "scene_manager_invoice";
  const pdfB64 = typeof b.pdf_base64 === "string" ? b.pdf_base64 : "";
  if (!email || !year || !month || !pdfB64) return json({ error: "payee_email, period_year, period_month and pdf_base64 are required" }, 400);
  if (month < 1 || month > 12) return json({ error: "period_month must be 1-12" }, 400);

  // Never silently replace an invoice that already exists for that period.
  const { data: existing } = await sb.from("self_bill_invoices")
    .select("id, invoice_number, origin")
    .eq("source_table", source).eq("period_year", year).eq("period_month", month)
    .ilike("payee_email", email).maybeSingle();
  if (existing) {
    return json({ error: `An invoice already exists for that month (${existing.invoice_number}). Remove it first if you meant to replace it.` }, 200);
  }

  // The freelancer, for the filename, code and the recorded name.
  const { data: prof } = await sb.from("freelancer_profiles")
    .select("user_id, first_name, last_name, rate_currency").ilike("email", email).maybeSingle();
  const { data: snap } = await sb.from("payables_snapshot")
    .select("payee_name, invoice_total, vat_registered")
    .eq("source_table", source).eq("period_year", year).eq("period_month", month)
    .ilike("payee_email", email).maybeSingle();

  const payeeName = (prof ? `${prof.first_name}-${prof.last_name}` : (snap?.payee_name as string | null)) || email;
  const [first, ...rest] = String(payeeName).split("-");
  const code = teamCode(first, rest.join("-"));
  const gross = Number(snap?.invoice_total ?? 0);

  // Same folder + filename convention as a generated invoice.
  const folder = `${DROPBOX_ROOT}/Freelancers_${year}-${String(month).padStart(2, "0")}_${MONTHS[month - 1]}`;
  const filename = `Freelancer_Invoice_${year}-${String(month).padStart(2, "0")}_${sanitize(payeeName)}.pdf`;

  const { data: conn } = await sb.from("dropbox_connections")
    .select("id, access_token, refresh_token, token_expires_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return json({ error: "Dropbox is not connected" }, 500);
  let token = conn.access_token as string;
  const expired = conn.token_expires_at ? new Date(conn.token_expires_at as string).getTime() < Date.now() + 60_000 : true;
  if (expired) {
    const fresh = await refreshToken(conn as Record<string, string>, sb);
    if (!fresh) return json({ error: "Dropbox token refresh failed" }, 500);
    token = fresh;
  }
  const ns = await rootNamespace(token);

  const bytes = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0));
  const up = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path: `${folder}/${filename}`, mode: "overwrite", autorename: false, mute: true }),
      ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
    },
    body: bytes,
  });
  if (!up.ok) return json({ error: `Dropbox upload failed: ${(await up.text()).slice(0, 200)}` }, 200);
  const uploaded = await up.json();

  const { data: row, error: insErr } = await sb.from("self_bill_invoices").insert({
    source_table: source,
    airtable_record_id: `uploaded-${year}-${String(month).padStart(2, "0")}-${code}`,
    payee_email: email,
    payee_name: payeeName,
    freelancer_user_id: prof?.user_id ?? null,
    period_year: year, period_month: month,
    invoice_number: `FRL-${code}-${year}-${String(month).padStart(2, "0")}`,
    role_label: ROLE_LABEL[source] ?? "Work",
    net: gross, vat_amount: 0, gross,
    currency: (prof?.rate_currency as string) || "GBP",
    line_count: 0,
    dropbox_path: uploaded?.path_display ?? `${folder}/${filename}`,
    origin: "uploaded",
  }).select("id, invoice_number").single();
  if (insErr) return json({ error: `Filed to Dropbox but not recorded: ${insErr.message}` }, 200);

  return json({ success: true, invoice_id: row.id, invoice_number: row.invoice_number, filename });
});
