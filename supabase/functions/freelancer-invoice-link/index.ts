// freelancer-invoice-link
//
// Returns a short-lived Dropbox link to a self-billed invoice PDF.
//
// Ownership: a freelancer may only open an invoice raised in THEIR name — the
// row is matched on the caller's authenticated email, never on an id passed in.
// Admins may open anyone's.
//
// Body: { invoice_id }  →  { url, filename }
//
// Deploy: npx supabase functions deploy freelancer-invoice-link \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function refreshToken(connection: Record<string, string>, sb: ReturnType<typeof createClient>): Promise<string | null> {
  const appKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await sb.from("dropbox_connections").update({ access_token: data.access_token, token_expires_at: expiresAt }).eq("id", connection.id);
    return data.access_token;
  } catch { return null; }
}

async function rootNamespace(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.root_info?.root_namespace_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await uc.auth.getUser();
  if (!u?.user?.email) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: adminRole } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
  if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

  // Scope by the caller's own email unless they're an admin — an id alone is
  // never enough to open someone else's invoice.
  let q = sb.from("self_bill_invoices").select("id, invoice_number, dropbox_path, payee_email").eq("id", invoiceId);
  if (!adminRole) q = q.ilike("payee_email", u.user.email);
  const { data: inv } = await q.maybeSingle();
  if (!inv) return json({ error: "Invoice not found" }, 404);
  if (!inv.dropbox_path) return json({ error: "That invoice hasn't been filed yet" }, 404);

  const { data: conn } = await sb.from("dropbox_connections")
    .select("id, access_token, refresh_token, token_expires_at")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return json({ error: "Dropbox is not connected" }, 500);

  let token = conn.access_token as string;
  const expired = conn.token_expires_at ? new Date(conn.token_expires_at as string).getTime() < Date.now() + 60_000 : true;
  if (expired) {
    const fresh = await refreshToken(conn as Record<string, string>, sb);
    if (!fresh) return json({ error: "Dropbox token refresh failed" }, 500);
    token = fresh;
  }

  const ns = await rootNamespace(token);
  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
    },
    body: JSON.stringify({ path: inv.dropbox_path }),
  });
  if (!res.ok) return json({ error: `Couldn't open the invoice (Dropbox ${res.status})` }, 200);
  const data = await res.json();
  if (typeof data.link !== "string") return json({ error: "Couldn't open the invoice" }, 200);

  const filename = `${inv.invoice_number ?? "invoice"}.pdf`;
  return json({ url: data.link, filename });
});
