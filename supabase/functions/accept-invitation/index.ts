import { createClient } from 'npm:@supabase/supabase-js@2'
import { nextInviteeColour } from '../_shared/clientMemberColours.ts'

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
    return json({ error: 'You must be signed in to accept an invitation' }, 401)
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'You must be signed in to accept an invitation' }, 401)
  }
  const user = userData.user

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const token = body.token?.trim()
  if (!token) return json({ error: 'token is required' }, 400)

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: invite, error: inviteError } = await admin
    .from('account_invitations')
    .select('id, account_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token', token)
    .maybeSingle()

  if (inviteError || !invite) {
    return json({ error: 'Invitation not found' }, 404)
  }

  if (invite.revoked_at) {
    return json({ error: 'This invitation has been revoked' }, 410)
  }

  if (invite.accepted_at) {
    return json({ error: 'This invitation has already been accepted' }, 410)
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return json({ error: 'This invitation has expired' }, 410)
  }

  const userEmail = (user.email || '').toLowerCase()
  if (userEmail !== invite.email.toLowerCase()) {
    return json(
      {
        error:
          'This invitation was sent to a different email address. Please sign in with that email.',
      },
      403,
    )
  }

  // Insert member (idempotent on (account_id, user_id) via unique constraint if any; otherwise check first)
  const { data: existingMember } = await admin
    .from('account_members')
    .select('id')
    .eq('account_id', invite.account_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existingMember) {
    // For Client-Invitees, assign the next available pen colour from the
    // palette (computed from the colours already used in this account).
    let pinColour: string | null = null
    if (invite.role === 'client_invitee') {
      const { data: usedRows } = await admin
        .from('account_members')
        .select('pin_colour')
        .eq('account_id', invite.account_id)
      pinColour = nextInviteeColour(
        (usedRows ?? []).map((r: { pin_colour: string | null }) => r.pin_colour),
      )
    }
    const { error: insertError } = await admin.from('account_members').insert({
      account_id: invite.account_id,
      user_id: user.id,
      role: invite.role,
      joined_at: new Date().toISOString(),
      ...(pinColour ? { pin_colour: pinColour } : {}),
    })
    if (insertError) {
      console.error('Failed to add account member', insertError)
      return json({ error: 'Failed to join account' }, 500)
    }
  }

  // If the invitation grants ownership (e.g. an admin pre-created the
  // account on behalf of this client), transfer ownership of the account
  // to the accepting user and remove the placeholder admin membership.
  if (invite.role === 'owner') {
    await admin
      .from('accounts')
      .update({ owner_user_id: user.id })
      .eq('id', invite.account_id)

    // Remove any non-owner membership rows for the inviter (admin
    // placeholder) so they don't appear in the client's team list.
    await admin
      .from('account_members')
      .delete()
      .eq('account_id', invite.account_id)
      .neq('user_id', user.id)
  }

  // Link the user's profile to this account if not already set
  await admin
    .from('profiles')
    .update({ account_id: invite.account_id })
    .eq('user_id', user.id)
    .is('account_id', null)

  // Mark invitation accepted
  await admin
    .from('account_invitations')
    .update({
      accepted_at: new Date().toISOString(),
      accepted_user_id: user.id,
    })
    .eq('id', invite.id)

  // Audit log
  await admin.from('account_user_audit').insert({
    account_id: invite.account_id,
    actor_user_id: user.id,
    target_user_id: user.id,
    target_email: invite.email,
    event_type: 'invitation_accepted',
    metadata: { invitation_id: invite.id },
  })

  // Phase 1 multi-user: record the join for Client-Invitees (best-effort).
  if (invite.role === 'client_invitee') {
    const { data: prof } = await admin
      .from('profiles')
      .select('first_name, last_name, full_name')
      .eq('user_id', user.id)
      .maybeSingle()
    const joinerName =
      prof?.full_name ||
      [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') ||
      user.email ||
      null
    await admin
      .from('activity_log')
      .insert({
        actor_user_id: user.id,
        actor_name: joinerName,
        actor_role: 'client',
        action: 'client_member_joined',
        description: 'Joined the team',
        entity_type: 'account_member',
        metadata: { account_id: invite.account_id, invitation_id: invite.id },
      })
      .then(() => {}, () => {})
  }

  return json({ success: true, accountId: invite.account_id })
})