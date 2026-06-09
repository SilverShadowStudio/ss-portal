// dropbox-create-project-folder/index.ts
//
// Called by a Supabase DB trigger on INSERT to projects.
// Scans /00_Production/PRD01_Client-Projects/ for existing CP{n}_* folders,
// finds the highest number, creates the next folder, and writes
// project_code, project_slug, and dropbox_folder back to the projects row.
//
// Deploy: npx supabase functions deploy dropbox-create-project-folder \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECTS_ROOT = "/00_Production/PRD01_Client-Projects";
const CP_PATTERN = /^CP(\d+)_/i;

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

// Returns the path_display of the created folder, or null if it already existed.
async function createFolder(
  accessToken: string,
  path: string,
  namespaceId: string | null,
): Promise<string | null> {
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
    console.log(`[dropbox-create-project-folder] Folder already exists: ${path}`);
    return path;
  }
  throw new Error(`create_folder_v2 failed for ${path}: ${errText}`);
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
    const body = await req.json() as {
      record: Record<string, unknown>;
    };
    const record = body.record;
    const projectId = record.id as string;
    const projectName = record.name as string;

    if (!projectId || !projectName) {
      return new Response(JSON.stringify({ error: "Missing project id or name" }), { status: 400 });
    }

    // Skip when the project already has a code (Airtable-linked) or a Dropbox
    // folder (Dropbox-only match, including codeless legacy folders). Either
    // means we're onboarding an existing project, not creating a new one.
    if (record.project_code || record.dropbox_folder) {
      const reason = record.project_code
        ? `project_code (${record.project_code})`
        : `dropbox_folder (${record.dropbox_folder})`;
      console.log(`[dropbox-create-project-folder] already has ${reason} — linked project, skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "linked_project" }));
    }

    console.log(`[dropbox-create-project-folder] project=${projectId} name="${projectName}"`);

    // Get Dropbox connection
    const { data: connection } = await supabase
      .from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .limit(1)
      .maybeSingle();

    if (!connection) {
      console.warn("[dropbox-create-project-folder] Dropbox not connected — skipping");
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

    // List PROJECTS_ROOT to find highest CP number
    const entries = await listFolder(accessToken, PROJECTS_ROOT, namespaceId);
    if (!entries) {
      throw new Error(`Failed to list Dropbox folder: ${PROJECTS_ROOT}`);
    }

    let highest = 0;
    for (const e of entries) {
      if (e[".tag"] !== "folder") continue;
      const m = (e.name as string).match(CP_PATTERN);
      if (m) highest = Math.max(highest, parseInt(m[1], 10));
    }

    const nextNum = highest + 1;
    const projectCode = `CP${padCode(nextNum, 3)}`;
    const slug = slugify(projectName);
    const folderName = `${projectCode}_${slug}`;
    const folderPath = `${PROJECTS_ROOT}/${folderName}`;

    console.log(`[dropbox-create-project-folder] Creating ${folderPath}`);
    await createFolder(accessToken, folderPath, namespaceId);

    // Write project_code, project_slug, dropbox_folder back to DB
    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        project_code: projectCode,
        project_slug: slug,
        dropbox_folder: folderPath,
      })
      .eq("id", projectId);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    console.log(
      `[dropbox-create-project-folder] Done. code=${projectCode} folder=${folderPath}`,
    );
    return new Response(
      JSON.stringify({ success: true, projectCode, folderPath }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dropbox-create-project-folder] Error:", msg);
    // Return 200 so the DB trigger does not retry endlessly
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
