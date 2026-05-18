// send-invoice-email/index.ts
//
// Sends a branded invoice notification email to the account owner via Resend.
// Called after an invoice is created with status "sent", and after a deposit
// invoice is auto-created when a quotation is signed.
//
// Required Supabase secret: RESEND_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrand } from "../_shared/brand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOGO_URL =
  "https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png";
const FROM_ADDRESS = "Silver Shadow Studio <portal@silvershadowstudio.com>";
const PORTAL_DOCS_URL = "https://portal.silvershadowstudio.com/documents";

function fmtMoney(amount: number, currency = "GBP") {
  return `${currency} ${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildInvoiceEmailHtml(
  invoiceNumber: string,
  amount: number,
  currency: string,
  dueDate: string | null | undefined,
  invoiceType: string | null | undefined,
  companyName: string | null | undefined,
  backgroundColor: string,
): string {
  const typeLabel =
    invoiceType === "deposit"
      ? "Deposit Invoice"
      : invoiceType === "balance"
      ? "Balance Invoice"
      : "Invoice";

  const intro = companyName
    ? `Silver Shadow Studio has issued a new invoice for ${companyName}.`
    : `Silver Shadow Studio has issued a new invoice for your review.`;

  const formattedAmount = fmtMoney(amount, currency);
  const formattedDue = fmtDate(dueDate);

  const dueLine = formattedDue
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#6B6358;line-height:1.5;text-align:center;margin:0 auto 4px;max-width:360px;letter-spacing:0.03em;">Due ${formattedDue}</p>`
    : "";

  const amountLine = `<p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;color:#1A1814;text-align:center;margin:0 auto 4px;letter-spacing:0.03em;">${formattedAmount}</p>`;

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

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:11px;font-weight:400;color:#6B6358;line-height:1.5;text-align:center;margin:0 auto 8px;letter-spacing:0.18em;text-transform:uppercase;">
                ${typeLabel}
              </p>
              <p style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#1A1814;line-height:1.15;text-align:center;margin:0 auto 10px;letter-spacing:0.02em;">
                ${invoiceNumber}
              </p>

              <div style="width:36px;height:1px;background:#C8C0B0;margin:20px auto 18px;"></div>

              ${amountLine}
              ${dueLine}

              <div style="width:36px;height:1px;background:#C8C0B0;margin:22px auto 26px;"></div>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.75;text-align:center;max-width:360px;margin:0 auto 32px;">
                ${intro} Please log in to your Silver Shadow Studio portal to view the full invoice and proceed with payment.
              </p>

              <p style="text-align:center;margin:0 0 44px;">
                <a href="${PORTAL_DOCS_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1A1814;text-decoration:underline;display:block;">
                  Pay Invoice
                </a>
              </p>

              <p style="font-family:Arial,sans-serif;font-size:11px;text-align:center;margin:0;">
                <a href="https://www.silvershadowstudio.com" style="color:#8A8070;text-decoration:none;">
                  silvershadowstudio.com
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
      .select("invoice_number, reference_number, amount, currency, due_date, type, account_id")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error(`Invoice not found: ${invErr?.message}`);

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

    const invoiceNumber = invoice.invoice_number || invoice.reference_number || "—";
    const subject = `Invoice ${invoiceNumber} from Silver Shadow Studio`;
    const brand = await loadBrand(supabase);
    const html = buildInvoiceEmailHtml(
      invoiceNumber,
      Number(invoice.amount),
      invoice.currency || "GBP",
      invoice.due_date,
      invoice.type,
      account.company_name,
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
