// Edge function: admin-list-account-users
// Returns every individual user across every account, with the email
// resolved via the service-role auth API (front-end can't read auth.users).
// Used by AdminClients (filter: account_type in partnership/project) and
// AdminTeam (filter: account_type = 'team').

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface AccountUserRow {
  account_id: string
  company_name: string
  account_type: string | null
  account_created_at: string | null
  client_code: string | null
  archived_at: string | null
  user_id: string
  email: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  position: string | null
  member_role: string | null
  employment_type: string | null
  joined_at: string | null
  last_login_at: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // Verify the caller is admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Optional filter: ?accountTypes=team or ?accountTypes=partnership,project
    const url = new URL(req.url)
    const filterStr = url.searchParams.get('accountTypes') ?? ''
    const allowedTypes = filterStr
      ? filterStr.split(',').map((s) => s.trim()).filter(Boolean)
      : null

    // 1. Accounts (optionally filtered by type)
    let accountsQuery = admin
      .from('accounts')
      .select('id, company_name, account_type, created_at, client_code, archived_at, position, team_role, employment_type')
      .order('company_name', { ascending: true })
    if (allowedTypes && allowedTypes.length) {
      accountsQuery = accountsQuery.in('account_type', allowedTypes)
    }
    const { data: accounts, error: aErr } = await accountsQuery
    if (aErr) throw aErr

    const accountIds = (accounts ?? []).map((a) => a.id)
    if (accountIds.length === 0) {
      return new Response(JSON.stringify({ rows: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Members across those accounts
    const { data: members } = await admin
      .from('account_members')
      .select('account_id, user_id, role, joined_at, last_login_at')
      .in('account_id', accountIds)
      .order('joined_at', { ascending: true })

    const memberRows = members ?? []
    const userIds = Array.from(new Set(memberRows.map((m) => m.user_id)))

    // 3. Profiles for those users
    const { data: profiles } = userIds.length
      ? await admin
          .from('profiles')
          .select('user_id, full_name, first_name, last_name, position')
          .in('user_id', userIds)
      : { data: [] as any[] }
    const profileByUser = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]))

    // 3b. Team members' names/roles live in freelancer_profiles, not profiles.
    const { data: fprofiles } = userIds.length
      ? await admin.from('freelancer_profiles').select('user_id, first_name, last_name, role').in('user_id', userIds)
      : { data: [] as any[] }
    const fpByUser = new Map<string, any>((fprofiles ?? []).map((p: any) => [p.user_id, p]))

    // 4. Last session_start per user (most recent across all sessions)
    const { data: lastSessions } = userIds.length
      ? await admin
          .from('client_activity')
          .select('user_id, started_at')
          .in('user_id', userIds)
          .eq('kind', 'session_start')
          .order('started_at', { ascending: false })
      : { data: [] as any[] }
    const lastSessionByUser = new Map<string, string>()
    for (const row of (lastSessions ?? []) as Array<{ user_id: string; started_at: string }>) {
      if (!lastSessionByUser.has(row.user_id)) lastSessionByUser.set(row.user_id, row.started_at)
    }

    // 5. Emails via the auth admin API. Fetch per id (cheap for our scale —
    //    fewer than a couple of dozen users in total at the moment).
    const emailByUser = new Map<string, string>()
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          const { data } = await admin.auth.admin.getUserById(uid)
          if (data?.user?.email) emailByUser.set(uid, data.user.email)
        } catch { /* ignore individual lookup failures */ }
      }),
    )

    // 6. Assemble rows
    const accountById = new Map<string, any>((accounts ?? []).map((a: any) => [a.id, a]))
    const rows: AccountUserRow[] = memberRows.map((m: any) => {
      const a = accountById.get(m.account_id)
      const p = profileByUser.get(m.user_id) ?? null
      const fp = fpByUser.get(m.user_id) ?? null
      // Prefer cached account_members.last_login_at; fall back to live MAX(client_activity).
      const lastLogin = m.last_login_at ?? lastSessionByUser.get(m.user_id) ?? null
      return {
        account_id:         m.account_id,
        company_name:       a?.company_name ?? '',
        account_type:       a?.account_type ?? null,
        account_created_at: a?.created_at ?? null,
        client_code:        a?.client_code ?? null,
        archived_at:        a?.archived_at ?? null,
        user_id:            m.user_id,
        email:              emailByUser.get(m.user_id) ?? null,
        // Team names live in freelancer_profiles; clients in profiles.
        full_name:          p?.full_name ?? null,
        first_name:         p?.first_name ?? fp?.first_name ?? null,
        last_name:          p?.last_name ?? fp?.last_name ?? null,
        // Team position: employee position, else invite role, else profile role.
        position:           a?.position ?? a?.team_role ?? p?.position ?? fp?.role ?? null,
        member_role:        m.role ?? null,
        employment_type:    a?.employment_type ?? null,
        joined_at:          m.joined_at ?? null,
        last_login_at:      lastLogin,
      }
    })

    return new Response(JSON.stringify({ rows }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('admin-list-account-users error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
