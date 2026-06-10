import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// SECURITY: Allowed root path - all operations MUST be within this path
// ============================================================
const ALLOWED_ROOT_PATH = "/00_Production/PRD01_Client-Projects";

/**
 * Validates that a path is within the allowed root.
 * Returns original path if valid, null if out of scope.
 * 
 * SECURITY: Path must be EXACTLY the root OR start with root + "/"
 * This prevents paths like "/00_Production/PRD01_Client-Projects-Archive" from passing.
 */
function validatePath(path: string): string | null {
  if (!path) return null;
  
  // Normalize for comparison: lowercase, collapse slashes, strip trailing slash
  const normalizedPath = path.toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  const normalizedRoot = ALLOWED_ROOT_PATH.toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  
  // Prevent path traversal attacks FIRST (before any other checks)
  if (normalizedPath.includes("..")) {
    console.warn(`SECURITY: Path rejected - traversal attempt: ${path}`);
    return null;
  }
  
  // Path must be EXACTLY the root OR start with root + "/"
  // This prevents "/00_Production/PRD01_Client-Projects-Archive" from matching
  const isExactRoot = normalizedPath === normalizedRoot;
  const isWithinRoot = normalizedPath.startsWith(normalizedRoot + "/");
  
  if (!isExactRoot && !isWithinRoot) {
    console.warn(`SECURITY: Path rejected - outside allowed root boundary: ${path}`);
    return null;
  }
  
  return path; // Return original path (Dropbox is case-insensitive but preserves case)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    // Use anon key client for user auth validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    // Use service role for privileged operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      console.error("Auth error:", userError?.message || "No user found");
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Handle connection-status FIRST - it doesn't require an existing connection
    if (action === "connection-status") {
      const { data: userConnection } = await supabase
        .from("dropbox_connections")
        .select("account_id, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();

      return new Response(
        JSON.stringify({ 
          connected: !!userConnection,
          accountId: userConnection?.account_id,
          lastUpdated: userConnection?.updated_at,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get admin's Dropbox connection (any admin) - required for all other actions
    // SECURITY: Only select required fields - never expose tokens in responses/logs
    const { data: connection, error: connError } = await supabase
      .from("dropbox_connections")
      .select("id, user_id, access_token, refresh_token, token_expires_at, account_id, cursor")
      .limit(1)
      .maybeSingle();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: "No Dropbox connection configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Refresh token if needed
    let accessToken = connection.access_token;
    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
      accessToken = await refreshToken(connection, supabase);
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Failed to refresh Dropbox token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Detect team namespace. Dropbox Business accounts store files in a team
    // namespace; without Dropbox-API-Path-Root every path call returns
    // path/not_found. Mirrors the pattern in dropbox-scan-visuals + dropbox-webhook.
    let rootNamespaceId: string | null = null;
    try {
      const accountRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (accountRes.ok) {
        const accountData = await accountRes.json();
        rootNamespaceId = accountData?.root_info?.root_namespace_id ?? null;
      }
    } catch (e) {
      console.warn("[dropbox-api] namespace detection failed (non-fatal):", (e as Error).message);
    }
    const pathRootHeader: Record<string, string> = rootNamespaceId
      ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", "namespace_id": rootNamespaceId }) }
      : {};

    switch (action) {
      case "get-temporary-link": {
        const body = await req.json();
        const { path } = body;

        if (!path) {
          return new Response(
            JSON.stringify({ error: "Path required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SECURITY: Validate path is within allowed root
        const validatedPath = validatePath(path);
        if (!validatedPath) {
          return new Response(
            JSON.stringify({ error: "Access denied: path outside allowed scope" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const response = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...pathRootHeader,
          },
          body: JSON.stringify({ path: validatedPath }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Failed to get temporary link:", errorText);
          return new Response(
            JSON.stringify({ error: "Failed to get download link" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const data = await response.json();
        // Cache temporary-link responses for 1 hour. Dropbox links remain valid
        // for ~4 hours, but we revalidate sooner to be safe. Browser caching
        // this JSON response means repeat lightbox opens skip the round-trip.
        return new Response(
          JSON.stringify({ link: data.link, metadata: data.metadata }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "private, max-age=3600",
            },
          }
        );
      }

      case "get-thumbnail": {
        const body = await req.json();
        const { path, size = "w256h256" } = body;

        if (!path) {
          return new Response(
            JSON.stringify({ error: "Path required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SECURITY: Validate path is within allowed root
        const validatedPath = validatePath(path);
        if (!validatedPath) {
          return new Response(
            JSON.stringify({ error: "Access denied: path outside allowed scope" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const response = await fetch("https://content.dropboxapi.com/2/files/get_thumbnail_v2", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Dropbox-API-Arg": JSON.stringify({
              resource: { ".tag": "path", path: validatedPath },
              format: "jpeg",
              size: { ".tag": size },
              mode: { ".tag": "strict" },
            }),
            ...pathRootHeader,
          },
        });

        if (!response.ok) {
          // Return placeholder for non-image files
          return new Response(
            JSON.stringify({ error: "Thumbnail not available" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Return thumbnail as base64. Cache aggressively — thumbnails are
        // deterministic from path content; we cap at 1h to align with the
        // temporary-link TTL so file replacements show up within an hour.
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

        return new Response(
          JSON.stringify({ thumbnail: `data:image/jpeg;base64,${base64}` }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "private, max-age=3600",
            },
          }
        );
      }

      case "list-folder": {
        // Admin only
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();

        if (!roleData) {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const body = await req.json();
        // Default to allowed root if no path specified
        const requestedPath = body.path || ALLOWED_ROOT_PATH;

        // SECURITY: Validate path is within allowed root
        const validatedPath = validatePath(requestedPath);
        if (!validatedPath) {
          return new Response(
            JSON.stringify({ error: "Access denied: path outside allowed scope" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...pathRootHeader,
          },
          body: JSON.stringify({ path: validatedPath, recursive: false }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Failed to list folder:", errorText);
          return new Response(
            JSON.stringify({ error: "Failed to list folder" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const data = await response.json();
        return new Response(
          JSON.stringify(data),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "rescan-folder": {
        // Admin only - manual folder scan
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();

        if (!roleData) {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const body = await req.json();
        const { sceneId } = body;

        if (!sceneId) {
          return new Response(
            JSON.stringify({ error: "Scene ID required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get folder mapping for scene
        const { data: mapping } = await supabase
          .from("folder_mappings")
          .select("dropbox_folder_path")
          .eq("scene_id", sceneId)
          .single();

        if (!mapping) {
          return new Response(
            JSON.stringify({ error: "No folder mapping for this scene" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SECURITY: Validate mapped folder path is within allowed root
        const validatedFolderPath = validatePath(mapping.dropbox_folder_path);
        if (!validatedFolderPath) {
          console.error(`SECURITY: Folder mapping contains invalid path: ${mapping.dropbox_folder_path}`);
          return new Response(
            JSON.stringify({ error: "Invalid folder mapping configuration" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get current round
        const { data: scene } = await supabase
          .from("scenes")
          .select("current_round")
          .eq("id", sceneId)
          .single();

        const { data: round } = await supabase
          .from("scene_rounds")
          .select("id")
          .eq("scene_id", sceneId)
          .eq("round_number", scene?.current_round || 1)
          .single();

        if (!round) {
          return new Response(
            JSON.stringify({ error: "Scene round not found" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // List folder contents
        const response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...pathRootHeader,
          },
          body: JSON.stringify({ path: validatedFolderPath, recursive: false }),
        });

        if (!response.ok) {
          return new Response(
            JSON.stringify({ error: "Failed to scan folder" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const data = await response.json();
        let addedCount = 0;
        let updatedCount = 0;

        for (const entry of data.entries || []) {
          if (entry[".tag"] !== "file") continue;

          const ext = entry.name.split(".").pop()?.toLowerCase();
          if (!["jpg", "jpeg", "png", "tiff", "tif", "psd", "exr", "hdr"].includes(ext || "")) {
            continue;
          }

          // Check if asset exists
          const { data: existing } = await supabase
            .from("round_assets")
            .select("id, content_hash, version")
            .eq("dropbox_file_id", entry.id)
            .eq("is_current", true)
            .single();

          if (existing) {
            if (existing.content_hash !== entry.content_hash) {
              // Update version
              await supabase
                .from("round_assets")
                .update({ is_current: false })
                .eq("id", existing.id);

              await supabase.from("round_assets").insert({
                scene_round_id: round.id,
                dropbox_file_id: entry.id,
                dropbox_path: entry.path_lower,
                filename: entry.name,
                file_size: entry.size,
                content_hash: entry.content_hash,
                version: existing.version + 1,
                is_current: true,
              });
              updatedCount++;
            }
          } else {
            await supabase.from("round_assets").insert({
              scene_round_id: round.id,
              dropbox_file_id: entry.id,
              dropbox_path: entry.path_lower,
              filename: entry.name,
              file_size: entry.size,
              content_hash: entry.content_hash,
              version: 1,
              is_current: true,
            });
            addedCount++;
          }
        }

        // Update scene round status if we found assets
        if (addedCount > 0 || updatedCount > 0) {
          await supabase
            .from("scene_rounds")
            .update({ status: "delivered", delivered_at: new Date().toISOString() })
            .eq("id", round.id);
        }

        console.log(`Rescan complete: ${addedCount} added, ${updatedCount} updated`);

        return new Response(
          JSON.stringify({ success: true, added: addedCount, updated: updatedCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search-scene-folders": {
        // Admin only — fuzzy-searches SC{NN}_* subfolders inside a specific project folder.
        // Accepts { project_id, query }; resolves project folder via DB + prefix-search fallback.
        const { data: sceneRoleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();

        if (!sceneRoleData) {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const body = await req.json();
        const projectId = ((body.project_id as string) ?? "").trim();
        const rawQuery = ((body.query as string) ?? "").trim();

        if (!projectId) {
          return new Response(
            JSON.stringify({ error: "project_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (rawQuery.length < 2) {
          return new Response(
            JSON.stringify({ folders: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Resolve project folder from DB
        const { data: projectRow } = await supabase
          .from("projects")
          .select("dropbox_folder, project_code")
          .eq("id", projectId)
          .maybeSingle();

        let projectFolderPath: string | null = (projectRow?.dropbox_folder as string | null) ?? null;

        // Fallback: prefix-search PROJECTS_ROOT by project_code
        if (!projectFolderPath && projectRow?.project_code) {
          const projCode = (projectRow.project_code as string).toUpperCase();
          const rootListRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              ...pathRootHeader,
            },
            body: JSON.stringify({ path: ALLOWED_ROOT_PATH, recursive: false }),
          });
          if (rootListRes.ok) {
            const rootData = await rootListRes.json() as { entries: Array<Record<string, unknown>> };
            const prefix = projCode.toLowerCase() + "_";
            const hit = (rootData.entries ?? []).find(
              (e) => e[".tag"] === "folder" && (e.name as string).toLowerCase().startsWith(prefix)
            );
            if (hit) projectFolderPath = hit.path_display as string;
          }
        }

        if (!projectFolderPath) {
          return new Response(
            JSON.stringify({ folders: [], warning: "project_folder_not_found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Security: project folder must be within allowed root
        const validatedProjectFolder = validatePath(projectFolderPath);
        if (!validatedProjectFolder) {
          return new Response(
            JSON.stringify({ error: "Access denied: project folder outside allowed scope" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // List scene subfolders
        const sceneListRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...pathRootHeader,
          },
          body: JSON.stringify({ path: validatedProjectFolder, recursive: false }),
        });

        if (!sceneListRes.ok) {
          const errText = await sceneListRes.text();
          console.warn("[dropbox-api] search-scene-folders list_folder failed:", errText);
          return new Response(
            JSON.stringify({ folders: [], warning: "dropbox_list_failed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const sceneListData = await sceneListRes.json() as { entries: Array<Record<string, unknown>> };

        function normScene(s: string): string {
          return s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        }

        const SC_RE = /^SC(\d+)_(.+)$/i;
        const normSceneQ = normScene(rawQuery);

        const sceneFolders = (sceneListData.entries ?? [])
          .filter((e) => e[".tag"] === "folder")
          .map((e) => {
            const folderName = e.name as string;
            const pathDisplay = e.path_display as string;
            const m = folderName.match(SC_RE);
            const sceneCode = m ? `SC${m[1].padStart(2, "0")}` : null;
            const displayName = m ? m[2] : folderName;
            const dropboxFolderUrl = `https://www.dropbox.com/home${pathDisplay}`;
            return { folder_name: folderName, path_display: pathDisplay, scene_code: sceneCode, display_name: displayName, dropbox_folder_url: dropboxFolderUrl };
          })
          .filter(({ folder_name, display_name, scene_code }) => {
            const normName = normScene(folder_name);
            const normDisplay = normScene(display_name);
            const normCode = (scene_code ?? "").toLowerCase();
            return (
              normName.includes(normSceneQ) ||
              normDisplay.includes(normSceneQ) ||
              normSceneQ.includes(normDisplay) ||
              (normCode.length > 0 && (normCode.includes(normSceneQ) || normSceneQ.startsWith(normCode)))
            );
          })
          .slice(0, 8);

        return new Response(
          JSON.stringify({ folders: sceneFolders }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search-project-folders": {
        // Admin only — fuzzy-searches existing project folders under PROJECTS_ROOT.
        // Returns up to 8 matching folders with extracted project_code and web URL.
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .single();

        if (!roleData) {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const body = await req.json();
        const rawQuery = ((body.query as string) ?? "").trim();
        if (rawQuery.length < 2) {
          return new Response(
            JSON.stringify({ folders: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...pathRootHeader,
          },
          body: JSON.stringify({ path: ALLOWED_ROOT_PATH, recursive: false }),
        });

        if (!listRes.ok) {
          const errText = await listRes.text();
          console.warn("[dropbox-api] search-project-folders list_folder failed:", errText);
          return new Response(
            JSON.stringify({ folders: [], warning: "dropbox_list_failed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const listData = await listRes.json() as { entries: Array<Record<string, unknown>> };

        function normFolder(s: string): string {
          return s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        }

        // Matches CP or RUP prefix, e.g. CP107_660-Madison or RUP42_Some-Project
        const CODE_RE = /^(CP|RUP)(\d+)_(.+)$/i;
        const normQ = normFolder(rawQuery);

        const folders = (listData.entries ?? [])
          .filter((e) => e[".tag"] === "folder")
          .map((e) => {
            const folderName = e.name as string;
            const pathDisplay = e.path_display as string;
            const m = folderName.match(CODE_RE);
            const projectCode = m ? `${m[1].toUpperCase()}${m[2]}` : null;
            const displayName = m ? m[3] : folderName;
            const dropboxFolderUrl = `https://www.dropbox.com/home${pathDisplay}`;
            return { folder_name: folderName, path_display: pathDisplay, project_code: projectCode, display_name: displayName, dropbox_folder_url: dropboxFolderUrl };
          })
          .filter(({ folder_name, display_name, project_code }) => {
            const normName = normFolder(folder_name);
            const normDisplay = normFolder(display_name);
            const normCode = (project_code ?? "").toLowerCase();
            return (
              normName.includes(normQ) ||
              normDisplay.includes(normQ) ||
              normQ.includes(normDisplay) ||
              (normCode.length > 0 && (normCode.includes(normQ) || normQ.startsWith(normCode)))
            );
          })
          .slice(0, 8);

        return new Response(
          JSON.stringify({ folders }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Error in dropbox-api:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function refreshToken(connection: any, supabase: any): Promise<string | null> {
  const dropboxAppKey = Deno.env.get("DROPBOX_APP_KEY")!;
  const dropboxAppSecret = Deno.env.get("DROPBOX_APP_SECRET")!;

  try {
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${dropboxAppKey}:${dropboxAppSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });

    if (!response.ok) return null;

    const tokenData = await response.json();
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    await supabase
      .from("dropbox_connections")
      .update({
        access_token: tokenData.access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return tokenData.access_token;
  } catch {
    return null;
  }
}
