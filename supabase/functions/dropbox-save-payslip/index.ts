// Edge function: dropbox-save-payslip
// Files a payslip PDF to Dropbox at:
//   /03_Portal_Admin_Docs/04_Payroll/{First-Last}/{First-Last}_Payslip_{YYYY-MM}.pdf
// and records dropbox_path on the payslip row. Admin-only. Non-fatal to callers.
//
// Body: { pdf_base64, mime?, employee_name, period_end (YYYY-MM-DD or -), payslip_id? }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PAYROLL_ROOT = "/03_Portal_Admin_Docs/04_Payroll";
function slug(s: string): string {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[/\\:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Employee";
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
  if (!r.ok) return null; return (await r.json())?.root_info?.root_namespace_id ?? null;
}
async function dropboxUpload(token: string, ns: string | null, path: string, bytes: Uint8Array): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", autorename: false, mute: true }),
      ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
    },
    body: bytes,
  });
  if (!r.ok) return { ok: false, error: `dropbox ${r.status}: ${await r.text()}` };
  return { ok: true, path: (await r.json()).path_display ?? path };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden" }, 403);

  let body: { pdf_base64?: string; mime?: string; employee_name?: string; period_end?: string; payslip_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.pdf_base64 || !body.employee_name) return json({ error: "pdf_base64 and employee_name required" }, 400);

  const bytes = Uint8Array.from(atob(body.pdf_base64), (c) => c.charCodeAt(0));
  const ym = (body.period_end ?? "").match(/^(\d{4})-(\d{2})/);
  const ymLabel = ym ? `${ym[1]}-${ym[2]}` : "undated";
  const nameSlug = slug(body.employee_name);
  const filename = `${nameSlug}_Payslip_${ymLabel}.pdf`;
  const target = `${PAYROLL_ROOT}/${nameSlug}/${filename}`;

  const { data: conn } = await admin.from("dropbox_connections").select("id, access_token, refresh_token, token_expires_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return json({ error: "no dropbox connection" }, 500);
  let token = conn.access_token as string;
  if (conn.token_expires_at && new Date(conn.token_expires_at as string).getTime() < Date.now()) token = (await refreshToken(conn as Record<string, string>, admin)) ?? "";
  if (!token) return json({ error: "dropbox token unavailable" }, 500);
  const ns = await rootNamespace(token);

  const up = await dropboxUpload(token, ns, target, bytes);
  if (!up.ok) return json({ error: up.error }, 502);
  if (body.payslip_id) await admin.from("payslips").update({ dropbox_path: up.path }).eq("id", body.payslip_id).then(() => {}, () => {});
  return json({ success: true, dropbox_path: up.path });
});
