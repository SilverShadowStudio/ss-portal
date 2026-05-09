import { createClient } from 'npm:@supabase/supabase-js@2'

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

/**
 * Admin-only impersonation: returns a one-shot magiclink token_hash for the
 * target client's email so the browser can call `verifyOtp` and obtain a real
 * Supabase session as that user. This gives accurate RLS context (Option B).
 *
 * The admin's existing session tokens must be preserved client-side so the
 * admin can be restored on exit.
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
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)

  let body: { targetUserId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body.targetUserId) return json({ error: 'targetUserId is required' }, 400)

  // Disallow impersonating other admins.
  const { data: targetRole } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', body.targetUserId)
    .eq('role', 'admin')
    .maybeSingle()
  if (targetRole) return json({ error: 'Cannot impersonate another admin' }, 403)

  const { data: targetUser, error: getErr } =
    await admin.auth.admin.getUserById(body.targetUserId)
  if (getErr || !targetUser?.user?.email) {
    return json({ error: getErr?.message ?? 'Target user not found' }, 404)
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.user.email,
  })
  if (linkErr || !linkData?.properties) {
    return json({ error: linkErr?.message ?? 'Failed to generate session' }, 500)
  }

  return json({
    email: targetUser.user.email,
    token_hash: (linkData.properties as { hashed_token: string }).hashed_token,
  })
})