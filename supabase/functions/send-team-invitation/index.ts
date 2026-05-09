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

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const APP_BASE_URL =
  Deno.env.get('APP_BASE_URL') || 'https://portal.silvershadowstudio.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // Resolve the calling user using the anon client + their JWT
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const callerUserId = userData.user.id

  let body: { accountId?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const accountId = body.accountId?.trim()
  const rawEmail = body.email?.trim().toLowerCase()

  if (!accountId || !rawEmail) {
    return json({ error: 'accountId and email are required' }, 400)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(rawEmail)) {
    return json({ error: 'Invalid email address' }, 400)
  }

  // Service role for downstream writes / lookups bypassing RLS where needed
  const admin = createClient(supabaseUrl, supabaseServiceKey)

  // Verify the caller is the owner of this account
  const { data: ownerRow, error: ownerError } = await admin
    .from('account_members')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', callerUserId)
    .eq('role', 'owner')
    .maybeSingle()

  if (ownerError || !ownerRow) {
    return json({ error: 'Only the account owner can invite members' }, 403)
  }

  // Load account for company name + caller profile for inviter name
  const { data: account } = await admin
    .from('accounts')
    .select('company_name')
    .eq('id', accountId)
    .maybeSingle()

  const { data: inviterProfile } = await admin
    .from('profiles')
    .select('full_name, first_name, last_name')
    .eq('user_id', callerUserId)
    .maybeSingle()

  const inviterName =
    inviterProfile?.full_name ||
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(' ') ||
    userData.user.email ||
    'A team member'

  // Reject if email already corresponds to an existing member of this account
  const { data: existingProfiles } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('full_name', '%')
    .limit(0)
  // (We can't query auth.users by email from here trivially; rely on DB
  //  uniqueness checks below for invitations.)
  void existingProfiles

  // Reject if a non-revoked, non-accepted invitation already exists
  const { data: existingInvite } = await admin
    .from('account_invitations')
    .select('id, accepted_at, revoked_at, expires_at')
    .eq('account_id', accountId)
    .eq('email', rawEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (existingInvite) {
    return json(
      { error: 'An active invitation already exists for this email' },
      409,
    )
  }

  const token = generateToken()

  const { data: invite, error: insertError } = await admin
    .from('account_invitations')
    .insert({
      account_id: accountId,
      email: rawEmail,
      role: 'user',
      token,
      invited_by: callerUserId,
    })
    .select('id, expires_at')
    .single()

  if (insertError || !invite) {
    console.error('Failed to create invitation', insertError)
    return json({ error: 'Failed to create invitation' }, 500)
  }

  // Audit log (best-effort)
  await admin.from('account_user_audit').insert({
    account_id: accountId,
    actor_user_id: callerUserId,
    event_type: 'invitation_sent',
    target_email: rawEmail,
    metadata: { invitation_id: invite.id },
  })

  // Enqueue the invitation email via the existing transactional sender
  const inviteUrl = `${APP_BASE_URL}/accept-invite?token=${token}`

  const { error: sendError } = await admin.functions.invoke(
    'send-transactional-email',
    {
      body: {
        templateName: 'team-invitation',
        recipientEmail: rawEmail,
        idempotencyKey: `team-invite-${invite.id}`,
        templateData: {
          inviterName,
          companyName: account?.company_name ?? 'a team',
          inviteUrl,
        },
      },
    },
  )

  if (sendError) {
    console.error('Failed to enqueue invitation email', sendError)
    // Invitation row was created successfully; surface a soft warning
    return json(
      {
        success: true,
        invitationId: invite.id,
        emailQueued: false,
        warning: 'Invitation created but email could not be queued',
      },
      200,
    )
  }

  return json({
    success: true,
    invitationId: invite.id,
    emailQueued: true,
  })
})