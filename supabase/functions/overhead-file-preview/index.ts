// overhead-file-preview/index.ts
//
// Returns a small thumbnail (base64 data URI) + a full-size URL for the
// invoice file attached to an overhead row. Admin-only.
//
//   - Filed (dropbox_path set): thumbnail from Dropbox get_thumbnail_v2
//     (works for PDF + images), full_url from Dropbox get_temporary_link.
//   - Staged (staging_storage_path only): no thumbnail (avoid duplicating
//     Dropbox's rendering pipeline against Storage), full_url is a
//     Supabase Storage signed URL. Frontend shows a text placeholder.
//   - Neither: { available: false }.
//
// Deploy: npx supabase functions deploy overhead-file-preview \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STAGING_BUCKET = "overhead-invoices";
const THUMBNAIL_SIZE = "w480h320";
const TEMP_LINK_EXPIRY_HINT = 4 * 60 * 60; // Dropbox's fixed 4h (documentation-only)
const STORAGE_URL_EXPIRY   = 60 * 60;      // 1 hour

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf")  return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png")  return "image/png";
  return "application/octet-stream";
}

// ── Dropbox helpers (mirror dropbox-save-overhead-file) ─────────────────────

async function refreshToken(
  connection: Record<string, string>,
  sb: ReturnType<typeof createClient>,
): Promise<string | null> {
  const appKey    = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
    await sb.from("dropbox_connections")
      .update({ access_token: data.access_token, token_expires_at: expiresAt })
      .eq("id", connection.id);
    return data.access_token;
  } catch {
    return null;
  }
}

async function getRootNamespaceId(accessToken: string): Promise<string | null> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/users/get_current_account",
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.root_info?.root_namespace_id ?? null;
}

function pathRootHeader(namespaceId: string | null): Record<string, string> {
  return namespaceId
    ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: namespaceId }) }
    : {};
}

async function dropboxTemporaryLink(
  accessToken: string,
  namespaceId: string | null,
  path: string,
): Promise<string | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: {
      Authorization:   `Bearer ${accessToken}`,
      "Content-Type":  "application/json",
      ...pathRootHeader(namespaceId),
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    console.warn(`[overhead-file-preview] get_temporary_link ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  return typeof data.link === "string" ? data.link : null;
}

/** Returns the thumbnail as `data:image/jpeg;base64,...` or null on any error. */
async function dropboxThumbnailDataUri(
  accessToken: string,
  namespaceId: string | null,
  path: string,
): Promise<string | null> {
  const apiArg = JSON.stringify({
    resource: { ".tag": "path", path },
    format:   "jpeg",
    size:     THUMBNAIL_SIZE,
    mode:     "strict",
  });
  const res = await fetch("https://content.dropboxapi.com/2/files/get_thumbnail_v2", {
    method: "POST",
    headers: {
      Authorization:     `Bearer ${accessToken}`,
      "Dropbox-API-Arg": apiArg,
      ...pathRootHeader(namespaceId),
    },
  });
  if (!res.ok) {
    console.warn(`[overhead-file-preview] get_thumbnail_v2 ${res.status}: ${await res.text()}`);
    return null;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  // base64 encode without spawning huge intermediate strings
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const b64 = btoa(binary);
  return `data:image/jpeg;base64,${b64}`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // Admin JWT gate
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: roleRow } = await sb.from("user_roles")
    .select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ success: false, error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const overheadId = body.overhead_id as string | undefined;
  if (!overheadId) return json({ success: false, error: "overhead_id required" }, 400);

  const { data: row, error: fetchErr } = await sb.from("overheads")
    .select("id, dropbox_path, staging_storage_path")
    .eq("id", overheadId)
    .maybeSingle();
  if (fetchErr || !row) return json({ success: false, error: "overhead not found" }, 404);

  // 1) Filed — Dropbox path present
  if (row.dropbox_path) {
    const { data: conn } = await sb.from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) return json({ available: false, error: "no dropbox_connections row" });

    let accessToken = conn.access_token as string;
    const expired = conn.token_expires_at && new Date(conn.token_expires_at as string).getTime() < Date.now();
    if (expired) {
      const refreshed = await refreshToken(conn as Record<string, string>, sb);
      if (!refreshed) return json({ available: false, error: "dropbox token refresh failed" });
      accessToken = refreshed;
    }
    const namespaceId = await getRootNamespaceId(accessToken);

    const [thumbnailDataUri, fullUrl] = await Promise.all([
      dropboxThumbnailDataUri(accessToken, namespaceId, row.dropbox_path),
      dropboxTemporaryLink(accessToken, namespaceId, row.dropbox_path),
    ]);

    return json({
      available:          true,
      source:             "dropbox",
      mime_type:          mimeFromPath(row.dropbox_path),
      thumbnail_data_uri: thumbnailDataUri,
      full_url:           fullUrl,
      expires_hint_s:     TEMP_LINK_EXPIRY_HINT,
    });
  }

  // 2) Staged — not yet filed
  if (row.staging_storage_path) {
    const { data: signed, error: signErr } = await sb.storage
      .from(STAGING_BUCKET)
      .createSignedUrl(row.staging_storage_path, STORAGE_URL_EXPIRY);
    if (signErr || !signed) {
      return json({ available: false, error: `storage signed url failed: ${signErr?.message}` });
    }
    return json({
      available:          true,
      source:             "staging",
      mime_type:          mimeFromPath(row.staging_storage_path),
      thumbnail_data_uri: null,
      full_url:           signed.signedUrl,
      expires_hint_s:     STORAGE_URL_EXPIRY,
    });
  }

  // 3) No file at all (rows created before Pass 2, or old manual entries)
  return json({ available: false });
});
