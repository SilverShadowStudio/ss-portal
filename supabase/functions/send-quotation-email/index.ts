// send-quotation-email/index.ts
//
// Sends a branded quotation notification email to the account owner via Resend.
// Called from the frontend after a quotation is created with status "sent".
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
const FROM_ADDRESS = "Silvershadow Studio <portal@silvershadowstudio.com>";
const PORTAL_DOCS_URL = "https://portal.silvershadowstudio.com/documents";

function buildQuotationEmailHtml(
  quotationNumber: string,
  projectName: string | null,
  companyName: string | null,
  backgroundColor: string,
): string {
  const intro = companyName
    ? `Silvershadow Studio has prepared a new quotation for ${companyName}.`
    : `Silvershadow Studio has prepared a new quotation for your review.`;

  const projectLine = projectName
    ? `<p style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#6B6358;line-height:1.5;text-align:center;margin:0 auto 4px;max-width:360px;letter-spacing:0.03em;">${projectName}</p>`
    : "";

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
                <img src="${LOGO_URL}" alt="Silvershadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none;">
              </div>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#1A1814;line-height:1.15;text-align:center;margin:0 auto 10px;letter-spacing:0.02em;">
                ${quotationNumber}
              </p>
              ${projectLine}

              <div style="width:36px;height:1px;background:#C8C0B0;margin:22px auto 26px;"></div>

              <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.75;text-align:center;max-width:360px;margin:0 auto 32px;">
                ${intro} The quotation includes the full scope of services, commercial terms, and a signature section for your review.
              </p>

              <p style="text-align:center;margin:0 0 44px;">
                <a href="${PORTAL_DOCS_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1A1814;text-decoration:underline;display:block;">
                  View Quotation
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
    const { quotationId } = await req.json();
    if (!quotationId) throw new Error("quotationId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch quotation
    const { data: quotation, error: qErr } = await supabase
      .from("quotation_documents")
      .select("quotation_number, reference_number, project_name, account_id")
      .eq("id", quotationId)
      .single();
    if (qErr || !quotation) throw new Error(`Quotation not found: ${qErr?.message}`);

    // Fetch account
    const { data: account, error: aErr } = await supabase
      .from("accounts")
      .select("company_name, owner_user_id")
      .eq("id", quotation.account_id)
      .single();
    if (aErr || !account) throw new Error(`Account not found: ${aErr?.message}`);

    // Resolve client email via auth admin
    const { data: { user }, error: uErr } = await supabase.auth.admin.getUserById(
      account.owner_user_id,
    );
    if (uErr || !user?.email) throw new Error(`User not found: ${uErr?.message}`);

    const quotationNumber = quotation.quotation_number || quotation.reference_number || "—";
    const subject = `New quotation from Silvershadow Studio — ${quotationNumber}`;
    const brand = await loadBrand(supabase);
    const html = buildQuotationEmailHtml(
      quotationNumber,
      quotation.project_name,
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

    console.log(`[send-quotation-email] Sent ${quotationNumber} to ${user.email}`);
    return new Response(JSON.stringify({ ok: true, to: user.email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[send-quotation-email]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
