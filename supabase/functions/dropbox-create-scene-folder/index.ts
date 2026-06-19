// dropbox-create-scene-folder/index.ts
//
// Called by a Supabase DB trigger on INSERT to scenes.
// Looks up the parent project's dropbox_folder, scans it for existing SC{n}_*
// folders, creates the next scene folder plus six standard subfolders, and
// writes scene_code, scene_slug, and dropbox_folder back to the scenes row.
//
// Race-condition handling: if the project's dropbox_folder is not yet set
// (project trigger still in flight), this function polls up to 5×2s before
// falling back to prefix-search using project_code.
//
// Deploy: npx supabase functions deploy dropbox-create-scene-folder \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECTS_ROOT = "/00_Production/PRD01_Client-Projects";
const SC_PATTERN = /^SC(\d+)_/i;

const SCENE_SUBFOLDERS = [
  "INS_Instructions",
  "MISC_Miscellaneous",
  "MO_Models",
  "VS_Visuals",
  "AS_Assets",
];

function slugify(name: string): string {
  return name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "");
}

function padCode(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

async function refreshToken(
  connection: Record<string, string>,
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const appKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET")!;
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
    await supabase
      .from("dropbox_connections")
      .update({ access_token: data.access_token, token_expires_at: expiresAt })
      .eq("id", connection.id);
    return data.access_token;
  } catch {
    return null;
  }
}

function dropboxHeaders(
  accessToken: string,
  namespaceId: string | null,
): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (namespaceId) {
    h["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "namespace_id",
      namespace_id: namespaceId,
    });
  }
  return h;
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

async function listFolder(
  accessToken: string,
  path: string,
  namespaceId: string | null,
): Promise<Record<string, unknown>[] | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: dropboxHeaders(accessToken, namespaceId),
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.entries ?? [];
}

async function createFolder(
  accessToken: string,
  path: string,
  namespaceId: string | null,
): Promise<string> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/files/create_folder_v2",
    {
      method: "POST",
      headers: dropboxHeaders(accessToken, namespaceId),
      body: JSON.stringify({ path, autorename: false }),
    },
  );
  if (res.ok) {
    const data = await res.json();
    return (data.metadata?.path_display ?? path) as string;
  }
  const errText = await res.text();
  if (errText.includes("path/conflict")) {
    console.log(`[dropbox-create-scene-folder] Folder already exists: ${path}`);
    return path;
  }
  throw new Error(`create_folder_v2 failed for ${path}: ${errText}`);
}

// Find a folder inside parentPath whose name starts with {code}_ (case-insensitive).
async function findFolderByPrefix(
  accessToken: string,
  parentPath: string,
  prefix: string,
  namespaceId: string | null,
): Promise<string | null> {
  const entries = await listFolder(accessToken, parentPath, namespaceId);
  if (!entries) return null;
  const p = prefix.toLowerCase() + "_";
  const match = entries.find(
    (e) => e[".tag"] === "folder" && (e.name as string).toLowerCase().startsWith(p),
  );
  return match ? (match.path_display as string) : null;
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json() as { record: Record<string, unknown> };
    const record = body.record;
    const sceneId = record.id as string;
    const projectId = record.project_id as string;
    const sceneName = record.name as string;

    if (!sceneId || !projectId || !sceneName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Skip when the scene already has a code (linked/onboarded scene) or a Dropbox
    // folder set on INSERT. Mirrors the dropbox-create-project-folder guard.
    if (record.scene_code || record.dropbox_folder) {
      const reason = record.scene_code
        ? `scene_code (${record.scene_code})`
        : `dropbox_folder (${record.dropbox_folder})`;
      console.log(`[dropbox-create-scene-folder] already has ${reason} — linked scene, skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "linked_scene" }));
    }

    console.log(`[dropbox-create-scene-folder] scene=${sceneId} project=${projectId} name="${sceneName}"`);

    // Get Dropbox connection
    const { data: connection } = await supabase
      .from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .limit(1)
      .maybeSingle();

    if (!connection) {
      console.warn("[dropbox-create-scene-folder] Dropbox not connected — skipping");
      return new Response(JSON.stringify({ skipped: true, reason: "dropbox_not_connected" }));
    }

    let accessToken = connection.access_token as string;
    if (
      connection.token_expires_at &&
      new Date(connection.token_expires_at as string) < new Date()
    ) {
      accessToken = (await refreshToken(connection as Record<string, string>, supabase)) ?? accessToken;
    }

    const namespaceId = await getRootNamespaceId(accessToken);

    // Resolve project folder — poll up to 5×2s for the project trigger to finish,
    // then fall back to prefix search via project_code.
    let projectFolder: string | null = null;
    let projectCode: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: project } = await supabase
        .from("projects")
        .select("dropbox_folder, project_code, project_slug")
        .eq("id", projectId)
        .single();

      if (project?.dropbox_folder) {
        projectFolder = project.dropbox_folder as string;
        break;
      }
      if (project?.project_code) projectCode = project.project_code as string;
      if (attempt < 4) {
        console.log(`[dropbox-create-scene-folder] project.dropbox_folder not set yet, waiting… (attempt ${attempt + 1})`);
        await delay(2000);
      }
    }

    // If still null, try prefix search using project_code
    if (!projectFolder && projectCode) {
      console.warn("[dropbox-create-scene-folder] Falling back to prefix search for project folder");
      projectFolder = await findFolderByPrefix(
        accessToken, PROJECTS_ROOT, projectCode, namespaceId,
      );
    }

    if (!projectFolder) {
      throw new Error(
        `Cannot resolve project folder for project ${projectId}. ` +
        "Ensure dropbox-create-project-folder has run successfully first.",
      );
    }

    // List project folder, find highest SC number
    const entries = await listFolder(accessToken, projectFolder, namespaceId);
    if (!entries) {
      throw new Error(`Failed to list Dropbox folder: ${projectFolder}`);
    }

    let highest = 0;
    for (const e of entries) {
      if (e[".tag"] !== "folder") continue;
      const m = (e.name as string).match(SC_PATTERN);
      if (m) highest = Math.max(highest, parseInt(m[1], 10));
    }

    const nextNum = highest + 1;
    const sceneCode = `SC${padCode(nextNum, 2)}`;
    const slug = slugify(sceneName);
    const folderName = `${sceneCode}_${slug}`;
    const sceneFolderPath = `${projectFolder}/${folderName}`;

    console.log(`[dropbox-create-scene-folder] Creating ${sceneFolderPath}`);
    await createFolder(accessToken, sceneFolderPath, namespaceId);

    // Create five standard subfolders, then PP_Post-Production inside VS_Visuals
    for (const sub of SCENE_SUBFOLDERS) {
      await createFolder(accessToken, `${sceneFolderPath}/${sub}`, namespaceId);
    }
    await createFolder(accessToken, `${sceneFolderPath}/VS_Visuals/PP_Post-Production`, namespaceId);

    // Write scene_code, scene_slug, dropbox_folder back to DB
    const { error: updateErr } = await supabase
      .from("scenes")
      .update({
        scene_code: sceneCode,
        scene_slug: slug,
        dropbox_folder: sceneFolderPath,
      })
      .eq("id", sceneId);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    console.log(
      `[dropbox-create-scene-folder] Done. code=${sceneCode} folder=${sceneFolderPath}`,
    );
    return new Response(
      JSON.stringify({ success: true, sceneCode, sceneFolderPath }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dropbox-create-scene-folder] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
