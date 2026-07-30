// send-invoice-email/index.ts
//
// Sends a branded invoice notification email to the account owner via Resend.
// Called after an invoice is created with status "sent", and after a deposit
// invoice is auto-created when a quotation is signed.
//
// Required Supabase secret: RESEND_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrand } from "../_shared/brand.ts";
import { requireAdminUser } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOGO_URL =
  "https://portal.silvershadowstudio.com/email-assets/silvershadow-wordmark.png";
const FROM_ADDRESS = "Silver Shadow Studio <portal@silvershadowstudio.com>";
const PORTAL_DOCS_URL = "https://portal.silvershadowstudio.com/documents";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractItemNames(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      if (!it || typeof it !== "object") return "";
      const r = it as Record<string, unknown>;
      const name = (r.description ?? r.name ?? r.title ?? "") as string;
      return typeof name === "string" ? name.trim() : "";
    })
    .filter((s) => s.length > 0);
}

function buildInvoiceEmailHtml(
  invoiceNumber: string,
  projectName: string | null,
  greetingName: string | null,
  lineItemNames: string[],
  backgroundColor: string,
): string {
  // Mirror the quotation email: project name is the primary identifier,
  // the invoice number sits quietly below as a reference.
  const heading = projectName || invoiceNumber;
  const subhead = projectName ? invoiceNumber : "";
  const subheadLine = subhead
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#1A1814;opacity:0.55;line-height:1.5;text-align:center;margin:8px auto 0;max-width:360px;letter-spacing:0.03em;">${escapeHtml(subhead)}</p>`
    : "";

  const greetingLine = greetingName
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;margin:0 auto 18px;max-width:360px;">${escapeHtml(greetingName)},</p>`
    : "";

  const itemsHtml = lineItemNames
    .map(
      (name) =>
        `<p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#1A1814;line-height:1.7;text-align:center;margin:0 auto 8px;max-width:360px;">${escapeHtml(name)}</p>`,
    )
    .join("");

  // Only render the "Your invoice covers:" intro + items block if we have
  // line items to show. For standalone invoices with no items the body
  // collapses to heading → CTA.
  const itemsBlock = lineItemNames.length > 0
    ? `${greetingLine}
              <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;margin:0 auto 18px;max-width:360px;">
                Your invoice covers:
              </p>
              ${itemsHtml}`
    : greetingLine;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:${backgroundColor};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${backgroundColor};">
    <tr>
      <td align="center" valign="top">
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
          <tr>
            <td style="font-family:Arial,sans-serif;padding:48px 40px;">

              <div style="text-align:center;margin-bottom:44px;">
                <img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none;">
              </div>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;color:#1A1814;line-height:1.15;text-align:center;margin:0 auto;letter-spacing:0.01em;">
                ${escapeHtml(heading)}
              </p>
              ${subheadLine}

              <div style="width:36px;height:1px;background:#B89A6A;margin:22px auto 32px;"></div>

              ${itemsBlock}

              <p style="text-align:center;margin:32px 0;">
                <a href="${PORTAL_DOCS_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A;">
                  Pay Invoice
                </a>
              </p>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAdminUser(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  try {
    const { invoiceId } = await req.json();
    if (!invoiceId) throw new Error("invoiceId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch invoice
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("invoice_number, reference_number, account_id, quotation_id, line_items")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error(`Invoice not found: ${invErr?.message}`);

    // Fetch the parent quotation when this invoice is linked to one.
    // Deposit/balance invoices always have a quotation_id; standalone
    // invoices may not.
    let quotationProjectName: string | null = null;
    let quotationNumber: string | null = null;
    let quotationLineItems: unknown[] = [];
    if (invoice.quotation_id) {
      const { data: quotation } = await supabase
        .from("quotation_documents")
        .select("quotation_number, reference_number, project_name, line_items")
        .eq("id", invoice.quotation_id)
        .maybeSingle();
      if (quotation) {
        quotationProjectName = quotation.project_name ?? null;
        quotationNumber = quotation.quotation_number || quotation.reference_number || null;
        if (Array.isArray(quotation.line_items)) {
          quotationLineItems = quotation.line_items;
        }
      }
    }

    // Fetch account
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("company_name, owner_user_id")
      .eq("id", invoice.account_id)
      .single();
    if (accErr || !account) throw new Error(`Account not found: ${accErr?.message}`);

    // Resolve owner email via auth admin
    const { data: { user }, error: uErr } = await supabase.auth.admin.getUserById(
      account.owner_user_id,
    );
    if (uErr || !user?.email) throw new Error(`User not found: ${uErr?.message}`);

    // Pull a greeting first name from the owner's profile if available.
    let greetingName: string | null = null;
    {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("user_id", account.owner_user_id)
        .maybeSingle();
      const fn = (profile?.first_name as string | null)?.trim();
      if (fn) greetingName = fn;
    }

    const invoiceNumber = invoice.invoice_number || invoice.reference_number || "—";
    // Line items come from the linked quotation when available; for
    // standalone invoices we fall back to the invoice's own line items.
    const lineItemNames = quotationLineItems.length > 0
      ? extractItemNames(quotationLineItems)
      : extractItemNames(invoice.line_items);

    // Subject: "[Project Name] / Invoice / [Quotation Number]". Falls back
    // gracefully if either piece is missing.
    const subjectRef = quotationNumber || invoiceNumber;
    const subject = quotationProjectName
      ? `${quotationProjectName} / Invoice / ${subjectRef}`
      : `Invoice / ${subjectRef}`;

    const brand = await loadBrand(supabase);
    const html = buildInvoiceEmailHtml(
      invoiceNumber,
      quotationProjectName,
      greetingName,
      lineItemNames,
      brand.background_color,
    );

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not set");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }

    console.log(`[send-invoice-email] Sent ${invoiceNumber} to ${user.email}`);
    return new Response(JSON.stringify({ ok: true, to: user.email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[send-invoice-email]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
