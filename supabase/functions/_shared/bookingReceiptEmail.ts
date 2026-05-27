// Client-facing booking confirmation email (Manager-only recipient, mirroring
// Manager-only document access). The receipt PDF is attached by the webhook via
// Resend; this is the HTML body. Portal-domain logo + CTA for DMARC alignment.
const LOGO_URL =
  "https://portal.silvershadowstudio.com/email-assets/silvershadow-wordmark.png";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildBookingReceiptEmail(opts: {
  firstName?: string | null;
  projectName?: string | null;
  sceneName?: string | null;
  rounds: { roundNumber: number; range?: string | null }[];
  amountPaid: string;
  amountOutstanding?: string | null;
  portalUrl: string;
  backgroundColor?: string;
}): string {
  const bg = opts.backgroundColor || "#EDE8E0";
  const first = (opts.firstName || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `${escapeHtml(first)},<br><br>` : "";
  const production = [opts.projectName, opts.sceneName].filter(Boolean).map((s) => escapeHtml(String(s))).join(" — ");
  const roundsList = opts.rounds
    .map((r) => `Round ${String(r.roundNumber).padStart(2, "0")}${r.range ? ` · ${escapeHtml(r.range)}` : ""}`)
    .join("<br>");
  const outstanding = opts.amountOutstanding
    ? `<p style="font-family:Arial,sans-serif;font-size:12px;color:#8A8070;text-align:center;margin:0 auto 8px">Remaining ${escapeHtml(opts.amountOutstanding)} due on delivery (net 15).</p>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${bg}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:36px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:380px;margin:0 auto 28px">${greeting}Thank you — your booking is confirmed and production is now scheduled.${production ? `<br><br><strong>${production}</strong>` : ""}</p><div style="border-top:1px solid #B89A6A;border-bottom:1px solid rgba(138,128,112,0.35);padding:18px 0;margin:0 0 24px"><p style="font-family:Arial,sans-serif;font-size:13px;color:#1A1814;line-height:1.7;text-align:center;margin:0">${roundsList}</p></div><p style="font-family:Arial,sans-serif;font-size:15px;color:#1A1814;text-align:center;margin:0 auto 6px"><strong>Paid: ${escapeHtml(opts.amountPaid)}</strong></p>${outstanding}<p style="font-family:Arial,sans-serif;font-size:11px;color:#8A8070;text-align:center;margin:0 auto 28px">Your receipt is attached as a PDF.</p><p style="text-align:center;margin:0"><a href="${opts.portalUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">View your portal</a></p></td></tr></table></td></tr></table></body></html>`;
}
