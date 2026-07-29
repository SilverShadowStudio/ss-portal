// Edge function: admin-archive-account
// Soft-delete: archive or unarchive an account. Archiving hides it from the
// active list, keeps all its records + files, and DISABLES its members' logins
// (ban). Unarchiving restores it and re-enables logins. Fully reversible.
//
// Body: { account_id: string, archive: boolean }   // archive=false → unarchive

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Never disable Fred's own login even if his account were archived.
const PRESERVED_EMAIL = 'fred@silvershadowstudio.com'
const BAN_DURATION = '876000h' // ~100 years

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'admin').maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)

  let body: { account_id?: string; archive?: boolean }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body.account_id) return json({ error: 'account_id is required' }, 400)
  const accountId = body.account_id
  const archive = body.archive !== false // default: archive

  // 1. Flip the archived_at flag.
  const { error: updErr } = await admin
    .from('accounts')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', accountId)
  if (updErr) return json({ error: `Could not ${archive ? 'archive' : 'unarchive'}: ${updErr.message}` }, 500)

  // 2. Ban / unban the account's member logins (skip the preserved admin).
  const { data: members } = await admin.from('account_members').select('user_id').eq('account_id', accountId)
  let affected = 0
  for (const m of members ?? []) {
    const uid = (m as { user_id: string }).user_id
    const { data: target } = await admin.auth.admin.getUserById(uid)
    if ((target?.user?.email ?? '').toLowerCase() === PRESERVED_EMAIL) continue
    const { error: banErr } = await admin.auth.admin.updateUserById(uid, {
      ban_duration: archive ? BAN_DURATION : 'none',
    })
    if (banErr) console.error(`[admin-archive-account] ban toggle failed for ${uid}:`, banErr.message)
    else affected++
  }

  return json({ success: true, archived: archive, members_affected: affected })
})
