import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildInviteEmailHtml, EMAIL_INVITE_DEFAULTS, InviteEmailConfig } from '../_shared/emailTemplates.ts'
import { loadBrand } from '../_shared/brand.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const APP_BASE_URL =
  Deno.env.get('APP_BASE_URL') || 'https://portal.silvershadowstudio.com'

// Mirror of admin-create-client's helper so the manual-paste invite URL is
// byte-identical with what the system would send. Documented there in full.
function buildPortalVerifyUrl(
  properties: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const token = (properties?.hashed_token as string | undefined) ?? ''
  const type = (properties?.verification_type as string | undefined) ?? ''
  const redirectTo = (properties?.redirect_to as string | undefined) ?? ''
  if (!token || !type) return fallback
  const params = new URLSearchParams({ token, type })
  if (redirectTo) params.set('redirect_to', redirectTo)
  return `${APP_BASE_URL}/auth/verify?${params.toString()}`
}

/**
 * Admin-only: generate a fresh portal-domain invite URL and a rendered
 * email HTML body identical to what the system would have sent, but
 * without sending anything. Used by the "Send invite manually" admin
 * affordance when an auto-sent invite is being blocked by the recipient's
 * mail filter. The admin pastes the rendered email into their personal
 * inbox compose window and sends from a more-trusted sender.
 *
 * Returns:
 *   verify_url          — single-use portal-domain link, ~24h validity
 *   recipient_email     — owner's email on the account
 *   recipient_first_name — owner's first name (for the IT-whitelist greeting)
 *   subject             — same subject the system would use
 *   email_html          — rendered HTML body identical to system-sent
 *   email_text          — plain-text fallback derived from the same source
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)

  let body: { account_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const accountId = body.account_id?.trim()
  if (!accountId) return json({ error: 'account_id is required' }, 400)

  // Resolve owner + email + first name from the account.
  const { data: account, error: accErr } = await admin
    .from('accounts')
    .select('id, company_name, owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr || !account) return json({ error: 'Account not found' }, 404)

  const { data: ownerUser, error: getUserErr } = await admin.auth.admin.getUserById(
    account.owner_user_id as string,
  )
  if (getUserErr || !ownerUser?.user?.email) {
    return json({ error: 'Account owner not found in auth.users' }, 404)
  }
  const recipientEmail = ownerUser.user.email
  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('first_name')
    .eq('user_id', account.owner_user_id)
    .maybeSingle()
  const recipientFirstName = ownerProfile?.first_name ?? null

  // Generate a fresh magiclink. magiclink (not invite) covers both
  // never-confirmed and existing users — invite type 400s on already-
  // registered emails. Same call shape as admin-create-client's resend
  // path so behaviour parity is preserved.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: recipientEmail,
    options: { redirectTo: `${APP_BASE_URL}/set-password` },
  })
  if (linkErr || !linkData?.user) {
    console.error('[admin-generate-manual-invite] generateLink failed', linkErr)
    return json({ error: linkErr?.message || 'Failed to generate link' }, 400)
  }
  const props = linkData.properties as Record<string, unknown>
  const verifyUrl = buildPortalVerifyUrl(props, props.action_link as string)

  // Render the email with the same config the system uses, so a manual
  // paste is indistinguishable from the auto-sent version.
  const { data: cfgRow } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'email_invite_config')
    .maybeSingle()
  const emailConfig = (cfgRow?.value as InviteEmailConfig | null) ?? {}
  const brand = await loadBrand(admin)
  const subject = emailConfig.subject ?? EMAIL_INVITE_DEFAULTS.subject
  const html = buildInviteEmailHtml(
    account.company_name as string,
    verifyUrl,
    {
      backgroundColor: brand.background_color,
      ...emailConfig,
      ctaUrl: undefined,
      firstName: recipientFirstName,
    },
  )

  // Plain-text fallback. Keep simple — most inbox compose windows
  // auto-derive text from pasted HTML; this is the safety net for
  // strict-plain-text recipients.
  const bodyCopyPlain = (emailConfig.bodyCopy ?? EMAIL_INVITE_DEFAULTS.bodyCopy)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  const greetingPlain = recipientFirstName ? `${recipientFirstName},\n\n` : ''
  const ctaLabel = emailConfig.ctaLabel ?? EMAIL_INVITE_DEFAULTS.ctaLabel
  const text = `${greetingPlain}${bodyCopyPlain}\n\n${ctaLabel}: ${verifyUrl}`

  return json({
    verify_url: verifyUrl,
    recipient_email: recipientEmail,
    recipient_first_name: recipientFirstName,
    subject,
    email_html: html,
    email_text: text,
  })
})
