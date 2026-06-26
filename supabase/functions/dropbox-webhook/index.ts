import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { enqueueDeliveryNotification } from "../_shared/deliveryNotification.ts";

// Inline review window logic (mirrors src/lib/reviewWindow.ts — no browser imports allowed in Deno)
function computeReviewWindow(fromDate: Date): { start: Date; end: Date } {
  const BUFFER_DAYS = 2;
  const DEADLINE_HOUR = 14;
  const earliest = new Date(fromDate.getTime() + BUFFER_DAYS * 24 * 60 * 60 * 1000);
  // Advance to next Friday at 14:00
  const day = earliest.getDay(); // 0=Sun … 6=Sat
  const daysUntilFriday = day <= 5 ? 5 - day : 6; // if already Friday, go to next Friday
  const end = new Date(earliest);
  end.setDate(earliest.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday));
  end.setHours(DEADLINE_HOUR, 0, 0, 0);
  const start = new Date(fromDate);
  return { start, end };
}

async function deliverRound(supabase: ReturnType<typeof createClient>, sceneRoundId: string): Promise<void> {
  // Fetch current status
  const { data: round } = await supabase
    .from("scene_rounds")
    .select("id, status, round_number, scene_id")
    .eq("id", sceneRoundId)
    .single();

  if (!round) return;

  const DELIVERED_STATES = ["delivered", "client_review", "approved"];
  if (DELIVERED_STATES.includes(round.status)) return;

  const now = new Date();
  const { end } = computeReviewWindow(now);

  // Mark round as delivered
  await supabase
    .from("scene_rounds")
    .update({ status: "delivered", delivered_at: now.toISOString(), end_date: end.toISOString() })
    .eq("id", sceneRoundId);

  // Upsert sibling review round
  const { data: existingReview } = await supabase
    .from("scene_rounds")
    .select("id")
    .eq("scene_id", round.scene_id)
    .eq("round_number", round.round_number)
    .eq("kind", "review")
    .maybeSingle();

  if (!existingReview) {
    await supabase.from("scene_rounds").insert({
      scene_id: round.scene_id,
      round_number: round.round_number,
      kind: "review",
      status: "client_review",
      start_date: now.toISOString(),
      end_date: end.toISOString(),
    });
  } else {
    await supabase
      .from("scene_rounds")
      .update({ status: "client_review", start_date: now.toISOString(), end_date: end.toISOString() })
      .eq("id", existingReview.id);
  }

  // Log activity
  const { error: logErr } = await supabase.from("activity_log").insert({
    actor_name: "Dropbox",
    actor_role: "system",
    action: "round_delivered",
    description: `Round ${String(round.round_number).padStart(2, "0")} delivered via Dropbox sync`,
    scene_id: round.scene_id,
    round_number: round.round_number,
  });
  if (logErr) console.warn("activity log (round_delivered) failed", logErr);

  // Enqueue client-facing delivery email. We only reach this branch when a
  // round actually flipped from non-delivered to delivered (early return at
  // top of function gates duplicates), so this is the correct moment.
  await enqueueDeliveryNotification(supabase, {
    sceneRoundId,
    sceneId: round.scene_id,
    roundNumber: round.round_number,
  });
}

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
    const pathMap = new Map<string, { sceneId?: string; projectId?: string; sceneName?: string; projectName?: string }>();
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
        sceneName: mapping.scenes?.name ?? null,
        projectName: mapping.projects?.name ?? null,
      });
    }

    // Resolve team root_namespace_id with the persisted-then-lazy-populate
    // pattern shipped in dropbox-api. Dropbox Business stores files in a team
    // namespace; without Dropbox-API-Path-Root the root-recursive list_folder
    // targets the user's empty personal home and silently "finds" 0 entries.
    // Read the id from app_settings (key `dropbox_root_namespace`), only call
    // get_current_account on a cache miss, then store it. FAIL CLOSED: if the
    // namespace can't be resolved we abort the run loudly WITHOUT advancing the
    // cursor or marking anything processed (this returns before list_folder and
    // before the cursor update), so the next webhook trigger re-runs from the
    // same cursor and can succeed once the namespace is resolvable again.
    let rootNamespaceId = await readStoredNamespaceId(supabase);
    if (!rootNamespaceId) {
      rootNamespaceId = await fetchFreshNamespaceId(accessToken);
      if (rootNamespaceId) {
        await storeNamespaceId(supabase, rootNamespaceId);
      }
    }
    if (!rootNamespaceId) {
      console.error(
        "[dropbox-webhook] namespace unresolved — no stored value and get_current_account did not return one; aborting run without advancing cursor so a re-trigger can retry"
      );
      return;
    }
    console.log(`[dropbox-webhook] using root_namespace_id ${rootNamespaceId}`);
    const pathRootHeader: Record<string, string> = {
      "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", "namespace_id": rootNamespaceId }),
    };

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
        ...pathRootHeader,
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
          // Activity log: new round auto-created by Dropbox sync.
          const { error: createdLogErr } = await supabase.from("activity_log").insert({
            actor_name: "Dropbox",
            actor_role: "system",
            action: "round_created",
            description: `Round ${String(roundNumber).padStart(2, "0")} created via Dropbox sync${matchedMapping.sceneName ? ` — ${matchedMapping.sceneName}` : ""}`,
            scene_id: matchedMapping.sceneId ?? null,
            scene_name: matchedMapping.sceneName ?? null,
            project_id: matchedMapping.projectId ?? null,
            project_name: matchedMapping.projectName ?? null,
            round_number: roundNumber,
          });
          if (createdLogErr) console.warn("activity log (round_created) failed", createdLogErr);
        }
      }

      if (!sceneRoundId) {
        console.log("No scene round resolved, skipping file:", entry.name);
        continue;
      }

      // Check whether a row for THIS file already exists in the round —
      // REGARDLESS of is_current. A hidden (is_current=false) lower version
      // still counts as already-ingested and must NOT be re-inserted as a
      // brand-new asset; filtering on is_current=true here (the prior bug)
      // missed those rows and dropped through to the duplicate-insert branch
      // below. scan-all-versions now leaves lower versions is_current=false,
      // so without this every Dropbox event for such a file would create a
      // duplicate round_assets row plus a spurious dropbox_file_received log.
      // Match by Dropbox file id first, then by path within the round. Order by
      // version desc + limit 1 so a prior content-bump (which leaves multiple
      // rows sharing a file id / path) resolves to the latest deterministically
      // rather than tripping maybeSingle()'s multiple-rows error.
      const { data: existingByFileId } = await supabase
        .from("round_assets")
        .select("id, content_hash, version")
        .eq("dropbox_file_id", entry.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: existingByPath } = !existingByFileId
        ? await supabase
            .from("round_assets")
            .select("id, content_hash, version")
            .eq("dropbox_path", entry.path_lower)
            .eq("scene_round_id", sceneRoundId)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      const existingAsset = existingByFileId ?? existingByPath;

      if (existingAsset) {
        // Treat as a NEW version only when both hashes are known and differ. A
        // NULL stored hash (legacy / scan-reconciled rows carry no content_hash)
        // cannot prove a change, so default to "unchanged" — bumping a version
        // off an unknown hash would re-create the very duplicate this fix
        // prevents. Genuine webhook re-renders (both hashes present) still bump.
        if (
          !existingAsset.content_hash ||
          !entry.content_hash ||
          existingAsset.content_hash === entry.content_hash
        ) {
          console.log("File unchanged (already ingested):", entry.name);
        } else {
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
        }
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
          source: "dropbox",
        });

        console.log("Created new asset:", entry.name);

        // Activity log: new file received from Dropbox.
        const projectPart = matchedMapping.projectName ?? null;
        const scenePart = matchedMapping.sceneName ?? null;
        const locationLabel = [projectPart, scenePart, `Round ${String(roundNumber).padStart(2, "0")}`].filter(Boolean).join(" / ");
        const { error: receivedLogErr } = await supabase.from("activity_log").insert({
          actor_name: "Dropbox",
          actor_role: "system",
          action: "dropbox_file_received",
          description: `File received: ${entry.name}${locationLabel ? ` — ${locationLabel}` : ""}`,
          scene_id: matchedMapping.sceneId ?? null,
          scene_name: scenePart,
          project_id: matchedMapping.projectId ?? null,
          project_name: projectPart,
          round_number: roundNumber,
          metadata: { filename: entry.name, dropbox_path: entry.path_lower },
        });
        if (receivedLogErr) console.warn("activity log (dropbox_file_received) failed", receivedLogErr);
      }

      // Deliver round whenever a file arrives (new or updated) — idempotent.
      await deliverRound(supabase, sceneRoundId);
      
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

// app_settings key for the persisted team root_namespace_id. Mirrors the
// helpers in dropbox-api (same key, same shape) so the two functions never
// diverge. The team root namespace for a Dropbox Business workspace is stable
// across token rotations and reconnects to the same team, so we cache it
// indefinitely. If the team is ever migrated, manually delete this row to force
// re-detection.
const NS_SETTINGS_KEY = "dropbox_root_namespace";

async function readStoredNamespaceId(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", NS_SETTINGS_KEY)
    .maybeSingle();
  const id = data?.value?.namespace_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function storeNamespaceId(supabase: any, namespaceId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({
      key: NS_SETTINGS_KEY,
      value: { namespace_id: namespaceId, updated_at: new Date().toISOString() },
    });
  if (error) console.warn("[dropbox-webhook] storeNamespaceId upsert error:", error.message);
}

async function fetchFreshNamespaceId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("[dropbox-webhook] get_current_account non-OK:", res.status);
      return null;
    }
    const data = await res.json();
    const id = data?.root_info?.root_namespace_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch (e) {
    console.warn("[dropbox-webhook] get_current_account threw:", (e as Error).message);
    return null;
  }
}
