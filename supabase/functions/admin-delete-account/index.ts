import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const PRESERVED_EMAIL = 'fred@silvershadowstudio.com'

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Admin-only: permanently delete an account along with any auth.users
 * rows whose only membership was on that account.
 *
 * Why this exists: the previous inline `from('accounts').delete()` only
 * removed the public-schema row. auth.users entries survived, which left
 * those auth accounts able to authenticate even though the admin UI
 * showed "deleted". The 2026-05-19 phantom-login diagnostic surfaced
 * this — a "deleted" client's auth row still existed and its session
 * was still emitting events.
 *
 * Rules:
 *   - `fred@silvershadowstudio.com` is preserved no matter what.
 *   - A user with memberships on OTHER accounts has only the link to
 *     this account removed; auth row stays.
 *   - A user whose only membership was this account has their auth
 *     row deleted via supabase.auth.admin.deleteUser().
 *   - The account row is deleted last; account_members cascades.
 *
 * Failures on individual auth deletions are logged but never block the
 * account-level delete (cleanup script can sweep stragglers).
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

  let body: { account_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body.account_id) return json({ error: 'account_id is required' }, 400)

  const accountId = body.account_id

  // 1. Enumerate the account's members.
  const { data: members, error: memErr } = await admin
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId)
  if (memErr) return json({ error: `Member lookup failed: ${memErr.message}` }, 500)

  // 2. For each member: resolve email + count OTHER memberships. We need
  //    this captured BEFORE deleting the account, so the cascade doesn't
  //    erase our enumeration.
  type MemberDecision = {
    userId: string
    email: string | null
    otherMembershipCount: number
    isPreserved: boolean
  }
  const decisions: MemberDecision[] = []
  for (const m of members ?? []) {
    const uid = (m as { user_id: string }).user_id
    const [{ data: target }, { count: otherCount }] = await Promise.all([
      admin.auth.admin.getUserById(uid),
      admin
        .from('account_members')
        .select('account_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .neq('account_id', accountId),
    ])
    const email = target?.user?.email?.toLowerCase() ?? null
    decisions.push({
      userId: uid,
      email,
      otherMembershipCount: otherCount ?? 0,
      isPreserved: email === PRESERVED_EMAIL,
    })
  }

  // 3. Delete the account row. account_members cascades.
  const { error: accDelErr } = await admin
    .from('accounts')
    .delete()
    .eq('id', accountId)
  if (accDelErr) {
    return json({ error: `Account delete failed: ${accDelErr.message}` }, 500)
  }

  // 4. For each member that had no other memberships and isn't the
  //    preserved Fred account, cascade to auth.users.
  const authDeleted: string[] = []
  const authPreserved: { user_id: string; reason: string }[] = []
  const authFailed: { user_id: string; error: string }[] = []
  for (const d of decisions) {
    if (d.isPreserved) {
      authPreserved.push({ user_id: d.userId, reason: 'preserved_email' })
      continue
    }
    if (d.otherMembershipCount > 0) {
      authPreserved.push({ user_id: d.userId, reason: 'other_memberships' })
      continue
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(d.userId)
    if (delErr) {
      console.warn(
        `[admin-delete-account] auth.admin.deleteUser ${d.userId} failed:`,
        delErr.message,
      )
      authFailed.push({ user_id: d.userId, error: delErr.message })
    } else {
      authDeleted.push(d.userId)
    }
  }

  return json({
    success: true,
    account_id: accountId,
    auth_users_deleted: authDeleted,
    auth_users_preserved: authPreserved,
    auth_users_failed: authFailed,
  })
})
