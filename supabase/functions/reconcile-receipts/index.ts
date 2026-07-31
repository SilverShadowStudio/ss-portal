// reconcile-receipts
//
// Reconciles the files under Dropbox /03_Portal_Admin_Docs/03_Invoices against
// bank_transactions (Revolut). Read-only in this phase: it catalogs every file,
// parses an identifier / amount+date from the filename, matches to a bank line,
// and records which transactions are missing a receipt and which files are
// orphans (no matching bank line). Auto-rename + AI parsing of messy filenames
// are a later phase — nothing here mutates Dropbox.
//
// Actions (invoke body { action }): scan, list.
// Auth: admin only.
//
// Deploy: npx supabase functions deploy reconcile-receipts \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const INVOICES_ROOT = "/03_Portal_Admin_Docs/03_Invoices";

// ── Dropbox plumbing (shared admin connection; refresh + team namespace) ───────
async function refreshDropboxToken(sb: ReturnType<typeof createClient>, conn: Record<string, unknown>): Promise<string | null> {
  const key = Deno.env.get("DROPBOX_APP_KEY")!, secret = Deno.env.get("DROPBOX_APP_SECRET")!;
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token as string }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
  await sb.from("dropbox_connections").update({ access_token: t.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("id", conn.id);
  return t.access_token;
}

async function getNamespaceHeader(sb: ReturnType<typeof createClient>, token: string): Promise<Record<string, string>> {
  const { data: s } = await sb.from("app_settings").select("value").eq("key", "dropbox_root_namespace").maybeSingle();
  let ns = (s?.value as { namespace_id?: string } | null)?.namespace_id ?? null;
  if (!ns) {
    const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) ns = (await r.json())?.root_info?.root_namespace_id ?? null;
  }
  return ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {};
}

interface DbxFile { id: string; name: string; path_display: string; size: number; content_hash: string }
async function listAllFiles(token: string, nsHeader: Record<string, string>, root: string): Promise<DbxFile[]> {
  const out: DbxFile[] = [];
  const base = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...nsHeader };
  let r = await fetch("https://api.dropboxapi.com/2/files/list_folder", { method: "POST", headers: base, body: JSON.stringify({ path: root, recursive: true, limit: 500 }) });
  if (!r.ok) throw new Error(`list_folder ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let data = await r.json();
  const collect = (d: { entries?: { ".tag": string }[] }) => {
    for (const e of (d.entries ?? []) as (DbxFile & { ".tag": string })[]) if (e[".tag"] === "file") out.push({ id: e.id, name: e.name, path_display: e.path_display, size: e.size, content_hash: e.content_hash });
  };
  collect(data);
  while (data.has_more) {
    r = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", { method: "POST", headers: base, body: JSON.stringify({ cursor: data.cursor }) });
    if (!r.ok) throw new Error(`list_folder/continue ${r.status}`);
    data = await r.json();
    collect(data);
  }
  return out;
}

// Acquire a fresh Dropbox token + team-namespace header (shared admin connection).
async function getDropbox(sb: ReturnType<typeof createClient>): Promise<{ token: string; nsHeader: Record<string, string> } | null> {
  const { data: conn } = await sb.from("dropbox_connections").select("id, access_token, refresh_token, token_expires_at").limit(1).maybeSingle();
  if (!conn) return null;
  let token = conn.access_token as string;
  if (!conn.token_expires_at || new Date(conn.token_expires_at as string).getTime() < Date.now() + 120000) {
    token = (await refreshDropboxToken(sb, conn)) ?? token;
  }
  return { token, nsHeader: await getNamespaceHeader(sb, token) };
}

async function getTempLink(token: string, nsHeader: Record<string, string>, path: string): Promise<string | null> {
  const r = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...nsHeader },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) return null;
  return (await r.json())?.link ?? null;
}

// Rename a file in place (same folder) to `newName`. Returns the new path_display.
async function renameFile(token: string, nsHeader: Record<string, string>, fromPath: string, newName: string): Promise<string | null> {
  const folder = fromPath.slice(0, fromPath.lastIndexOf("/"));
  const toPath = `${folder}/${newName}`;
  if (toPath === fromPath) return fromPath;
  const r = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...nsHeader },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: true }),
  });
  if (!r.ok) return null;
  return (await r.json())?.metadata?.path_display ?? toPath;
}

// AP-convention filename: YYYY-MM-DD_AP_VENDOR_InvoiceNo_AmountCCY.ext
function apName(vendor: string | null, invoiceNo: string | null, dateIso: string | null, amount: number | null, ccy: string | null, ext: string): string {
  const v = (vendor || "VENDOR").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 16) || "VENDOR";
  const inv = invoiceNo ? invoiceNo.toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 24) : "NOINV";
  const amt = amount != null ? Math.abs(amount).toFixed(2).replace(".", "-") : "0-00";
  const d = dateIso || "undated";
  return `${d}_AP_${v}_${inv}_${amt}${ccy || "GBP"}.${ext}`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function mimeOf(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  return null; // skip unsupported (docx, xlsx, heic…)
}

// ── Filename parsing ──────────────────────────────────────────────────────────
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function classifySide(path: string): string {
  const p = path.toLowerCase();
  if (p.includes("/inv001_receivable/")) return "receivable";
  if (p.includes("/02_overheads")) return "payable_overhead";
  if (p.includes("/01_freelancers")) return "payable_freelancer";
  return "other";
}

interface Parsed { invoiceNo: string | null; amount: number | null; date: string | null; vendor: string | null; source: "filename" }
function parseFilename(side: string, name: string): Parsed {
  const p: Parsed = { invoiceNo: null, amount: null, date: null, vendor: null, source: "filename" };
  // Receivable: "... - Invoice <NUM>.<ext>"
  const inv = name.match(/Invoice\s+(.+?)\.(pdf|jpe?g|png)$/i);
  if (side === "receivable" && inv) { p.invoiceNo = inv[1].trim(); return p; }
  // AP convention: YYYY-MM-DD_AP_VENDOR_..._<amount><CCY>.ext  (amount uses - for decimal point)
  const ap = name.match(/^(\d{4}-\d{2}-\d{2})_AP_([^_]+)_.*?_([0-9]+(?:-[0-9]{2})?)([A-Z]{3})\.[^.]+$/);
  if (ap) { p.date = ap[1]; p.vendor = ap[2]; p.amount = parseFloat(ap[3].replace("-", ".")); return p; }
  // Generic fallbacks — a date in the name; an amount if clearly present.
  const d = name.match(/(\d{4}-\d{2}-\d{2})/) || name.match(/(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})/);
  if (d) {
    if (d.length === 2) p.date = d[1];
    else p.date = `${d[3]}-${String(d[2]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`;
  }
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return json({ error: "Unauthorized" }, 401);
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  try {
    if (action === "scan") {
      // 1. Dropbox token (refresh if expiring within 2 min).
      const { data: conn } = await sb.from("dropbox_connections").select("id, access_token, refresh_token, token_expires_at").limit(1).maybeSingle();
      if (!conn) return json({ error: "Dropbox not connected" }, 400);
      let token = conn.access_token as string;
      if (!conn.token_expires_at || new Date(conn.token_expires_at as string).getTime() < Date.now() + 120000) {
        token = (await refreshDropboxToken(sb, conn)) ?? token;
      }
      const nsHeader = await getNamespaceHeader(sb, token);

      // 2. List every file under 03_Invoices, catalog it.
      const files = await listAllFiles(token, nsHeader, INVOICES_ROOT);
      const rows = files.map((f) => {
        const side = classifySide(f.path_display);
        const parsed = parseFilename(side, f.name);
        return {
          id: f.id, path: f.path_display, name: f.name, size: f.size, content_hash: f.content_hash, side,
          parsed_invoice_no: parsed.invoiceNo ? alnum(parsed.invoiceNo) : null,
          parsed_amount: parsed.amount, parsed_date: parsed.date, parsed_vendor: parsed.vendor,
          parse_source: "filename", updated_at: new Date().toISOString(),
        };
      });
      for (let i = 0; i < rows.length; i += 200) {
        await sb.from("dropbox_invoice_files").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      }

      // 3. Load in-scope bank transactions + overhead receipt links.
      const { data: txns } = await sb.from("bank_transactions")
        .select("id, amount, date_completed, counterparty, reference, classification, matched_id, matched_type")
        .in("classification", ["client_income", "expense"]);
      // Overheads that already have a filed receipt (dropbox_path) carry the
      // structured amount + date to match against expense bank lines.
      const { data: ohs } = await sb.from("overheads")
        .select("id, gross_amount, invoice_date, payment_date, dropbox_path")
        .not("dropbox_path", "is", null);

      // 4. Match. Reset previous matches first so re-scan is idempotent.
      await sb.from("bank_transactions").update({ receipt_dropbox_path: null }).not("receipt_dropbox_path", "is", null);
      await sb.from("dropbox_invoice_files").update({ matched_txn_id: null, status: "unmatched", match_confidence: null }).neq("status", "ignored");
      const dbFiles = rows;
      const filesByPath = new Map<string, typeof dbFiles[number]>();
      dbFiles.forEach((f) => filesByPath.set(f.path, f));
      const usedTxn = new Set<string>();
      const usedFile = new Set<string>();
      const fileUpdates: { id: string; matched_txn_id: string; status: string; match_confidence: string }[] = [];
      const txnReceipt: { id: string; path: string }[] = [];
      const link = (fileId: string, txnId: string, path: string, conf: string) => {
        usedTxn.add(txnId); usedFile.add(fileId);
        fileUpdates.push({ id: fileId, matched_txn_id: txnId, status: "matched", match_confidence: conf });
        txnReceipt.push({ id: txnId, path });
      };

      // 4a. Receivable → income: the file's invoice number appears in the txn
      //     reference (references carry it, e.g. ref "KAT025 B" ↔ file "KAT025B").
      const receivableFiles = dbFiles.filter((f) => f.side === "receivable" && f.parsed_invoice_no && f.parsed_invoice_no.length >= 5);
      for (const t of txns ?? []) {
        if (t.classification !== "client_income") continue;
        const ref = alnum(String(t.reference ?? ""));
        if (!ref) continue;
        const f = receivableFiles.find((f) => !usedFile.has(f.id) && ref.includes(f.parsed_invoice_no!));
        if (f) link(f.id, t.id, f.path, "invoice_no");
      }

      // 4b. Expense → overhead receipt: match an expense bank line to an overhead
      //     that has a filed receipt, by amount + date (overheads carry
      //     gross_amount + invoice/payment date). No reliance on the reference link.
      const expenses = (txns ?? []).filter((t) => t.classification === "expense");
      for (const oh of ohs ?? []) {
        const file = filesByPath.get(oh.dropbox_path as string);
        if (!file || usedFile.has(file.id)) continue;
        const amt = Number(oh.gross_amount);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const ohDate = (oh.payment_date ?? oh.invoice_date) as string | null;
        let best: typeof expenses[number] | null = null; let bestGap = Infinity;
        for (const t of expenses) {
          if (usedTxn.has(t.id)) continue;
          if (Math.abs(Math.abs(Number(t.amount)) - amt) > 0.01) continue;
          const gap = ohDate && t.date_completed ? Math.abs(new Date(t.date_completed as string).getTime() - new Date(ohDate).getTime()) / 86400000 : 0;
          if (gap <= 21 && gap < bestGap) { best = t; bestGap = gap; }
        }
        if (best) link(file.id, best.id, file.path, "overhead_amount_date");
      }

      // 5. Persist matches.
      for (const fu of fileUpdates) await sb.from("dropbox_invoice_files").update({ matched_txn_id: fu.matched_txn_id, status: fu.status, match_confidence: fu.match_confidence }).eq("id", fu.id);
      for (const tr of txnReceipt) await sb.from("bank_transactions").update({ receipt_dropbox_path: tr.path }).eq("id", tr.id);

      const inScope = (txns ?? []).length;
      return json({
        ok: true, filesCataloged: rows.length, matched: fileUpdates.length,
        txnsInScope: inScope, txnsMissingReceipt: inScope - txnReceipt.length,
        orphanFiles: rows.filter((r) => r.side !== "other").length - fileUpdates.length,
      });
    }

    if (action === "ai-parse") {
      // Batch: read a chunk of still-unmatched payable receipt files through the
      // parse-document AI extractor, then match by amount+date and auto-rename
      // confident matches to the AP standard. The frontend loops until remaining=0.
      const batch = Math.min(Math.max(Number(body?.batch) || 8, 1), 15);
      const dryRun = body?.dryRun === true; // parse + match but do NOT rename files
      const dbx = await getDropbox(sb);
      if (!dbx) return json({ error: "Dropbox not connected" }, 400);

      const { data: todo } = await sb.from("dropbox_invoice_files")
        .select("id, path, name, side, parse_source")
        .in("side", ["payable_overhead", "payable_freelancer"])
        .eq("status", "unmatched")
        .neq("parse_source", "ai")
        .limit(batch);
      const files = todo ?? [];

      const { data: expenses } = await sb.from("bank_transactions")
        .select("id, amount, date_completed, receipt_dropbox_path")
        .eq("classification", "expense").is("receipt_dropbox_path", null);
      const used = new Set<string>();

      let processed = 0, matched = 0, renamed = 0;
      for (const f of files) {
        processed++;
        const mime = mimeOf(f.name as string);
        // Mark as AI-attempted regardless, so the batch loop advances.
        let parsed: { amount: number | null; date: string | null; vendor: string | null; invoiceNo: string | null; currency: string | null } = { amount: null, date: null, vendor: null, invoiceNo: null, currency: null };
        if (mime) {
          try {
            const link = await getTempLink(dbx.token, dbx.nsHeader, f.path as string);
            if (link) {
              const fr = await fetch(link);
              const bytes = new Uint8Array(await fr.arrayBuffer());
              if (bytes.length <= 15_000_000) {
                const pr = await fetch(`${supabaseUrl}/functions/v1/parse-document`, {
                  method: "POST",
                  headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
                  body: JSON.stringify({ document_type: "overhead", file_data_base64: toBase64(bytes), file_mime_type: mime }),
                });
                const pj = await pr.json().catch(() => ({}));
                const d = pj?.data ?? pj?.result ?? pj;
                if (d && (d.gross_total != null || d.invoice_date)) {
                  parsed = {
                    amount: d.gross_total != null ? Number(d.gross_total) : null,
                    date: (d.payment_date || d.invoice_date || null) as string | null,
                    vendor: d.supplier_name ?? null, invoiceNo: d.invoice_number ?? null,
                    currency: d.currency ?? null,
                  };
                }
              }
            }
          } catch { /* parse hiccup — leave unparsed, still marked ai */ }
        }

        await sb.from("dropbox_invoice_files").update({
          parse_source: "ai", parsed_amount: parsed.amount, parsed_date: parsed.date,
          parsed_vendor: parsed.vendor, parsed_invoice_no: parsed.invoiceNo ? alnum(parsed.invoiceNo) : null,
          updated_at: new Date().toISOString(),
        }).eq("id", f.id);

        // Match by amount (+ date window) to an expense.
        if (parsed.amount != null && parsed.amount > 0) {
          let best: { id: string; date_completed: string | null } | null = null; let bestGap = Infinity;
          for (const t of expenses ?? []) {
            if (used.has(t.id)) continue;
            if (Math.abs(Math.abs(Number(t.amount)) - parsed.amount) > 0.01) continue;
            const gap = parsed.date && t.date_completed ? Math.abs(new Date(t.date_completed as string).getTime() - new Date(parsed.date).getTime()) / 86400000 : 0;
            if (gap <= 21 && gap < bestGap) { best = t; bestGap = gap; }
          }
          if (best) {
            used.add(best.id); matched++;
            const ext = (f.name as string).split(".").pop() || "pdf";
            const newName = apName(parsed.vendor, parsed.invoiceNo, parsed.date ?? best.date_completed, parsed.amount, parsed.currency, ext);
            const newPath = dryRun ? (f.path as string) : await renameFile(dbx.token, dbx.nsHeader, f.path as string, newName);
            if (newPath && newPath !== f.path) renamed++;
            await sb.from("dropbox_invoice_files").update({
              matched_txn_id: best.id, status: "matched", match_confidence: "ai_amount_date",
              path: newPath ?? f.path, renamed_from: newPath && newPath !== f.path ? f.path : null,
              renamed_to: newPath && newPath !== f.path ? newPath : null, renamed_at: newPath && newPath !== f.path ? new Date().toISOString() : null,
            }).eq("id", f.id);
            await sb.from("bank_transactions").update({ receipt_dropbox_path: newPath ?? f.path }).eq("id", best.id);
          }
        }
      }

      const { count: remaining } = await sb.from("dropbox_invoice_files")
        .select("id", { count: "exact", head: true })
        .in("side", ["payable_overhead", "payable_freelancer"]).eq("status", "unmatched").neq("parse_source", "ai");
      return json({ ok: true, processed, matched, renamed, remaining: remaining ?? 0 });
    }

    if (action === "list") {
      const { data: missing } = await sb.from("bank_transactions")
        .select("id, date_completed, amount, counterparty, reference, classification")
        .in("classification", ["client_income", "expense"])
        .is("receipt_dropbox_path", null)
        .order("date_completed", { ascending: false });
      const { data: orphans } = await sb.from("dropbox_invoice_files")
        .select("id, name, path, side, parsed_invoice_no, parsed_amount, parsed_date")
        .eq("status", "unmatched").neq("side", "other")
        .order("name");
      const { count: matchedCount } = await sb.from("dropbox_invoice_files").select("id", { count: "exact", head: true }).eq("status", "matched");
      return json({
        missing: (missing ?? []).map((m) => ({ id: m.id, date: m.date_completed, amount: Number(m.amount), counterparty: m.counterparty, reference: m.reference, kind: m.classification })),
        orphans: (orphans ?? []).map((o) => ({ id: o.id, name: o.name, path: o.path, side: o.side, invoiceNo: o.parsed_invoice_no, amount: o.parsed_amount, date: o.parsed_date })),
        matched: matchedCount ?? 0,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
