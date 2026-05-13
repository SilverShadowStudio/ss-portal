import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildInviteEmailHtml, InviteEmailConfig } from '../_shared/emailTemplates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders })
  }

  const url = new URL(req.url)

  // Fetch stored config as base, then override with any query params
  const { data: settingsRow } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'email_invite_config')
    .maybeSingle()

  const stored: InviteEmailConfig = (settingsRow?.value as InviteEmailConfig) ?? {}

  const p = (key: string) => url.searchParams.has(key) ? (url.searchParams.get(key) ?? undefined) : undefined

  const config: InviteEmailConfig = {
    illustrationUrl: p('illustrationUrl') ?? stored.illustrationUrl,
    bodyCopy: p('bodyCopy') ?? stored.bodyCopy,
    ctaLabel: p('ctaLabel') ?? stored.ctaLabel,
    ctaUrl: p('ctaUrl') ?? stored.ctaUrl,
    footerText: p('footerText') ?? stored.footerText,
    backgroundColor: p('backgroundColor') ?? stored.backgroundColor,
  }

  const inviteUrl = url.searchParams.get('ctaUrl') || 'https://portal.silvershadowstudio.com/set-password?token=PREVIEW'
  const html = buildInviteEmailHtml('Preview Company', inviteUrl, config)

  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
})
