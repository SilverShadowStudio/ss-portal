// dropbox-scan-visuals/index.ts
//
// Scans the VS_Visuals folder for a scene and ingests EVERY version file
// found as its own round_assets row. The admin chooses which version(s)
// the client sees via the publish-flag mechanism — the scan never makes
// that decision except as a fallback when a round would otherwise be
// dark (see "no-current fallback" below).
//
// For Dropbox Business/Team accounts, files live in a team namespace.
// We detect this via /2/users/get_current_account and set the
// Dropbox-API-Path-Root header on all subsequent API calls.
//
// File naming: ...R{N}_{V}.{ext} suffix is required (e.g.
// CP115_SC02-VS_R01_03.jpg or CP107_SC05_R01_03.jpg — the VS_Visuals
// folder location already gates the file class, so the `-VS` marker is
// not enforced).
//
// Returns: array of { round, version, filename, path, modified_at, link }
// One entry per round (highest version) — preserves the admin Dropbox
// preview UI shape; the full version set is reflected in round_assets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueDeliveryNotification } from "../_shared/deliveryNotification.ts";
import { requireAdminUser } from "../_shared/cronAuth.ts";

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

// Build base headers for all Dropbox API calls.
// If a root namespace ID is known, include Dropbox-API-Path-Root so that
// paths resolve inside the team namespace rather than the personal root.
function dropboxHeaders(accessToken: string, namespaceId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (namespaceId) {
    h["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "namespace_id", "namespace_id": namespaceId });
  }
  return h;
}

// List immediate children of a Dropbox folder. Returns null on error.
async function listFolder(
  accessToken: string,
  path: string,
  namespaceId: string | null,
): Promise<any[] | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: dropboxHeaders(accessToken, namespaceId),
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.entries || [];
}

// Find the first folder inside `parentPath` whose name starts with `{code}_` (case-insensitive).
async function findFolderByCode(
  accessToken: string,
  parentPath: string,
  code: string,
  namespaceId: string | null,
): Promise<string | null> {
  const entries = await listFolder(accessToken, parentPath, namespaceId);
  if (!entries) return null;
  const prefix = code.toLowerCase() + "_";
  const match = entries.find(
    (e: any) => e[".tag"] === "folder" && e.name.toLowerCase().startsWith(prefix),
  );
  return match ? match.path_display : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Admin-only: this scans + delivers on any sceneId via the service-role
    // client below. A plain getUser() check (any signed-in user) let a client
    // drive delivery on another client's scene — the service role bypasses RLS.
    const auth = await requireAdminUser(req, { corsHeaders });
    if (!auth.ok) return auth.response;

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

    // Get Dropbox connection
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

    // --- Detect team namespace ---
    // /2/users/get_current_account returns root_info which tells us whether
    // this is a personal or team account and what the root namespace ID is.
    const accountRes = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const accountData = accountRes.ok ? await accountRes.json() : null;

    // root_info.root_namespace_id is present on both personal and team accounts;
    // for team accounts the .tag will be "team" and root_namespace_id points to
    // the team shared space. Use it whenever it exists so paths resolve correctly.
    const rootNamespaceId: string | null =
      accountData?.root_info?.root_namespace_id ?? null;

    // Resolve project folder by searching for a folder beginning with `{projectCode}_`
    const projectFolderPath = await findFolderByCode(accessToken, DROPBOX_ROOT, projectCode, rootNamespaceId);
    if (!projectFolderPath) {
      return new Response(JSON.stringify({
        error: `No folder starting with "${projectCode}_" found in ${DROPBOX_ROOT}`,
        folderExists: false,
        rounds: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve scene folder inside the project folder
    const sceneFolderPath = await findFolderByCode(accessToken, projectFolderPath, sceneCode, rootNamespaceId);
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
      headers: dropboxHeaders(accessToken, rootNamespaceId),
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

      // The VS_Visuals folder already gates "this is a visual" — accept
      // both `-VS`-marked names and the bare `CPxxx_SCxx_R0N_0V` form.
      allFiles.push({
        round: parsed.round,
        version: parsed.version,
        filename: entry.name,
        path: entry.path_lower,
        modified_at: entry.server_modified || entry.client_modified,
        size: entry.size,
      });
    }

    // Keep one entry per round (highest version) for the response shape —
    // preserves the admin Dropbox preview UI. The full version set is
    // ingested into round_assets below.
    const byRound = new Map<number, VisualFile>();
    for (const file of allFiles) {
      const existing = byRound.get(file.round);
      if (!existing || file.version > existing.version) {
        byRound.set(file.round, file);
      }
    }
    const rounds = Array.from(byRound.values()).sort((a, b) => a.round - b.round);

    // Sync round_assets + deliver rounds — runs with service role, so no RLS issues.
    const DELIVERED_STATES = ["delivered", "client_review", "approved"];
    const { data: sceneRoundsData } = await supabase
      .from("scene_rounds")
      .select("id, round_number, status")
      .eq("scene_id", sceneId)
      .eq("kind", "production");

    if (sceneRoundsData && sceneRoundsData.length > 0) {
      const roundByNumber = new Map<number, any>(
        sceneRoundsData.map((r: any) => [r.round_number, r]),
      );

      const visualsByRoundId = new Map<string, VisualFile[]>();
      for (const v of allFiles) {
        const dbRound = roundByNumber.get(v.round);
        if (!dbRound) continue;
        const arr = visualsByRoundId.get(dbRound.id) ?? [];
        arr.push(v);
        visualsByRoundId.set(dbRound.id, arr);
      }

      for (const [roundId, visuals] of visualsByRoundId) {
        const dbRound = roundByNumber.get(visuals[0].round);
        if (!dbRound) continue;

        const { data: existingAssets } = await supabase
          .from("round_assets")
          .select("id, dropbox_path, version, is_current")
          .eq("scene_round_id", roundId);

        const existingByPath = new Map(
          (existingAssets ?? []).map((a: any) => [a.dropbox_path, a]),
        );

        // Insert every Dropbox version not yet in the DB. New rows default
        // to is_current=false — admin picks what the client sees via the
        // publish-flag UI. Existing rows are never modified here, so any
        // prior publish choice is preserved.
        for (const v of visuals) {
          if (existingByPath.has(v.path)) continue;
          const { error: insErr } = await supabase.from("round_assets").insert({
            scene_round_id: roundId,
            dropbox_path: v.path,
            dropbox_file_id: v.path,
            filename: v.filename,
            file_size: v.size,
            version: v.version,
            is_current: false,
            source: "dropbox",
          });
          if (insErr) {
            console.error("[scan-visuals] round_assets insert error:", insErr.message, {
              path: v.path, round: v.round, version: v.version,
            });
          }
        }

        // No-current fallback: if NO row in this round is is_current=true
        // (fresh ingest, or admin un-published everything), promote the
        // highest version so the client viewer never sees a dark round.
        const { data: roundAssetsAfter } = await supabase
          .from("round_assets")
          .select("id, version, is_current")
          .eq("scene_round_id", roundId);

        const hasCurrent = (roundAssetsAfter ?? []).some((a: any) => a.is_current);
        if (!hasCurrent && (roundAssetsAfter ?? []).length > 0) {
          const top = (roundAssetsAfter as any[])
            .slice()
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
          const { error: upErr } = await supabase
            .from("round_assets")
            .update({ is_current: true })
            .eq("id", top.id);
          if (upErr) {
            console.error("[scan-visuals] no-current fallback error:", upErr.message, {
              roundId, topId: top.id, version: top.version,
            });
          }
        }

        // Deliver the round if it hasn't been delivered yet
        if (!DELIVERED_STATES.includes(dbRound.status)) {
          const now = new Date();
          // Next Friday at 14:00 after a 2-day buffer
          const earliest = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
          const dayOfWeek = earliest.getDay(); // 0=Sun … 6=Sat
          const daysToFriday = dayOfWeek <= 5 ? (5 - dayOfWeek || 7) : 6;
          const reviewEnd = new Date(earliest);
          reviewEnd.setDate(earliest.getDate() + daysToFriday);
          reviewEnd.setHours(14, 0, 0, 0);

          await supabase.from("scene_rounds").update({
            status: "delivered",
            delivered_at: now.toISOString(),
            end_date: now.toISOString(),
          }).eq("id", dbRound.id);

          // Upsert sibling review round
          const { data: existingReview } = await supabase.from("scene_rounds")
            .select("id")
            .eq("scene_id", sceneId)
            .eq("round_number", dbRound.round_number)
            .eq("kind", "review")
            .maybeSingle();

          if (!existingReview) {
            await supabase.from("scene_rounds").insert({
              scene_id: sceneId,
              round_number: dbRound.round_number,
              kind: "review",
              status: "client_review",
              start_date: now.toISOString(),
              end_date: reviewEnd.toISOString(),
            });
          }

          const { error: logErr } = await supabase.from("activity_log").insert({
            actor_name: "Dropbox",
            actor_role: "system",
            action: "round_delivered",
            description: `Round ${String(dbRound.round_number).padStart(2, "0")} delivered via Dropbox scan — ${scene.name}`,
            scene_id: sceneId,
            scene_name: scene.name,
            project_id: scene.project_id,
            round_number: dbRound.round_number,
          });
          if (logErr) console.warn("activity log (round_delivered) failed", logErr);

          // This branch only runs when the round actually transitions to
          // delivered (gated above by !DELIVERED_STATES.includes). The
          // pending_delivery_notifications partial unique index also
          // protects against duplicate enqueues, so a second scan of the
          // same already-delivered round is a no-op.
          await enqueueDeliveryNotification(supabase, {
            sceneRoundId: dbRound.id,
            sceneId,
            roundNumber: dbRound.round_number,
          });
        }
      }
    }

    // Generate temporary links for each
    const roundsWithLinks = await Promise.all(rounds.map(async (r) => {
      try {
        const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          method: "POST",
          headers: dropboxHeaders(accessToken, rootNamespaceId),
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
