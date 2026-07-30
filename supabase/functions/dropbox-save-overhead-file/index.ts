// dropbox-save-overhead-file/index.ts
//
// Files a staged overhead invoice from Supabase Storage → Kieran's Dropbox
// at /03_Portal_Admin_Docs/03_Invoices/INV002_Payable/02_Overheads/Overheads_{YYYY-MM}_{Month}/.
//
// Two callers:
//   1. AFTER INSERT/UPDATE trigger on public.overheads (see migration
//      20260720000002_overhead_dropbox_filing.sql). Marker: x-trigger-name.
//   2. Frontend "Retry Dropbox upload" button (admin-only). Marker: bearer
//      JWT of an admin user + body { overhead_id }.
//
// Deploy: npx supabase functions deploy dropbox-save-overhead-file \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalOrAdmin } from "../_shared/cronAuth.ts";

const STAGING_BUCKET = "overhead-invoices";
const DROPBOX_ROOT   = "/03_Portal_Admin_Docs/03_Invoices/INV002_Payable/02_Overheads";
const STALE_LOCK_MS  = 5 * 60 * 1000; // 5 minutes

// Fred is confirming the exact month-folder spelling against Kieran's
// existing structure. If any of these need to change (e.g. "Sept" vs
// "September"), edit this array only — the rest of the path logic is fixed.
const MONTH_NAMES = [
  "January", "February", "March",    "April",   "May",      "June",
  "July",    "August",   "September", "October", "November", "December",
];

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trigger-name",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Filename + folder path builders ──────────────────────────────────────────

// ── New AP filename convention ───────────────────────────────────────────────
//   YYYY-MM-DD_AP_VENDOR_InvoiceNo_Description-Period_AmountCCY.ext
//   e.g. 2026-07-03_AP_ADOBE_IEE2026012385380_Creative-Cloud-Jul26_31-19GBP.pdf
// Underscores between fields; hyphens inside them. No spaces, slashes, or £.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short uppercase vendor code — the first meaningful token of the supplier. */
function vendorCode(supplier: string): string {
  const tokens = (supplier ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && /^(the|le|la)$/i.test(tokens[0])) tokens.shift();
  const first = (tokens[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
  return (first || "VENDOR").toUpperCase().slice(0, 14);
}

/** Invoice number for the filename; NOINV when absent. Hyphens kept. */
function invoiceNoPart(s: string | null): string {
  if (!s || !s.trim()) return "NOINV";
  return s.replace(/[\s_/\\:*?"<>|]+/g, "-").replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "NOINV";
}

/** "2026-07-03" → "Jul26" (empty on a bad date). */
function monthLabel(invoiceDate: string): string {
  const m = invoiceDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return "";
  const mon = MONTH_ABBR[parseInt(m[2], 10) - 1] ?? "";
  return mon ? `${mon}${m[1].slice(2)}` : "";
}

/** Description → hyphenated slug of its first few words ("what it was"). */
function descSlug(description: string | null): string {
  if (!description) return "";
  return description
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean).slice(0, 5).join("-").slice(0, 40);
}

/** Gross + currency: (31.19, "GBP") → "31-19GBP". */
function amountCcy(gross: number | null, currency: string | null): string {
  const n = (Number(gross) || 0).toFixed(2).replace(".", "-");
  const ccy = (currency || "GBP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "GBP";
  return `${n}${ccy}`;
}

function buildFilename(row: {
  supplier_name: string; invoice_number: string | null; invoice_date: string;
  description: string | null; gross_amount: number | null; currency: string | null;
}, ext: string): string {
  const descPeriod = [descSlug(row.description) || "Expense", monthLabel(row.invoice_date)].filter(Boolean).join("-");
  const parts = [
    row.invoice_date,                              // YYYY-MM-DD
    "AP",                                          // accounts payable
    vendorCode(row.supplier_name),                 // VENDOR
    invoiceNoPart(row.invoice_number),             // InvoiceNo
    descPeriod,                                    // Description-Period
    amountCcy(row.gross_amount, row.currency),     // AmountCCY
  ];
  return `${parts.join("_")}.${ext}`;
}

/** e.g. "2026-07-15" → "/03_Portal_Admin_Docs/03_Invoices/INV002_Payable/02_Overheads/Overheads_2026-07_July" */
function buildFolderPath(invoiceDate: string): string | null {
  const m = invoiceDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const year   = m[1];
  const monthN = parseInt(m[2], 10);
  if (monthN < 1 || monthN > 12) return null;
  const monthName = MONTH_NAMES[monthN - 1];
  const mm = m[2];
  return `${DROPBOX_ROOT}/Overheads_${year}-${mm}_${monthName}`;
}

// ── Dropbox helpers (mirror dropbox-save-round-files) ───────────────────────

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

async function uploadToDropbox(
  accessToken: string,
  namespaceId: string | null,
  targetPath: string,
  bytes: Uint8Array,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const apiArg = JSON.stringify({
    path: targetPath,
    mode: "add",
    autorename: true,       // collision → append " (1)" etc., never overwrite
    mute: true,
    strict_conflict: false,
  });
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization:    `Bearer ${accessToken}`,
      "Content-Type":   "application/octet-stream",
      "Dropbox-API-Arg": apiArg,
      ...pathRootHeader(namespaceId),
    },
    body: bytes,
  });
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, error: `dropbox upload ${res.status}: ${errText}` };
  }
  const data = await res.json();
  return { ok: true, path: data.path_display ?? targetPath };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")     return json({ success: false, error: "Method not allowed" }, 405);

  const startedAt = Date.now();

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // ── Auth: cron secret (DB trigger, from Vault) OR admin JWT ──────────────
  // The x-trigger-name marker alone is NOT auth — it is a public string. The
  // trigger's header helper sends x-cron-secret alongside it.
  const auth = await requireInternalOrAdmin(req);
  if (!auth.ok) return auth.response;
  const triggerSource: "trigger" | "manual_retry" =
    auth.caller === "admin" ? "manual_retry" : "trigger";

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  // Accept both { overhead_id } and the trigger-shape { record: { id } }.
  const overheadId =
    (body.overhead_id as string | undefined) ??
    ((body.record as { id?: string } | undefined)?.id);
  if (!overheadId || typeof overheadId !== "string") {
    return json({ success: false, error: "overhead_id required" }, 400);
  }

  // ── Fetch the row (post-lock check) ──────────────────────────────────────
  const { data: row, error: fetchErr } = await sb.from("overheads")
    .select("id, supplier_name, invoice_number, invoice_date, description, gross_amount, currency, staging_storage_path, dropbox_path, dropbox_upload_in_progress, dropbox_upload_started_at")
    .eq("id", overheadId)
    .maybeSingle();
  if (fetchErr || !row) {
    return json({ success: false, error: "overhead not found" }, 404);
  }
  if (!row.staging_storage_path || row.dropbox_path) {
    await sb.from("overhead_dropbox_log").insert({
      overhead_id:   overheadId,
      status:        "skipped_not_pending",
      trigger_source: triggerSource,
      duration_ms:   Date.now() - startedAt,
    });
    return json({ success: true, skipped: "not_pending" });
  }

  // ── Lock acquisition (atomic) ────────────────────────────────────────────
  // `dropbox_upload_started_at` serves two purposes: (a) marks a fresh
  // in-flight attempt so a stale/crashed lock older than STALE_LOCK_MS is
  // recoverable; (b) enforces a cooldown between attempts on failure so a
  // persistent Dropbox outage doesn't create a rapid retry loop.
  //
  // - Trigger path: cooldown-aware. Block until started_at is NULL or older
  //   than STALE_LOCK_MS. Prevents runaway loops after failure release.
  // - Manual retry with { force: true }: bypass cooldown but still respect
  //   a fresh in-flight lock (never overlap with an active upload).
  const forceRetry = triggerSource === "manual_retry" && body.force === true;
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  let lockQuery = sb.from("overheads")
    .update({
      dropbox_upload_in_progress: true,
      dropbox_upload_started_at:  new Date().toISOString(),
    })
    .eq("id", overheadId)
    .is("dropbox_path", null)
    .not("staging_storage_path", "is", null);

  lockQuery = forceRetry
    // Force: allow if not in-flight OR the in-flight lock is stale.
    ? lockQuery.or(`dropbox_upload_in_progress.eq.false,dropbox_upload_started_at.lt.${staleCutoff}`)
    // Non-force: cooldown check — allow only if no prior attempt or cooldown expired.
    : lockQuery.or(`dropbox_upload_started_at.is.null,dropbox_upload_started_at.lt.${staleCutoff}`);

  const { data: locked, error: lockErr } = await lockQuery
    .select("id")
    .maybeSingle();
  if (lockErr) {
    return json({ success: false, error: `lock failed: ${lockErr.message}` }, 500);
  }
  if (!locked) {
    await sb.from("overhead_dropbox_log").insert({
      overhead_id:   overheadId,
      status:        "skipped_locked",
      trigger_source: triggerSource,
      duration_ms:   Date.now() - startedAt,
    });
    return json({ success: true, skipped: "locked" });
  }

  // ── Do the work; always release the lock in the wrap-up UPDATE ──────────
  // keepTimestamp=true on failure: leaves dropbox_upload_started_at set so
  // the 5-min cooldown blocks the next trigger fire. Manual retry with
  // force=true can still bypass. On success, timestamp is cleared as normal.
  const releaseLock = async (fields: Record<string, unknown>, keepTimestamp = false) => {
    const update: Record<string, unknown> = {
      dropbox_upload_in_progress: false,
      ...fields,
    };
    if (!keepTimestamp) update.dropbox_upload_started_at = null;
    await sb.from("overheads").update(update).eq("id", overheadId);
  };

  const logAndReturn = async (
    status: "success" | "failed",
    dropboxPath: string | null,
    errorText: string | null,
    httpStatus = 200,
  ) => {
    await sb.from("overhead_dropbox_log").insert({
      overhead_id:    overheadId,
      status,
      dropbox_path:   dropboxPath,
      error_text:     errorText,
      trigger_source: triggerSource,
      duration_ms:    Date.now() - startedAt,
    });
    return json({ success: status === "success", dropbox_path: dropboxPath, error: errorText }, httpStatus);
  };

  try {
    // Path builder (folder + filename)
    const folder = buildFolderPath(row.invoice_date);
    if (!folder) {
      await releaseLock({}, /* keepTimestamp = */ true);
      return await logAndReturn("failed", null, `invalid invoice_date: ${row.invoice_date}`, 400);
    }
    const stagingExt = (row.staging_storage_path.split(".").pop() || "bin").toLowerCase();
    const filename   = buildFilename(row, stagingExt);
    const targetPath = `${folder}/${filename}`;

    // Fetch file bytes from Storage
    const { data: blob, error: dlErr } = await sb.storage
      .from(STAGING_BUCKET)
      .download(row.staging_storage_path);
    if (dlErr || !blob) {
      await releaseLock({}, /* keepTimestamp = */ true);
      return await logAndReturn("failed", null, `storage download failed: ${dlErr?.message ?? "no blob"}`, 500);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Dropbox connection + namespace
    const { data: conn } = await sb.from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) {
      await releaseLock({}, /* keepTimestamp = */ true);
      return await logAndReturn("failed", null, "no dropbox_connections row (admin OAuth not set up)", 500);
    }
    let accessToken = conn.access_token as string;
    const expired = conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now();
    if (expired) {
      const refreshed = await refreshToken(conn as Record<string, string>, sb);
      if (!refreshed) {
        await releaseLock({}, /* keepTimestamp = */ true);
        return await logAndReturn("failed", null, "dropbox token refresh failed", 500);
      }
      accessToken = refreshed;
    }
    const namespaceId = await getRootNamespaceId(accessToken);
    // namespaceId can be null for personal-account Dropbox; upload still works.

    // Upload to Dropbox (autorename handles name collisions)
    const up = await uploadToDropbox(accessToken, namespaceId, targetPath, bytes);
    if (!up.ok) {
      await releaseLock({}, /* keepTimestamp = */ true);
      return await logAndReturn("failed", null, up.error, 502);
    }

    // Success: mirror path onto the row, clear staging, release lock, delete
    // the staging file. Storage deletion is best-effort; row is already
    // consistent (dropbox_path set), so a delete failure just leaves a
    // (queryable) orphan for a periodic sweep later.
    await releaseLock({
      dropbox_path:         up.path,
      staging_storage_path: null,
    });
    const { error: rmErr } = await sb.storage
      .from(STAGING_BUCKET)
      .remove([row.staging_storage_path]);
    if (rmErr) {
      console.warn(`[dropbox-save-overhead-file] storage.remove failed for ${row.staging_storage_path}: ${rmErr.message}`);
    }

    return await logAndReturn("success", up.path, null);
  } catch (err) {
    await releaseLock({}, /* keepTimestamp = */ true);
    const msg = err instanceof Error ? err.message : String(err);
    return await logAndReturn("failed", null, msg, 500);
  }
});
