import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// SECURITY: Allowed root path - all operations MUST be within this path
// ============================================================
const ALLOWED_ROOT_PATH = "/00_production/prd01_client-projects";

/**
 * Validates that a path is within the allowed root.
 * Returns true if valid, false if out of scope.
 * 
 * SECURITY: Path must be EXACTLY the root OR start with root + "/"
 * This prevents paths like "/00_production/prd01_client-projects-archive" from passing.
 */
function isPathAllowed(path: string): boolean {
  if (!path) return false;
  
  // Normalize for comparison: lowercase, collapse slashes, strip trailing slash
  const normalizedPath = path.toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  
  // Prevent path traversal attacks FIRST (before any other checks)
  if (normalizedPath.includes("..")) {
    return false;
  }
  
  // Path must be EXACTLY the root OR start with root + "/"
  // This prevents "/00_production/prd01_client-projects-archive" from matching
  const isExactRoot = normalizedPath === ALLOWED_ROOT_PATH;
  const isWithinRoot = normalizedPath.startsWith(ALLOWED_ROOT_PATH + "/");
  
  return isExactRoot || isWithinRoot;
}

Deno.serve(async (req) => {
  // Handle Dropbox webhook verification challenge
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challenge = url.searchParams.get("challenge");
    if (challenge) {
      console.log("Responding to Dropbox webhook verification challenge");
      return new Response(challenge, {
        headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" },
      });
    }
    return new Response("OK", { headers: corsHeaders });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse webhook payload
    const payload = await req.json();
    console.log("Received Dropbox webhook:", JSON.stringify(payload));

    // Dropbox sends list of accounts that have changes
    const accounts = payload.list_folder?.accounts || [];
    
    for (const accountId of accounts) {
      console.log("Processing changes for account:", accountId);

      // Find the connection for this account
      // SECURITY: Only select required fields - never log or return token values
      const { data: connection, error: connError } = await supabase
        .from("dropbox_connections")
        .select("id, user_id, access_token, refresh_token, token_expires_at, cursor")
        .eq("account_id", accountId)
        .single();

      if (connError || !connection) {
        console.log("No connection found for account:", accountId);
        continue;
      }

      // Check if token needs refresh
      let accessToken = connection.access_token;
      if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
        accessToken = await refreshToken(connection, supabase);
        if (!accessToken) {
          console.error("Failed to refresh token for account:", accountId);
          continue;
        }
      }

      // Get changes using cursor or start fresh
      const cursor = connection.cursor;
      await processChanges(supabase, connection.user_id, accessToken, cursor, accountId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    if (!response.ok) {
      console.error("Token refresh failed:", await response.text());
      return null;
    }

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
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

async function processChanges(
  supabase: any,
  userId: string,
  accessToken: string,
  cursor: string | null,
  accountId: string
) {
  try {
    // Get folder mappings to know which paths to track
    const { data: mappings } = await supabase
      .from("folder_mappings")
      .select("*, scenes(id, name, project_id), projects(id, name)");

    if (!mappings || mappings.length === 0) {
      console.log("No folder mappings configured");
      return;
    }

    // Create a map of paths to their targets (only for paths within allowed root)
    const pathMap = new Map<string, { sceneId?: string; projectId?: string }>();
    for (const mapping of mappings) {
      const path = mapping.dropbox_folder_path.toLowerCase();

      // SECURITY: Only include mappings within allowed root
      if (!isPathAllowed(path)) {
        console.warn(`SECURITY: Skipping folder mapping outside allowed root: ${path}`);
        continue;
      }

      pathMap.set(path, {
        sceneId: mapping.scene_id,
        projectId: mapping.project_id,
      });
    }

    // Get list of changes from Dropbox
    const listUrl = cursor
      ? "https://api.dropboxapi.com/2/files/list_folder/continue"
      : "https://api.dropboxapi.com/2/files/list_folder";

    const listBody = cursor
      ? { cursor }
      : { path: "", recursive: true, include_deleted: false };

    const response = await fetch(listUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(listBody),
    });

    if (!response.ok) {
      console.error("Failed to list folder:", await response.text());
      return;
    }

    const data = await response.json();
    console.log(`Found ${data.entries?.length || 0} entries`);

    // Process each entry
    let processedCount = 0;
    let skippedOutOfScope = 0;
    
    for (const entry of data.entries || []) {
      if (entry[".tag"] !== "file") continue;

      const filePath = entry.path_lower;
      
      // SECURITY: Skip files outside allowed root (defense in depth)
      if (!isPathAllowed(filePath)) {
        skippedOutOfScope++;
        continue;
      }

      const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
      
      // Find matching folder mapping — file must be inside the VS_Visuals subfolder
      let matchedMapping = null;
      for (const [mappedPath, target] of pathMap) {
        const vsPath = mappedPath + "/vs_visuals";
        if (filePath.startsWith(vsPath + "/") || parentPath === vsPath) {
          matchedMapping = { path: mappedPath, ...target };
          break;
        }
      }

      if (!matchedMapping) continue;

      // Check if it's an image file
      const ext = entry.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png", "tiff", "tif", "psd", "exr", "hdr"].includes(ext || "")) {
        continue;
      }

      console.log("Processing file:", entry.path_display, "for scene:", matchedMapping.sceneId);

      // Parse round number from filename: _R{n}_ pattern (e.g. CP107-SC05-VS_R02_10.jpg → 2)
      const roundMatch = entry.name.match(/_R(\d+)_/i);
      if (!roundMatch) {
        console.log("Skipping file with no round pattern in name:", entry.name);
        continue;
      }
      const roundNumber = parseInt(roundMatch[1], 10);

      // Get or create scene round
      let sceneRoundId: string | null = null;
      if (matchedMapping.sceneId) {
        const { data: existingRound } = await supabase
          .from("scene_rounds")
          .select("id")
          .eq("scene_id", matchedMapping.sceneId)
          .eq("round_number", roundNumber)
          .maybeSingle();

        if (existingRound) {
          sceneRoundId = existingRound.id;
        } else {
          const { data: newRound, error: createError } = await supabase
            .from("scene_rounds")
            .insert({
              scene_id: matchedMapping.sceneId,
              round_number: roundNumber,
              status: "in_production",
            })
            .select("id")
            .single();

          if (createError) {
            console.error("Failed to create scene round:", roundNumber, createError.message);
            continue;
          }
          sceneRoundId = newRound.id;
          console.log("Created scene round", roundNumber, "for scene", matchedMapping.sceneId);
        }
      }

      if (!sceneRoundId) {
        console.log("No scene round resolved, skipping file:", entry.name);
        continue;
      }

      // Check if asset already exists (by file ID)
      const { data: existingAsset } = await supabase
        .from("round_assets")
        .select("id, content_hash, version")
        .eq("dropbox_file_id", entry.id)
        .eq("is_current", true)
        .single();

      if (existingAsset) {
        // Check if content changed
        if (existingAsset.content_hash === entry.content_hash) {
          console.log("File unchanged:", entry.name);
          continue;
        }

        // Mark old version as not current
        await supabase
          .from("round_assets")
          .update({ is_current: false })
          .eq("id", existingAsset.id);

        // Create new version
        await supabase.from("round_assets").insert({
          scene_round_id: sceneRoundId,
          dropbox_file_id: entry.id,
          dropbox_path: entry.path_lower,
          filename: entry.name,
          file_size: entry.size,
          content_hash: entry.content_hash,
          version: existingAsset.version + 1,
          is_current: true,
        });

        console.log("Created new version:", existingAsset.version + 1, "for", entry.name);
      } else {
        // Create new asset
        await supabase.from("round_assets").insert({
          scene_round_id: sceneRoundId,
          dropbox_file_id: entry.id,
          dropbox_path: entry.path_lower,
          filename: entry.name,
          file_size: entry.size,
          content_hash: entry.content_hash,
          version: 1,
          is_current: true,
        });

        console.log("Created new asset:", entry.name);

        // Update scene round status to delivered
        await supabase
          .from("scene_rounds")
          .update({ status: "delivered", delivered_at: new Date().toISOString() })
          .eq("id", sceneRoundId);
      }
      
      processedCount++;
    }

    // Log security metrics
    if (skippedOutOfScope > 0) {
      console.log(`SECURITY: Skipped ${skippedOutOfScope} files outside allowed root path`);
    }
    console.log(`Processed ${processedCount} files within allowed scope`);

    // Update cursor for next time
    await supabase
      .from("dropbox_connections")
      .update({ cursor: data.cursor })
      .eq("account_id", accountId);

    // If there are more results, continue processing
    if (data.has_more) {
      await processChanges(supabase, userId, accessToken, data.cursor, accountId);
    }
  } catch (error) {
    console.error("Error processing changes:", error);
  }
}
