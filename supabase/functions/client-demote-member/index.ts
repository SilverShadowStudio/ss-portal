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
    action: 'client_member_demoted',
    description: 'Demoted a manager to Invitee',
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
    return json({ error: 'Only a manager can change roles' }, 403)
  }

  if (target.role === 'client_invitee') {
    return json({ error: 'This member is already an invitee' }, 400)
  }

  // Safeguard: never leave the account with zero Managers.
  const { data: managerRows } = await admin
    .from('account_members')
    .select('id')
    .eq('account_id', target.account_id)
    .neq('role', 'client_invitee')
  const otherManagers = (managerRows ?? []).filter((m: { id: string }) => m.id !== target.id)
  if (otherManagers.length < 1) {
    return json(
      { error: 'Cannot demote the only manager. Promote another member first.' },
      400,
    )
  }

  // Demote to Invitee + assign the next available palette pin colour.
  const { data: usedRows } = await admin
    .from('account_members')
    .select('pin_colour')
    .eq('account_id', target.account_id)
  const colour = nextInviteeColour(
    (usedRows ?? []).map((r: { pin_colour: string | null }) => r.pin_colour),
  )

  const { error: updErr } = await admin
    .from('account_members')
    .update({ role: 'client_invitee', pin_colour: colour })
    .eq('id', target.id)
  if (updErr) {
    console.error('demote update failed', updErr)
    return json({ error: 'Failed to demote member' }, 500)
  }

  await logMemberEvent(admin, callerUserId, target.account_id, target.user_id)
  return json({ success: true })
})
