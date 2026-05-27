// Admin notification email when a client pays for a booking. Plain, scannable.
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

export function buildBookingPaidAdminEmail(opts: {
  accountName: string;
  projectName?: string | null;
  sceneName?: string | null;
  rounds: { roundNumber: number; range?: string | null }[];
  amountPaid: string;
  paymentOptionLabel: string;
  adminUrl: string;
  backgroundColor?: string;
}): string {
  const bg = opts.backgroundColor || "#EDE8E0";
  const production = [opts.projectName, opts.sceneName].filter(Boolean).map((s) => escapeHtml(String(s))).join(" — ");
  const roundsList = opts.rounds
    .map((r) => `Round ${String(r.roundNumber).padStart(2, "0")}${r.range ? ` · ${escapeHtml(r.range)}` : ""}`)
    .join("<br>");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${bg}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:40px"><div style="margin-bottom:28px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:24px;width:auto;filter:brightness(0);border:none"></div><p style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:#8A8070;margin:0 0 10px">New booking paid</p><p style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1A1814;margin:0 0 6px">${escapeHtml(opts.accountName)}</p>${production ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#1A1814;margin:0 0 18px">${production}</p>` : ""}<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td style="font-family:Arial,sans-serif;font-size:12px;color:#1A1814;line-height:1.8">${roundsList}</td></tr></table><p style="font-family:Arial,sans-serif;font-size:14px;color:#1A1814;margin:0 0 4px"><strong>Paid: ${escapeHtml(opts.amountPaid)}</strong></p><p style="font-family:Arial,sans-serif;font-size:11px;color:#8A8070;margin:0 0 24px">${escapeHtml(opts.paymentOptionLabel)}</p><p style="margin:0"><a href="${opts.adminUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">Open admin bookings</a></p></td></tr></table></td></tr></table></body></html>`;
}
