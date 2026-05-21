// Invite email for a team engagement contract — "review and sign" CTA.
// Mirrors the client invite email's visual structure (cream background,
// portal-hosted wordmark + illustration, centred body, gold-underline CTA)
// so deliverability characteristics match. Image hosts are the portal-domain
// URLs from emailTemplates.ts.

const LOGO_URL =
  "https://portal.silvershadowstudio.com/email-assets/silvershadow-wordmark.png";
const ILLUSTRATION_URL =
  "https://portal.silvershadowstudio.com/email-assets/portal-invite-illustration.png";

export const TEAM_CONTRACT_INVITE_SUBJECT = "Your contract from Silvershadow Studio";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build the "review and sign" invite email. `ctaUrl` is the portal-domain
 *  verify link that lands the recipient on /sign-team-contract/{id}. */
export function buildTeamContractInviteHtml(firstName: string | null, ctaUrl: string): string {
  const background = "#EDE8E0";
  const first = (firstName || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `Hi ${escapeHtml(first)},<br><br>` : "";
  const body =
    "You have been invited to review and sign a contract from Silver Shadow Studio. " +
    "Please click below to view the terms and sign.";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${background}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${background}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:40px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><div style="margin-bottom:36px;text-align:center"><img src="${ILLUSTRATION_URL}" alt="" style="display:inline-block;max-width:160px;width:100%;height:auto;border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:380px;margin:0 auto 32px">${greeting}${body}</p><p style="text-align:center;margin:0 0 36px"><a href="${ctaUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">Review and sign</a></p><p style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#8A8070;line-height:1.7;text-align:center;margin:0">If you have questions about the contract, please contact us.<br><br>Best regards,<br>Silver Shadow Studio</p></td></tr></table></td></tr></table></body></html>`;
}
