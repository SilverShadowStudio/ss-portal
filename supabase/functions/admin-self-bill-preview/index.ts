// admin-self-bill-files
//
// Admin utilities for already-issued self-billed invoices. It never generates a
// document and never issues an invoice number — previewing goes through the real
// generator (freelancer-self-bill-run with dry_run + return_pdf), so what you
// preview is exactly what production would produce.
//
//   list    → every issued invoice, with its current filename and the name the
//             current convention would give it, flagging any that differ.
//   rename  { invoice_id } → moves the filed PDF onto the current convention
//             (Freelancer_Invoice_YYYY-MM_First-Last.pdf) and updates
//             dropbox_path. Does NOT re-render, re-number, or re-email.
//
// Deploy: npx supabase functions deploy admin-self-bill-preview \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
/** The single source of truth for what a self-bill PDF is called. */
function invoiceFilename(year: number, month: number, payeeName: string): string {
  return `Freelancer_Invoice_${year}-${String(month).padStart(2, "0")}_${sanitize(payeeName)}.pdf`;
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

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = typeof body.action === "string" ? body.action : "list";

  if (action === "list") {
    const { data: rows } = await sb.from("self_bill_invoices")
      .select("id, invoice_number, payee_name, payee_email, period_year, period_month, source_table, gross, currency, dropbox_path")
      .order("period_year", { ascending: false }).order("period_month", { ascending: false });
    const items = (rows ?? []).map((r) => {
      const current = (r.dropbox_path as string | null)?.split("/").pop() ?? null;
      const expected = invoiceFilename(r.period_year as number, r.period_month as number, String(r.payee_name ?? ""));
      return {
        id: r.id, invoice_number: r.invoice_number, payee_name: r.payee_name,
        period_year: r.period_year, period_month: r.period_month,
        gross: r.gross, currency: r.currency,
        current_filename: current, expected_filename: expected,
        needs_rename: !!current && current !== expected,
      };
    });
    return json({ success: true, items });
  }

  if (action === "rename") {
    const id = typeof body.invoice_id === "string" ? body.invoice_id : "";
    if (!id) return json({ error: "invoice_id is required" }, 400);
    const { data: inv } = await sb.from("self_bill_invoices")
      .select("id, payee_name, period_year, period_month, dropbox_path").eq("id", id).maybeSingle();
    if (!inv?.dropbox_path) return json({ error: "That invoice has no filed PDF" }, 404);

    const from = inv.dropbox_path as string;
    const expected = invoiceFilename(inv.period_year as number, inv.period_month as number, String(inv.payee_name ?? ""));
    const to = `${from.substring(0, from.lastIndexOf("/"))}/${expected}`;
    if (from === to) return json({ success: true, unchanged: true, path: from });

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
    const mv = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
      },
      body: JSON.stringify({ from_path: from, to_path: to, autorename: false }),
    });
    if (!mv.ok) return json({ error: `Dropbox move failed: ${(await mv.text()).slice(0, 200)}` }, 200);
    await sb.from("self_bill_invoices").update({ dropbox_path: to }).eq("id", id);
    return json({ success: true, from, to });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
