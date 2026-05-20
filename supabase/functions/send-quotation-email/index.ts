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

function buildQuotationEmailHtml(
  quotationNumber: string,
  projectName: string | null,
  greetingName: string | null,
  lineItemNames: string[],
  backgroundColor: string,
): string {
  // Project name takes the prominent position; the quotation number sits
  // quietly beneath it. If there's no project name, fall back to the
  // quotation number in the prominent slot so the email still reads.
  const heading = projectName || quotationNumber;
  const subhead = projectName ? quotationNumber : "";
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

              ${greetingLine}
              <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;margin:0 auto 18px;max-width:360px;">
                Your quotation includes:
              </p>
              ${itemsHtml}

              <p style="text-align:center;margin:32px 0;">
                <a href="${PORTAL_DOCS_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A;">
                  View Quotation
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
      .select("quotation_number, reference_number, project_name, account_id, line_items")
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

    // Pull a greeting first name from the owner profile if available.
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

    // Extract line-item names from the quotation's line_items JSON in the
    // order they're stored. We support both { description } and { name }
    // shapes for backwards compatibility with earlier rows.
    const rawItems = Array.isArray(quotation.line_items) ? quotation.line_items : [];
    const lineItemNames = rawItems
      .map((it: unknown) => {
        if (!it || typeof it !== "object") return "";
        const r = it as Record<string, unknown>;
        const name = (r.description ?? r.name ?? r.title ?? "") as string;
        return typeof name === "string" ? name.trim() : "";
      })
      .filter((s: string) => s.length > 0);

    const quotationNumber = quotation.quotation_number || quotation.reference_number || "—";
    const subject = quotation.project_name
      ? `${quotation.project_name} / Quotation / ${quotationNumber}`
      : `Quotation / ${quotationNumber}`;
    const brand = await loadBrand(supabase);
    const html = buildQuotationEmailHtml(
      quotationNumber,
      quotation.project_name,
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
