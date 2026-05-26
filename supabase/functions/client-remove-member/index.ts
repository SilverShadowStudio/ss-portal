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

// deno-lint-ignore no-explicit-any
async function logMemberEvent(admin: any, callerUserId: string, accountId: string, memberUserId: string) {
  let name: string | null = null
  try {
    const { data: prof } = await admin
      .from('profiles')
      .select('first_name, last_name, full_name')
      .eq('user_id', callerUserId)
      .maybeSingle()
    name = prof?.full_name ||
      [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') || null
  } catch { /* name optional */ }
  await admin.from('activity_log').insert({
    actor_user_id: callerUserId,
    actor_name: name,
    actor_role: 'client',
    action: 'client_member_removed',
    description: 'Removed a member from the team',
    entity_type: 'account_member',
    metadata: { account_id: accountId, member_user_id: memberUserId },
  }).then(() => {}, () => {})
}

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
  const callerUserId = userData.user.id

  let body: { member_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const memberId = body.member_id?.trim()
  if (!memberId) return json({ error: 'member_id is required' }, 400)

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: target } = await admin
    .from('account_members')
    .select('id, account_id, user_id, role')
    .eq('id', memberId)
    .maybeSingle()
  if (!target) return json({ error: 'Member not found' }, 404)

  // Caller must be a Manager (non-invitee member) of the same account.
  const { data: callerRow } = await admin
    .from('account_members')
    .select('role')
    .eq('account_id', target.account_id)
    .eq('user_id', callerUserId)
    .maybeSingle()
  if (!callerRow || callerRow.role === 'client_invitee') {
    return json({ error: 'Only a manager can remove members' }, 403)
  }

  // Cannot remove yourself (use a dedicated leave flow later if needed).
  if (target.user_id === callerUserId) {
    return json({ error: 'You cannot remove yourself from the team' }, 400)
  }

  // If the target is a Manager, never leave the account with zero Managers.
  if (target.role !== 'client_invitee') {
    const { data: managerRows } = await admin
      .from('account_members')
      .select('id')
      .eq('account_id', target.account_id)
      .neq('role', 'client_invitee')
    const otherManagers = (managerRows ?? []).filter((m: { id: string }) => m.id !== target.id)
    if (otherManagers.length < 1) {
      return json({ error: 'Cannot remove the only manager.' }, 400)
    }
  }

  // Revoke any still-pending invitation for this person (best-effort). The
  // auth.users record is intentionally NOT deleted — they may have other
  // history; this only unlinks them from the account.
  try {
    const { data: removedUser } = await admin.auth.admin.getUserById(target.user_id)
    const email = removedUser?.user?.email
    if (email) {
      await admin
        .from('account_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('account_id', target.account_id)
        .eq('email', email.toLowerCase())
        .is('accepted_at', null)
        .is('revoked_at', null)
    }
  } catch { /* invite revoke is best-effort */ }

  const { error: delErr } = await admin
    .from('account_members')
    .delete()
    .eq('id', target.id)
  if (delErr) {
    console.error('remove delete failed', delErr)
    return json({ error: 'Failed to remove member' }, 500)
  }

  await logMemberEvent(admin, callerUserId, target.account_id, target.user_id)
  return json({ success: true })
})
