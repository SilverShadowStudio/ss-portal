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
import {
  generateInvoicePdfV2,
  type InvoiceLineItem,
} from "../_shared/documents/invoicePdf.ts";

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

/** Sanitize the invoice reference for the filename; keeps hyphens (e.g. ZAN001-A). */
function sanitizeRef(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[/\\:*?"<>|\s]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "invoice";
}

function buildFilename(ref: string): string {
  return `SilverShadowStudio_Invoice_${sanitizeRef(ref)}.pdf`;
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

  // ── Auth: trigger marker OR admin JWT ────────────────────────────────────
  const isTriggerCall = req.headers.get("x-trigger-name") === "invoice_filing_pending";
  if (!isTriggerCall) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);
    const { data: roleRow } = await sb.from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ success: false, error: "Forbidden" }, 403);
  }

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
        "id, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, notes, line_items, subtotal, vat_rate, vat_amount, account_id, bank_account, stripe_checkout_url, project_id",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return json({ success: false, error: "invoice not found" }, 404);

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

    // ── Path (folder + filename) ───────────────────────────────────────────
    const folder = buildFolderPath(invoice.issued_at ?? invoice.created_at);
    if (!folder) return json({ success: false, error: `invalid invoice date` }, 400);
    // NOTE: {ref} for the filename. Real invoice_numbers are e.g. BAL-{quote}-{suffix};
    // reference_number is the project/quotation ref. Uses invoice_number then
    // reference_number — swap this one line once the canonical scheme is fixed.
    const ref = invoice.invoice_number || invoice.reference_number || invoice.id;
    const targetPath = `${folder}/${buildFilename(ref)}`;

    // ── Generate the PDF (identical design to download-invoice-pdf) ─────────
    let projectName: string | null = null;
    if ((invoice as any).project_id) {
      const { data: project } = await sb
        .from("projects").select("name").eq("id", (invoice as any).project_id).maybeSingle();
      projectName = project?.name ?? null;
    }
    const items = Array.isArray(invoice.line_items) ? (invoice.line_items as InvoiceLineItem[]) : [];
    const pdfBytes = generateInvoicePdfV2({
      invoice_number: invoice.invoice_number,
      reference_number: invoice.reference_number,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      status: invoice.status,
      due_date: invoice.due_date,
      issued_at: invoice.issued_at,
      created_at: invoice.created_at,
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

    return json({ success: true, dropbox_path: up.path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 500);
  }
});
