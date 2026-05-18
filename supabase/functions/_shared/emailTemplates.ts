const LOGO_URL =
  'https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png'

export const EMAIL_INVITE_DEFAULTS = {
  subject: 'Your portal is ready',
  illustrationUrl:
    'https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/portal-invite-illustration.png',
  bodyCopy: 'Your Silver Shadow Studio portal is now ready.<br>You will find your projects, deliveries,<br>and studio correspondence within.',
  ctaLabel: 'ENTER',
  backgroundColor: '#EDE8E0',
}

export interface InviteEmailConfig {
  subject?: string
  illustrationUrl?: string
  bodyCopy?: string
  ctaLabel?: string
  ctaUrl?: string
  footerText?: string
  backgroundColor?: string
  /** First name of the client contact. If present, rendered as a "{firstName},"
   *  greeting above the body copy. If null/empty, the greeting line is omitted. */
  firstName?: string | null
}

// Escape user-provided text before injection into HTML to avoid breaking the
// markup or introducing XSS via a name field.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildInviteEmailHtml(
  _companyName: string,
  inviteUrl: string,
  config: InviteEmailConfig = {},
): string {
  const illustrationUrl = config.illustrationUrl || EMAIL_INVITE_DEFAULTS.illustrationUrl
  const bodyCopy = config.bodyCopy || EMAIL_INVITE_DEFAULTS.bodyCopy
  const ctaLabel = config.ctaLabel || EMAIL_INVITE_DEFAULTS.ctaLabel
  const ctaUrl = config.ctaUrl || inviteUrl
  const backgroundColor = config.backgroundColor || EMAIL_INVITE_DEFAULTS.backgroundColor

  // First name → first whitespace-separated token. Falsy = no greeting.
  const firstNameRaw = (config.firstName || '').trim().split(/\s+/)[0] || ''
  const greetingHtml = firstNameRaw
    ? `${escapeHtml(firstNameRaw)},<br><br>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${backgroundColor}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${backgroundColor}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:40px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><div style="margin-bottom:36px;text-align:center"><img src="${illustrationUrl}" alt="" style="display:inline-block;max-width:160px;width:100%;height:auto;border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:360px;margin:0 auto 32px">${greetingHtml}${bodyCopy}</p><p style="text-align:center;margin:0"><a href="${ctaUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">${ctaLabel}</a></p></td></tr></table></td></tr></table></body></html>`
}
