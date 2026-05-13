const LOGO_URL =
  'https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png'

export const EMAIL_INVITE_DEFAULTS = {
  illustrationUrl:
    'https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/portal-invite-illustration.png',
  bodyCopy:
    'Your Silvershadow Studio portal is ready. Your projects, deliveries, and studio communications are now accessible in one place.',
  ctaLabel: 'ACCESS YOUR PORTAL',
  footerText: 'silvershadowstudio.com',
  backgroundColor: '#EDE8E0',
}

export interface InviteEmailConfig {
  illustrationUrl?: string
  bodyCopy?: string
  ctaLabel?: string
  ctaUrl?: string
  footerText?: string
  backgroundColor?: string
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
  const footerText = config.footerText || EMAIL_INVITE_DEFAULTS.footerText
  const backgroundColor = config.backgroundColor || EMAIL_INVITE_DEFAULTS.backgroundColor

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${backgroundColor}">
<div style="background:${backgroundColor}">
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:48px 40px">

    <div style="text-align:center;margin-bottom:40px">
      <img src="${LOGO_URL}" alt="Silvershadow Studio" style="height:28px;width:auto;filter:brightness(0)" />
    </div>

    <div style="margin-bottom:36px">
      <img src="${illustrationUrl}" alt="Silvershadow Studio" style="display:block;margin:0 auto;max-width:220px;width:100%;height:auto;border:none" />
    </div>

    <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:360px;margin:0 auto 32px">
      ${bodyCopy}
    </p>

    <p style="text-align:center;margin:0 0 40px">
      <a href="${ctaUrl}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:underline;display:block">${ctaLabel}</a>
    </p>

    <p style="font-family:Arial,sans-serif;font-size:11px;color:rgba(26,24,20,0.45);text-align:center;margin:0">${footerText}</p>

  </div>
</div>
</body></html>`
}
