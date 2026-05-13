import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildInviteEmailHtml } from '../_shared/emailTemplates.ts'

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
  const template = url.searchParams.get('template') || 'invite'
  const inviteUrl = url.searchParams.get('inviteUrl') || 'https://portal.silvershadowstudio.com/set-password?token=PREVIEW'

  let html: string
  if (template === 'invite') {
    html = buildInviteEmailHtml('Preview Company', inviteUrl)
  } else {
    html = buildInviteEmailHtml('Preview Company', inviteUrl)
  }

  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
})
