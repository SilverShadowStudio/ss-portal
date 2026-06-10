// import-legacy-rounds
//
// Imports historical VS_Visuals rounds from a linked Dropbox scene folder as
// read-only delivered history on scene_rounds (is_legacy = true, status = approved).
//
// Called fire-and-forget from handleLinkSceneDropbox after a scene is linked.
// Safe to call multiple times — idempotent per (scene_id, round_number, is_legacy).
//
// Takes: { scene_id }
// Returns: { rounds_created, assets_created }
//
// File filter: /_R(\d+)_(\d+)\.(jpg|jpeg|png|tiff|tif)$/i
// No -VS gate — parseFilename + image extension list is sufficient.
// Trust folder location over filename prefix for mismatched scene codes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseFilename(filename: string): { round: number; version: number } | null {
  const match = filename.match(/_R(\d+)_(\d+)\.(jpg|jpeg|png|tiff|tif)$/i);
  if (!match) return null;
  return { round: parseInt(match[1], 10), version: parseInt(match[2], 10) };
}

async function refreshToken(connection: Record<string, unknown>, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const appKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token as string }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await supabase.from("dropbox_connections").update({
      access_token: data.access_token,
      token_expires_at: expiresAt,
    }).eq("id", connection.id as string);
    return data.access_token as string;
  } catch { return null; }
}

function dbxHeaders(token: string, namespaceId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (namespaceId) {
    h["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "namespace_id", "namespace_id": namespaceId });
  }
  return h;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authedClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").single();
    if (!roleRow) return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body = await req.json();
    const sceneId = ((body.scene_id as string) ?? "").trim();
    if (!sceneId) return new Response(JSON.stringify({ error: "scene_id is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: scene, error: sceneErr } = await supabase
      .from("scenes")
      .select("id, name, dropbox_folder, project_id")
      .eq("id", sceneId)
      .single();

    if (sceneErr || !scene) return new Response(JSON.stringify({ error: "Scene not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const sceneDropboxFolder = (scene as Record<string, unknown>).dropbox_folder as string | null;
    if (!sceneDropboxFolder) {
      return new Response(JSON.stringify({ rounds_created: 0, assets_created: 0, skipped: "no_dropbox_folder" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vsPath = `${sceneDropboxFolder}/VS_Visuals`;

    // Dropbox connection + token refresh
    const { data: connection } = await supabase
      .from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .limit(1)
      .maybeSingle();

    if (!connection) return new Response(JSON.stringify({ error: "Dropbox not connected" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    let accessToken = (connection as Record<string, unknown>).access_token as string;
    const expiresAt = (connection as Record<string, unknown>).token_expires_at as string | null;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      const refreshed = await refreshToken(connection as Record<string, unknown>, supabase);
      if (!refreshed) return new Response(JSON.stringify({ error: "Failed to refresh Dropbox token" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      accessToken = refreshed;
    }

    // Detect team namespace
    const accountRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const accountData = accountRes.ok ? await accountRes.json() : null;
    const namespaceId: string | null = accountData?.root_info?.root_namespace_id ?? null;

    // List VS_Visuals
    const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: dbxHeaders(accessToken, namespaceId),
      body: JSON.stringify({ path: vsPath, recursive: false }),
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      if (errText.includes("not_found") || errText.includes("path/not_found")) {
        return new Response(JSON.stringify({ rounds_created: 0, assets_created: 0, skipped: "vs_visuals_not_found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn("[import-legacy-rounds] list_folder failed:", errText);
      return new Response(JSON.stringify({ error: "Dropbox list failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listData = await listRes.json() as { entries: Array<Record<string, unknown>> };

    interface ParsedFile {
      round: number;
      version: number;
      filename: string;
      path: string;
      size: number | null;
      mtime: string | null;
    }

    const files: ParsedFile[] = [];
    for (const entry of listData.entries) {
      if (entry[".tag"] !== "file") continue;
      const parsed = parseFilename(entry.name as string);
      if (!parsed) continue;
      files.push({
        round: parsed.round,
        version: parsed.version,
        filename: entry.name as string,
        path: entry.path_lower as string,
        size: (entry.size as number | null) ?? null,
        mtime: ((entry.server_modified || entry.client_modified) as string | null) ?? null,
      });
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({ rounds_created: 0, assets_created: 0, skipped: "no_matching_files" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const byRound = new Map<number, ParsedFile[]>();
    for (const f of files) {
      const arr = byRound.get(f.round) ?? [];
      arr.push(f);
      byRound.set(f.round, arr);
    }

    let roundsCreated = 0;
    let assetsCreated = 0;

    for (const [roundNum, roundFiles] of Array.from(byRound.entries()).sort(([a], [b]) => a - b)) {
      // Idempotency — check by (scene_id, round_number, is_legacy=true)
      const { data: existing } = await supabase
        .from("scene_rounds")
        .select("id")
        .eq("scene_id", sceneId)
        .eq("round_number", roundNum)
        .eq("is_legacy", true)
        .maybeSingle();

      let roundId: string;

      if (existing) {
        roundId = (existing as Record<string, unknown>).id as string;
        // Back-fill any assets that weren't present on a previous import run
        const { data: existingAssets } = await supabase
          .from("round_assets")
          .select("dropbox_path")
          .eq("scene_round_id", roundId);
        const seen = new Set((existingAssets ?? []).map((a: Record<string, unknown>) => a.dropbox_path as string));
        for (const f of roundFiles) {
          if (seen.has(f.path)) continue;
          const { error: ae } = await supabase.from("round_assets").insert({
            scene_round_id: roundId,
            dropbox_path: f.path,
            dropbox_file_id: f.path,
            filename: f.filename,
            file_size: f.size,
            version: f.version,
            is_current: true,
            source: "dropbox",
          });
          if (!ae) assetsCreated++;
        }
        continue;
      }

      // Earliest mtime across all files in this round → delivered_at / approved_at
      const mtimes = roundFiles
        .map((f) => f.mtime)
        .filter((t): t is string => !!t)
        .map((t) => new Date(t).getTime());
      const deliveredAt = mtimes.length > 0
        ? new Date(Math.min(...mtimes)).toISOString()
        : new Date().toISOString();

      const { data: newRound, error: re } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: sceneId,
          round_number: roundNum,
          kind: "production",
          status: "approved",
          is_legacy: true,
          legacy_source_path: vsPath,
          delivered_at: deliveredAt,
          approved_at: deliveredAt,
        })
        .select("id")
        .single();

      if (re || !newRound) {
        console.error("[import-legacy-rounds] round insert failed (round", roundNum, "):", re?.message);
        continue;
      }
      roundId = (newRound as Record<string, unknown>).id as string;
      roundsCreated++;

      for (const f of roundFiles) {
        const { error: ae } = await supabase.from("round_assets").insert({
          scene_round_id: roundId,
          dropbox_path: f.path,
          dropbox_file_id: f.path,
          filename: f.filename,
          file_size: f.size,
          version: f.version,
          is_current: true,
          source: "dropbox",
        });
        if (!ae) assetsCreated++;
      }
    }

    return new Response(
      JSON.stringify({ rounds_created: roundsCreated, assets_created: assetsCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[import-legacy-rounds]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
