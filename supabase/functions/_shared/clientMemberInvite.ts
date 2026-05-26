// Branded "you've been invited to a team" email for client multi-user invites.
// Sent via Resend from send-team-invitation (client-account path). Portal-domain
// logo + CTA for DMARC alignment, Outlook-safe table layout — mirrors the
// structure of _shared/emailTemplates.ts buildInviteEmailHtml.
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

export function buildClientMemberInviteHtml(opts: {
  companyName: string;
  inviterName: string;
  inviteUrl: string;
  firstName?: string | null;
  backgroundColor?: string;
}): string {
  const backgroundColor = opts.backgroundColor || "#EDE8E0";
  const first = (opts.firstName || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `${escapeHtml(first)},<br><br>` : "";
  const inviter = escapeHtml(opts.inviterName || "A colleague");
  const company = escapeHtml(opts.companyName || "their team");
  const body =
    `${greeting}${inviter} has invited you to join <strong>${company}</strong> on the ` +
    `Silver Shadow Studio portal.<br><br>You'll be able to review renders, leave ` +
    `comments, and follow project progress.`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${backgroundColor}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${backgroundColor}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:40px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:380px;margin:0 auto 32px">${body}</p><p style="text-align:center;margin:0"><a href="${opts.inviteUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">ACCEPT INVITATION</a></p></td></tr></table></td></tr></table></body></html>`;
}
