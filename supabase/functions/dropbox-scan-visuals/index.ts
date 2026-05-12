// dropbox-scan-visuals/index.ts
//
// Scans the VS_Visuals folder for a scene and returns the highest version
// per round. project_code and scene_code (e.g. CP107, SC05) are stored in
// the DB. The function searches Dropbox for any folder beginning with
// CP107_ inside /00_Production/PRD01_Client-Projects/, then inside that
// for any folder beginning with SC05_, and uses whatever it finds.
//
// File naming convention: CP107-SC05-VS_R01_01.jpg
//   R01 = round number  |  01 = version within round
//
// Returns: array of { round, version, filename, path, modified_at, link }
// One entry per round — the highest version only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DROPBOX_ROOT = "/00_Production/PRD01_Client-Projects";

interface VisualFile {
  round: number;
  version: number;
  filename: string;
  path: string;
  modified_at: string;
  size: number;
}

function parseFilename(filename: string): { round: number; version: number } | null {
  const match = filename.match(/_R(\d+)_(\d+)\.(jpg|jpeg|png|tiff|tif)$/i);
  if (!match) return null;
  return {
    round: parseInt(match[1], 10),
    version: parseInt(match[2], 10),
  };
}

async function refreshToken(connection: any, supabase: any): Promise<string | null> {
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
    await supabase.from("dropbox_connections").update({
      access_token: data.access_token,
      token_expires_at: expiresAt,
    }).eq("id", connection.id);
    return data.access_token;
  } catch { return null; }
}

// List immediate children of a Dropbox folder. Returns null on error.
async function listFolder(accessToken: string, path: string): Promise<any[] | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.entries || [];
}

// Find the first folder inside `parentPath` whose name starts with `prefix_`.
async function findFolderByCode(
  accessToken: string,
  parentPath: string,
  code: string,
): Promise<string | null> {
  const entries = await listFolder(accessToken, parentPath);
  if (!entries) return null;
  const prefix = code.toUpperCase() + "_";
  const match = entries.find(
    (e: any) => e[".tag"] === "folder" && e.name.toUpperCase().startsWith(prefix),
  );
  return match ? match.path_display : null;
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
    const body = await req.json().catch(() => ({}));
    const { sceneId, action = "scan" } = body;

    if (!sceneId) return new Response(JSON.stringify({ error: "sceneId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Get scene + project codes
    const { data: scene, error: sceneErr } = await supabase
      .from("scenes")
      .select("id, name, scene_code, project_id, projects(id, name, project_code)")
      .eq("id", sceneId)
      .single();

    if (sceneErr || !scene) return new Response(JSON.stringify({ error: "Scene not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const project = scene.projects as any;

    if (!project?.project_code || !scene.scene_code) {
      return new Response(JSON.stringify({
        error: "Project code and scene code not set. Please configure them in the admin panel.",
        missingCodes: true,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const projectCode: string = project.project_code;
    const sceneCode: string = scene.scene_code;

    // Get Dropbox connection (needed for folder search and scan)
    const { data: connection } = await supabase
      .from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .limit(1)
      .maybeSingle();

    if (!connection) return new Response(JSON.stringify({ error: "Dropbox not connected" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    let accessToken = connection.access_token;
    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
      accessToken = await refreshToken(connection, supabase);
      if (!accessToken) return new Response(JSON.stringify({ error: "Failed to refresh Dropbox token" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve project folder by searching for a folder beginning with `{projectCode}_`
    const projectFolderPath = await findFolderByCode(accessToken, DROPBOX_ROOT, projectCode);
    if (!projectFolderPath) {
      return new Response(JSON.stringify({
        error: `No folder starting with "${projectCode}_" found in ${DROPBOX_ROOT}`,
        folderExists: false,
        rounds: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve scene folder inside the project folder
    const sceneFolderPath = await findFolderByCode(accessToken, projectFolderPath, sceneCode);
    if (!sceneFolderPath) {
      return new Response(JSON.stringify({
        error: `No folder starting with "${sceneCode}_" found inside ${projectFolderPath}`,
        folderExists: false,
        rounds: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const folderPath = `${sceneFolderPath}/VS_Visuals`;

    if (action === "get-path") {
      return new Response(JSON.stringify({ path: folderPath }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List VS_Visuals folder
    const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: folderPath, recursive: false }),
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      if (err.includes("not_found") || err.includes("path/not_found")) {
        return new Response(JSON.stringify({ rounds: [], folderPath, folderExists: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Dropbox list failed: ${err}`);
    }

    const listData = await listRes.json();
    const allFiles: VisualFile[] = [];

    for (const entry of listData.entries || []) {
      if (entry[".tag"] !== "file") continue;
      const ext = entry.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png", "tiff", "tif"].includes(ext || "")) continue;

      const parsed = parseFilename(entry.name);
      if (!parsed) continue;

      if (!entry.name.includes("-VS_")) continue;

      allFiles.push({
        round: parsed.round,
        version: parsed.version,
        filename: entry.name,
        path: entry.path_lower,
        modified_at: entry.server_modified || entry.client_modified,
        size: entry.size,
      });
    }

    // Group by round, keep highest version per round
    const byRound = new Map<number, VisualFile>();
    for (const file of allFiles) {
      const existing = byRound.get(file.round);
      if (!existing || file.version > existing.version) {
        byRound.set(file.round, file);
      }
    }

    const rounds = Array.from(byRound.values()).sort((a, b) => a.round - b.round);

    // Generate temporary links for each
    const roundsWithLinks = await Promise.all(rounds.map(async (r) => {
      try {
        const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: r.path }),
        });
        if (!linkRes.ok) return { ...r, link: null };
        const linkData = await linkRes.json();
        return { ...r, link: linkData.link };
      } catch { return { ...r, link: null }; }
    }));

    return new Response(JSON.stringify({
      rounds: roundsWithLinks,
      folderPath,
      folderExists: true,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[dropbox-scan-visuals]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
