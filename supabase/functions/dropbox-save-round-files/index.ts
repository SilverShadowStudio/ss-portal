// dropbox-save-round-files/index.ts
//
// Called by a Supabase DB trigger on INSERT to scene_rounds.
// Creates Round-{nn}/ inside the scene's AS_Assets subfolder, then:
//   1. Copies all round_uploads files for this scene from Supabase Storage → Dropbox
//   2. If scene_rounds.instructions is set, generates a PDF and uploads it
//   3. If asset_drawings exist for this round, serialises them as JSON and uploads
//
// Note: round_uploads has scene_id but no round_number column, so all uploads
// for the scene are copied. This mirrors the data model where uploads are
// submitted as part of creating the round and belong to the latest submission.
//
// Deploy: npx supabase functions deploy dropbox-save-round-files \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const PROJECTS_ROOT = "/00_Production/PRD01_Client-Projects";

// ── Dropbox helpers ───────────────────────────────────────────────────────────

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

async function createFolder(
  accessToken: string,
  path: string,
  namespaceId: string | null,
): Promise<void> {
  const res = await fetch(
    "https://api.dropboxapi.com/2/files/create_folder_v2",
    {
      method: "POST",
      headers: dropboxHeaders(accessToken, namespaceId),
      body: JSON.stringify({ path, autorename: false }),
    },
  );
  if (res.ok) return;
  const errText = await res.text();
  if (errText.includes("path/conflict")) {
    console.log(`[dropbox-save-round-files] Folder already exists: ${path}`);
    return;
  }
  throw new Error(`create_folder_v2 failed for ${path}: ${errText}`);
}

async function uploadToDropbox(
  accessToken: string,
  dropboxPath: string,
  content: Uint8Array,
  namespaceId: string | null,
): Promise<void> {
  const apiArg = JSON.stringify({
    path: dropboxPath,
    mode: "overwrite",
    autorename: false,
    mute: true,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/octet-stream",
    "Dropbox-API-Arg": apiArg,
  };
  if (namespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "namespace_id",
      namespace_id: namespaceId,
    });
  }

  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers,
    body: content,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dropbox upload failed for ${dropboxPath}: ${err}`);
  }
}

// Find a folder inside parentPath whose name starts with {prefix}_ (case-insensitive).
async function findFolderByPrefix(
  accessToken: string,
  parentPath: string,
  prefix: string,
  namespaceId: string | null,
): Promise<string | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: dropboxHeaders(accessToken, namespaceId),
    body: JSON.stringify({ path: parentPath, recursive: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const p = prefix.toLowerCase() + "_";
  const match = (data.entries ?? []).find(
    (e: Record<string, unknown>) =>
      e[".tag"] === "folder" &&
      (e.name as string).toLowerCase().startsWith(p),
  );
  return match ? (match.path_display as string) : null;
}

// ── PDF generation ────────────────────────────────────────────────────────────

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) { result.push(""); continue; }
    if (paragraph.length <= maxCharsPerLine) { result.push(paragraph); continue; }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line.length === 0) { line = word; continue; }
      if ((line + " " + word).length <= maxCharsPerLine) {
        line += " " + word;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function spacedCaps(s: string): string {
  return s.split("").join(" ");
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

async function buildInstructionsPdf(
  projectName: string,
  sceneName: string,
  projectCode: string,
  sceneCode: string,
  roundNumber: number,
  roundCreatedAt: string,
  instructions: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4_W = 595.28;
  const A4_H = 841.89;
  const M = 50;
  const CW = A4_W - M * 2;

  const DARK = rgb(0.1, 0.1, 0.1);
  const MID = rgb(0.45, 0.45, 0.45);
  const BG = rgb(0.961, 0.961, 0.969);

  const TOP_M = 60;
  const FOOTER_DIV_Y = 78;
  const CONTENT_BOTTOM = FOOTER_DIV_Y + 22;

  const CONF1 =
    "CONFIDENTIAL: This document contains proprietary information intended for the named recipient only. " +
    "Unauthorized use, disclosure, or distribution is strictly prohibited.";
  const CONF2 = "If received in error, please notify the sender and destroy all copies.";
  const FOOTER_SIZE = 8;
  const FOOTER_LH = 11;

  const footerMaxChars = Math.floor(CW / (FOOTER_SIZE * 0.52));
  const footerLines = [...wrapText(CONF1, footerMaxChars), ...wrapText(CONF2, footerMaxChars)];

  function newPage(): [ReturnType<typeof doc.addPage>, number] {
    const page = doc.addPage([A4_W, A4_H]);
    page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: BG });

    page.drawLine({
      start: { x: M, y: FOOTER_DIV_Y },
      end: { x: A4_W - M, y: FOOTER_DIV_Y },
      thickness: 0.5,
      color: DARK,
    });

    let fy = FOOTER_DIV_Y - 12;
    for (const line of footerLines) {
      if (!line.trim()) { fy -= FOOTER_LH; continue; }
      const tw = font.widthOfTextAtSize(line, FOOTER_SIZE);
      page.drawText(line, { x: (A4_W - tw) / 2, y: fy, size: FOOTER_SIZE, font, color: MID });
      fy -= FOOTER_LH;
    }

    return [page, A4_H - TOP_M];
  }

  let [page, y] = newPage();

  // ── HEADER ────────────────────────────────────────────────────────────────
  const LOGO_SIZE = 17;
  const logoText = spacedCaps("SILVERSHADOW");
  const logoW = boldFont.widthOfTextAtSize(logoText, LOGO_SIZE);
  page.drawText(logoText, { x: (A4_W - logoW) / 2, y, size: LOGO_SIZE, font: boldFont, color: DARK });
  y -= LOGO_SIZE + 5;

  const STUDIO_SIZE = 9;
  const studioText = spacedCaps("STUDIO");
  const studioW = font.widthOfTextAtSize(studioText, STUDIO_SIZE);
  page.drawText(studioText, { x: (A4_W - studioW) / 2, y, size: STUDIO_SIZE, font, color: DARK });
  y -= STUDIO_SIZE + 18;

  // Divider 1 — full width, dark
  page.drawLine({ start: { x: M, y }, end: { x: A4_W - M, y }, thickness: 0.75, color: DARK });
  y -= 22;

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  const TITLE_SIZE = 14;
  const titleText = `${projectName} — ${sceneName}`;
  const titleMaxChars = Math.floor(CW / (TITLE_SIZE * 0.52));
  for (const tl of wrapText(titleText, titleMaxChars)) {
    const tw = boldFont.widthOfTextAtSize(tl, TITLE_SIZE);
    page.drawText(tl, { x: Math.max(M, (A4_W - tw) / 2), y, size: TITLE_SIZE, font: boldFont, color: DARK });
    y -= TITLE_SIZE + 4;
  }
  y -= 10;

  // Divider 2
  page.drawLine({ start: { x: M, y }, end: { x: A4_W - M, y }, thickness: 0.5, color: DARK });
  y -= 22;

  // ── METADATA ──────────────────────────────────────────────────────────────
  const META_SIZE = 9;
  const META_LH = 17;

  const dateLabel = "DATE:   ";
  page.drawText(dateLabel, { x: M, y, size: META_SIZE, font, color: MID });
  page.drawText(formatDate(roundCreatedAt), {
    x: M + font.widthOfTextAtSize(dateLabel, META_SIZE), y,
    size: META_SIZE, font: boldFont, color: DARK,
  });
  y -= META_LH;

  const rnLabel = "ROUND NUMBER:   ";
  page.drawText(rnLabel, { x: M, y, size: META_SIZE, font, color: MID });
  page.drawText(String(roundNumber).padStart(2, "0"), {
    x: M + font.widthOfTextAtSize(rnLabel, META_SIZE), y,
    size: META_SIZE, font: boldFont, color: DARK,
  });
  y -= META_LH + 14;

  // ── BODY ──────────────────────────────────────────────────────────────────
  const BODY_SIZE = 11;
  const BODY_LH = 18;
  const bodyMaxChars = Math.floor(CW / (BODY_SIZE * 0.52));

  for (const line of wrapText(instructions, bodyMaxChars)) {
    if (y < CONTENT_BOTTOM) {
      [page, y] = newPage();
    }
    if (line.trim()) {
      page.drawText(line, { x: M, y, size: BODY_SIZE, font, color: DARK });
    }
    y -= BODY_LH;
  }

  return doc.save();
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json() as { record: Record<string, unknown> };
    const record = body.record;
    const roundId = record.id as string;
    const sceneId = record.scene_id as string;
    const roundNumber = record.round_number as number;
    const instructions = record.instructions as string | null;

    if (!roundId || !sceneId || roundNumber == null) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    console.log(`[dropbox-save-round-files] round=${roundId} scene=${sceneId} number=${roundNumber}`);

    // Get Dropbox connection
    const { data: connection } = await supabase
      .from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .limit(1)
      .maybeSingle();

    if (!connection) {
      console.warn("[dropbox-save-round-files] Dropbox not connected — skipping");
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

    // Resolve scene folder — poll up to 5×2s for scene trigger to finish
    let sceneFolder: string | null = null;
    let sceneName = "";
    let sceneCode = "";
    let projectCode = "";
    let projectName = "";

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: scene } = await supabase
        .from("scenes")
        .select("dropbox_folder, scene_code, project_id, name, projects(name, project_code, dropbox_folder)")
        .eq("id", sceneId)
        .single();

      sceneName = (scene?.name as string) ?? "";
      sceneCode = (scene?.scene_code as string) ?? "";
      const proj = scene?.projects as Record<string, unknown> | null;
      projectCode = (proj?.project_code as string) ?? "";
      projectName = (proj?.name as string) ?? "";

      if (scene?.dropbox_folder) {
        sceneFolder = scene.dropbox_folder as string;
        break;
      }

      // Fallback: resolve via project + scene codes via prefix search
      if (proj?.dropbox_folder && scene?.scene_code) {
        sceneFolder = await findFolderByPrefix(
          accessToken,
          proj.dropbox_folder as string,
          scene.scene_code as string,
          namespaceId,
        );
        if (sceneFolder) break;
      }

      if (attempt < 4) {
        console.log(`[dropbox-save-round-files] scene.dropbox_folder not set yet, waiting… (attempt ${attempt + 1})`);
        await delay(2000);
      }
    }

    if (!sceneFolder) {
      throw new Error(
        `Cannot resolve Dropbox folder for scene ${sceneId}. ` +
        "Ensure dropbox-create-scene-folder has run successfully first.",
      );
    }

    const roundPad = String(roundNumber).padStart(2, "0");
    const roundFolderPath = `${sceneFolder}/INS_Instructions/Round-${roundPad}`;

    console.log(`[dropbox-save-round-files] Creating round folder: ${roundFolderPath}`);
    await createFolder(accessToken, roundFolderPath, namespaceId);

    const CATEGORY_FOLDERS: Record<string, string> = {
      floor_plan:               "Floor-Plan",
      elevations:               "Elevations",
      rcp:                      "Reflected-Ceiling-Plan",
      finishes_schedule:        "Finishes-Schedule",
      furniture_schedule:       "Furniture-Schedule",
      lighting_plan:            "Lighting-Plan",
      lighting_mood_reference:  "Lighting-Mood-Reference",
      models_3d:                "3D-Models",
      cgi_package:              "CGI-Package",
    };

    let filesCopied = 0;
    let filesErrored = 0;

    // ── 1. Copy round_uploads files ───────────────────────────────────────────
    const { data: uploads } = await supabase
      .from("round_uploads")
      .select("file_name, storage_path, category")
      .eq("scene_id", sceneId)
      .order("created_at", { ascending: true });

    // Pre-create one subfolder per category that has at least one file
    const categoriesPresent = new Set(
      (uploads ?? []).map((u) => u.category as string).filter(Boolean),
    );
    const createdFolders = new Set<string>();
    for (const cat of categoriesPresent) {
      const folderName = CATEGORY_FOLDERS[cat];
      if (!folderName) continue;
      const folderPath = `${roundFolderPath}/${folderName}`;
      await createFolder(accessToken, folderPath, namespaceId);
      createdFolders.add(cat);
    }

    for (const upload of uploads ?? []) {
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from("round-uploads")
          .download(upload.storage_path as string);

        if (dlErr || !fileData) {
          console.warn(
            `[dropbox-save-round-files] Failed to download ${upload.storage_path}: ${dlErr?.message}`,
          );
          filesErrored++;
          continue;
        }

        const bytes = new Uint8Array(await fileData.arrayBuffer());
        const cat = upload.category as string;
        const folderName = CATEGORY_FOLDERS[cat];
        const targetFolder = folderName ? `${roundFolderPath}/${folderName}` : roundFolderPath;
        const dropboxPath = `${targetFolder}/${upload.file_name}`;
        await uploadToDropbox(accessToken, dropboxPath, bytes, namespaceId);
        filesCopied++;
        console.log(`[dropbox-save-round-files] Uploaded: ${upload.file_name} → ${targetFolder}`);
      } catch (e) {
        console.error(
          `[dropbox-save-round-files] Error uploading ${upload.file_name}:`,
          e instanceof Error ? e.message : e,
        );
        filesErrored++;
      }
    }

    // ── 2. Generate instructions PDF ──────────────────────────────────────────
    if (instructions) {
      try {
        const roundCreatedAt = (record.created_at as string) ?? new Date().toISOString();
        const pdfBytes = await buildInstructionsPdf(
          projectName, sceneName, projectCode, sceneCode,
          roundNumber, roundCreatedAt, instructions,
        );
        const pdfName = `${projectCode}-${sceneCode}_Round-${roundPad}_Instructions.pdf`;
        const pdfPath = `${roundFolderPath}/${pdfName}`;
        await uploadToDropbox(accessToken, pdfPath, pdfBytes, namespaceId);
        console.log(`[dropbox-save-round-files] Instructions PDF uploaded: ${pdfPath}`);
      } catch (e) {
        console.error(
          "[dropbox-save-round-files] Failed to generate/upload instructions PDF:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    // ── 3. Serialise asset_drawings as JSON ───────────────────────────────────
    const { data: drawings } = await supabase
      .from("asset_drawings")
      .select("id, asset_id, created_by, points, color, created_at")
      .eq("scene_round_id", roundId);

    if (drawings && drawings.length > 0) {
      try {
        const jsonBytes = new TextEncoder().encode(
          JSON.stringify({ round_id: roundId, strokes: drawings }, null, 2),
        );
        const jsonPath = `${roundFolderPath}/Round-${roundPad}_Annotations.json`;
        await uploadToDropbox(accessToken, jsonPath, jsonBytes, namespaceId);
        console.log(
          `[dropbox-save-round-files] Annotations JSON uploaded: ${drawings.length} strokes`,
        );
      } catch (e) {
        console.error(
          "[dropbox-save-round-files] Failed to upload annotations JSON:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    console.log(
      `[dropbox-save-round-files] Done. files=${filesCopied} errors=${filesErrored} ` +
      `instructions=${!!instructions} drawings=${drawings?.length ?? 0}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        roundFolderPath,
        filesCopied,
        filesErrored,
        instructionsPdf: !!instructions,
        annotationsJson: (drawings?.length ?? 0) > 0,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dropbox-save-round-files] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
