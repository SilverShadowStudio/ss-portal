// dropbox-save-invoice-file/index.ts
//
// Files an OUTGOING (receivable) invoice PDF to Dropbox at
// /03_Portal_Admin_Docs/03_Invoices/INV001_Receivable/Invoices-Outgoing_{YYYY-MM}_{Month}/
// named SilverShadowStudio_Invoice_{ref}.pdf.
//
// The PDF is generated server-side via the same generateInvoicePdfV2 used by
// download-invoice-pdf (identical design), so filing and download stay in sync.
// Dropbox upload logic mirrors dropbox-save-overhead-file.
//
// Callers:
//   1. Admin "File to Dropbox" action — bearer JWT of an admin user + { invoice_id }.
//   2. (future) AFTER UPDATE trigger on invoices when an invoice is issued —
//      marker: x-trigger-name: invoice_filing_pending, body { record: { id } }.
//
// Deploy: npx supabase functions deploy dropbox-save-invoice-file \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type InvoiceLineItem } from "../_shared/documents/invoicePdf.ts";
import { generateInvoicePdfV3 } from "../_shared/documents/invoicePdfV3.ts";
import { requireInternalOrAdmin } from "../_shared/cronAuth.ts";

const DROPBOX_ROOT = "/03_Portal_Admin_Docs/03_Invoices/INV001_Receivable";

const MONTH_NAMES = [
  "January", "February", "March",    "April",   "May",      "June",
  "July",    "August",   "September", "October", "November", "December",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trigger-name",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Filename + folder path builders ──────────────────────────────────────────

// ── AR filename convention ───────────────────────────────────────────────────
//   YYYY-MM-DD_AR_CLIENT_InvoiceNo_AmountCCY.ext
//   e.g. 2026-07-08_AR_KATHERINE-POOLEY_KAT025-C_1600-00GBP.pdf
// Underscores between fields; hyphens within. No spaces, slashes, or £.

/** Sanitize the invoice number; keeps hyphens (KAT025-C). NOINV when absent. */
function sanitizeRef(s: string | null): string {
  if (!s || !s.trim()) return "NOINV";
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[\s_/\\:*?"<>|]+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40) || "NOINV";
}

/** Client label: the first 1–2 words of the name, uppercased and hyphen-joined
 *  (Katherine Pooley → KATHERINE-POOLEY). Drops parenthetical and legal-form
 *  tokens ((SARL), Ltd, …). */
const LEGAL_SUFFIX = /^(ltd|limited|inc|llc|plc|gmbh|sarl|sa|sas|sl|bv|oy|ab|ug|co)$/i;
function clientCode(name: string | null): string {
  const cleaned = (name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")   // drop "(SARL)" etc.
    .replace(/&/g, "and");
  const tokens = cleaned.split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .filter((t) => !LEGAL_SUFFIX.test(t));
  return tokens.slice(0, 2).join("-").toUpperCase() || "CLIENT";
}

/** Gross + currency: (1600, "GBP") → "1600-00GBP". */
function amountCcy(gross: number | null, currency: string | null): string {
  const n = (Number(gross) || 0).toFixed(2).replace(".", "-");
  const ccy = (currency || "GBP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "GBP";
  return `${n}${ccy}`;
}

/** YYYY-MM-DD out of a date or timestamp string. */
function isoDatePart(dateStr: string | null): string | null {
  const m = String(dateStr || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function buildFilename(opts: {
  date: string; client: string | null; invoiceNo: string | null; gross: number | null; currency: string | null; ext: string;
}): string {
  return `${opts.date}_AR_${clientCode(opts.client)}_${sanitizeRef(opts.invoiceNo)}_${amountCcy(opts.gross, opts.currency)}${opts.ext}`;
}

/** An ISO timestamp or date → the "Invoices-Outgoing_{YYYY-MM}_{Month}" folder. */
function buildFolderPath(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const monthN = d.getUTCMonth() + 1; // 1-12
  const mm = String(monthN).padStart(2, "0");
  const monthName = MONTH_NAMES[monthN - 1];
  return `${DROPBOX_ROOT}/Invoices-Outgoing_${year}-${mm}_${monthName}`;
}

// ── Dropbox helpers (mirror dropbox-save-overhead-file) ──────────────────────

async function refreshToken(
  connection: Record<string, string>,
  sb: ReturnType<typeof createClient>,
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
    autorename: true, // collision → append " (1)" etc., never overwrite
    mute: true,
    strict_conflict: false,
  });
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
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
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // ── Auth: cron secret (DB trigger, from Vault) OR admin JWT ──────────────
  // The x-trigger-name marker alone is NOT auth — it is a public string. The
  // trigger's header helper sends x-cron-secret alongside it.
  const auth = await requireInternalOrAdmin(req);
  if (!auth.ok) return auth.response;

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  const invoiceId =
    (body.invoice_id as string | undefined) ??
    ((body.record as { id?: string } | undefined)?.id);
  if (!invoiceId || typeof invoiceId !== "string") {
    return json({ success: false, error: "invoice_id required" }, 400);
  }

  try {
    // ── Fetch invoice + client (mirrors download-invoice-pdf) ──────────────
    const { data: invoice, error: invErr } = await sb
      .from("invoices")
      .select(
        "id, type, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, paid_at, notes, line_items, subtotal, vat_rate, vat_amount, account_id, bank_account, stripe_checkout_url, project_id, quotation_id, dropbox_path",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return json({ success: false, error: "invoice not found" }, 404);
    // Already filed — skip (the auto-file trigger fires on any UPDATE while unfiled).
    if ((invoice as any).dropbox_path) {
      return json({ success: true, skipped: "already_filed", dropbox_path: (invoice as any).dropbox_path });
    }

    let clientCompany: string | null = null;
    let clientAddress: string | null = null;
    let clientCountry: string | null = null;
    let clientRegistration: string | null = null;
    let clientName: string | null = null;
    let clientPosition: string | null = null;
    let clientEmail: string | null = null;

    if (invoice.account_id) {
      const { data: account } = await sb
        .from("accounts")
        .select("company_name, registration_number, street_name, building_number, city, postcode, country, owner_user_id")
        .eq("id", invoice.account_id)
        .maybeSingle();
      if (account) {
        clientCompany = account.company_name ?? null;
        clientRegistration = account.registration_number ?? null;
        clientCountry = account.country ?? null;
        const street = [account.building_number, account.street_name].filter(Boolean).join(" ");
        const cityLine = [account.postcode, account.city].filter(Boolean).join(" ");
        clientAddress = [street, cityLine].filter(Boolean).join("\n") || null;
        if (account.owner_user_id) {
          const { data: profile } = await sb
            .from("profiles")
            .select("first_name, last_name, full_name, position")
            .eq("user_id", account.owner_user_id)
            .maybeSingle();
          if (profile) {
            clientName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.full_name || null;
            clientPosition = profile.position ?? null;
          }
          const { data: authUser } = await sb.auth.admin.getUserById(account.owner_user_id);
          clientEmail = authUser?.user?.email ?? null;
        }
      }
    }

    // ── Path folder ─────────────────────────────────────────────────────────
    const folder = buildFolderPath(invoice.issued_at ?? invoice.created_at);
    if (!folder) return json({ success: false, error: `invalid invoice date` }, 400);

    // ── PDF bytes ──────────────────────────────────────────────────────────
    // External (uploaded) income invoices are raised outside the portal (Xero),
    // so we file the ORIGINAL upload from Storage — a generated PDF would be
    // blank (no client account). Portal invoices are generated in-house.
    let pdfBytes: Uint8Array;
    let fileExt = ".pdf";
    if ((invoice as any).type === "external") {
      const { data: files, error: listErr } = await sb.storage
        .from("income-invoices").list("", { search: invoiceId, limit: 100 });
      if (listErr) return json({ success: false, error: `storage list failed: ${listErr.message}` }, 500);
      const orig = files?.find((f) => f.name.startsWith(invoiceId));
      if (!orig) {
        // Original not uploaded yet (e.g. the auto-file trigger fired on insert
        // before the frontend finished uploading). The explicit call the upload
        // flow makes after the upload will file it — skip quietly for now.
        return json({ success: true, skipped: "awaiting_original" });
      }
      const { data: blob, error: dlErr } = await sb.storage
        .from("income-invoices").download(orig.name);
      if (dlErr || !blob) {
        return json({ success: false, error: `original download failed: ${dlErr?.message ?? "no data"}` }, 500);
      }
      pdfBytes = new Uint8Array(await blob.arrayBuffer());
      const dot = orig.name.lastIndexOf(".");
      if (dot > -1) fileExt = orig.name.slice(dot).toLowerCase();
    } else {
      // ── Generate the PDF (identical design to download-invoice-pdf) ───────
      // Project: prefer the direct link, else derive it from the quote.
      let projectName: string | null = null;
      let projId: string | null = (invoice as any).project_id ?? null;
      if (!projId && (invoice as any).quotation_id) {
        const { data: q } = await sb
          .from("quotation_documents").select("project_id").eq("id", (invoice as any).quotation_id).maybeSingle();
        projId = (q as any)?.project_id ?? null;
      }
      if (projId) {
        const { data: project } = await sb
          .from("projects").select("name").eq("id", projId).maybeSingle();
        projectName = project?.name ?? null;
      }
      const items = Array.isArray(invoice.line_items) ? (invoice.line_items as InvoiceLineItem[]) : [];
      pdfBytes = generateInvoicePdfV3({
        invoice_number: invoice.invoice_number,
        reference_number: invoice.reference_number,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        due_date: invoice.due_date,
        issued_at: invoice.issued_at,
        created_at: invoice.created_at,
        paid_at: (invoice as any).paid_at ?? null,
        notes: invoice.notes,
        line_items: items,
        client_company: clientCompany,
        client_name: clientName,
        client_address: clientAddress,
        client_country: clientCountry,
        client_registration: clientRegistration,
        client_email: clientEmail,
        client_position: clientPosition,
        subtotal: invoice.subtotal,
        vat_rate: invoice.vat_rate,
        vat_amount: invoice.vat_amount,
        bank_account: (invoice as any).bank_account,
        project_name: projectName,
        stripe_url: (invoice as any).stripe_checkout_url ?? null,
      });
    }
    // AR filename: date_AR_CLIENT_InvoiceNo_AmountCCY. Client comes from the
    // uploaded invoice's notes (external) or the linked account (portal).
    const dateIso = isoDatePart(invoice.issued_at ?? invoice.created_at) ?? "0000-00-00";
    const party = ((invoice as any).type === "external" ? invoice.notes : (clientCompany || clientName))
      || clientName || clientCompany || invoice.notes || null;
    const targetPath = `${folder}/${buildFilename({
      date: dateIso,
      client: party,
      invoiceNo: invoice.invoice_number || invoice.reference_number || null,
      gross: Number(invoice.amount),
      currency: invoice.currency,
      ext: fileExt,
    })}`;

    // ── Dropbox connection + namespace ─────────────────────────────────────
    const { data: conn } = await sb.from("dropbox_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) return json({ success: false, error: "no dropbox_connections row (admin OAuth not set up)" }, 500);
    let accessToken = conn.access_token as string;
    const expired = conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now();
    if (expired) {
      const refreshed = await refreshToken(conn as Record<string, string>, sb);
      if (!refreshed) return json({ success: false, error: "dropbox token refresh failed" }, 500);
      accessToken = refreshed;
    }
    const namespaceId = await getRootNamespaceId(accessToken);

    // ── Upload (autorename handles collisions) ─────────────────────────────
    const up = await uploadToDropbox(accessToken, namespaceId, targetPath, pdfBytes);
    if (!up.ok) return json({ success: false, error: up.error }, 502);

    // Record the filed path so the row reads as filed and the trigger stops firing.
    await sb.from("invoices").update({ dropbox_path: up.path }).eq("id", invoiceId);
    return json({ success: true, dropbox_path: up.path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 500);
  }
});
