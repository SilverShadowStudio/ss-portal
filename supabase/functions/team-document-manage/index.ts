// Edge function: team-document-manage
// Admin-gated management of an uploaded team-member document (a team_contracts
// row with a stored file). Keeps Supabase + Dropbox in lockstep:
//   • rename  → new title; renames the Dropbox file (files/move_v2); updates dropbox_path
//   • delete  → removes the Dropbox file (delete_v2), the Supabase object, and the row
//   • replace → overwrites the stored file in Supabase AND Dropbox (keeps title/paths)
//
// Body (JSON): { contract_id, action: 'rename'|'delete'|'replace',
//                new_title?, file_base64?, file_mime? }

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "freelancer-documents";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function sanitize(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[/\\:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "Document";
}

// ── Dropbox helpers (mirror the filing functions) ────────────────────────────
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
function pathRootHeader(ns: string | null): Record<string, string> {
  return ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {};
}
async function getDropbox(admin: ReturnType<typeof createClient>): Promise<{ token: string; ns: string | null } | null> {
  const { data: conn } = await admin.from("dropbox_connections").select("id, access_token, refresh_token, token_expires_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return null;
  let token = conn.access_token as string;
  if (conn.token_expires_at && new Date(conn.token_expires_at as string).getTime() < Date.now()) token = (await refreshToken(conn as Record<string, string>, admin)) ?? "";
  if (!token) return null;
  return { token, ns: await rootNamespace(token) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  // Admin gate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  let body: { contract_id?: string; action?: string; new_title?: string; file_base64?: string; file_mime?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { contract_id, action } = body;
  if (!contract_id || !action) return json({ error: "contract_id and action are required" }, 400);

  const { data: doc } = await admin.from("team_contracts").select("id, subject_line, storage_path, dropbox_path").eq("id", contract_id).maybeSingle();
  if (!doc) return json({ error: "Document not found" }, 404);
  const storagePath = doc.storage_path as string | null;
  const dropboxPath = doc.dropbox_path as string | null;

  // ── RENAME ──────────────────────────────────────────────────────────────────
  if (action === "rename") {
    const title = (body.new_title || "").trim();
    if (!title) return json({ error: "new_title is required" }, 400);
    let newDropboxPath = dropboxPath;
    if (dropboxPath) {
      const dir = dropboxPath.slice(0, dropboxPath.lastIndexOf("/"));
      const dot = dropboxPath.lastIndexOf(".");
      const ext = dot > dropboxPath.lastIndexOf("/") ? dropboxPath.slice(dot) : ".pdf";
      const candidate = `${dir}/${sanitize(title)}${ext}`;
      if (candidate !== dropboxPath) {
        const dbx = await getDropbox(admin);
        if (dbx) {
          const r = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
            method: "POST",
            headers: { Authorization: `Bearer ${dbx.token}`, "Content-Type": "application/json", ...pathRootHeader(dbx.ns) },
            body: JSON.stringify({ from_path: dropboxPath, to_path: candidate, autorename: true }),
          });
          if (r.ok) newDropboxPath = (await r.json())?.metadata?.path_display ?? candidate;
          else console.error("[team-document-manage] dropbox move failed:", await r.text());
        }
      }
    }
    const { error } = await admin.from("team_contracts").update({ subject_line: title, dropbox_path: newDropboxPath, updated_at: new Date().toISOString() }).eq("id", contract_id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, dropbox_path: newDropboxPath });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (action === "delete") {
    if (dropboxPath) {
      const dbx = await getDropbox(admin);
      if (dbx) {
        const r = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${dbx.token}`, "Content-Type": "application/json", ...pathRootHeader(dbx.ns) },
          body: JSON.stringify({ path: dropboxPath }),
        });
        if (!r.ok) console.error("[team-document-manage] dropbox delete failed:", await r.text());
      }
    }
    if (storagePath) await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    const { error } = await admin.from("team_contracts").delete().eq("id", contract_id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  // ── REPLACE ─────────────────────────────────────────────────────────────────
  if (action === "replace") {
    if (!body.file_base64) return json({ error: "file_base64 is required for replace" }, 400);
    const bytes = Uint8Array.from(atob(body.file_base64), (c) => c.charCodeAt(0));
    const mime = body.file_mime || "application/pdf";
    if (storagePath) {
      const { error: upErr } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType: mime, upsert: true });
      if (upErr) return json({ error: `Storage: ${upErr.message}` }, 500);
    }
    if (dropboxPath) {
      const dbx = await getDropbox(admin);
      if (dbx) {
        const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dbx.token}`, "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath, mode: "overwrite", autorename: false, mute: true }),
            ...pathRootHeader(dbx.ns),
          },
          body: bytes,
        });
        if (!r.ok) console.error("[team-document-manage] dropbox overwrite failed:", await r.text());
      }
    }
    await admin.from("team_contracts").update({ updated_at: new Date().toISOString() }).eq("id", contract_id);
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, 400);
});
