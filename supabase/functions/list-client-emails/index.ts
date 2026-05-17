// Edge function: list-client-emails
//
// Admin-only. Returns the email-send history for a given account, sourced
// from Resend's API (not a local table — this is a zero-blast-radius retrofit).
//
// Resend's `GET /emails` endpoint does NOT support filtering by recipient,
// so we paginate the global list and filter server-side by the set of
// emails belonging to users on this account (resolved via account_members
// -> auth.users.email).

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ResendEmail {
  id: string
  to: string[] | null
  from: string
  subject: string
  created_at: string
  last_event: string | null
}

interface ResendListResponse {
  object: string
  has_more: boolean
  data: ResendEmail[]
}

interface ResultRow {
  id: string
  to: string[]
  from: string
  subject: string
  created_at: string
  last_event: string | null
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Cap pagination to keep response time bounded. 5 pages * 100 = 500 emails.
const MAX_PAGES = 5
const PAGE_SIZE = 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const resendKey = Deno.env.get('RESEND_API_KEY')

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  // Verify caller is admin
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden' }, 403)

  let body: { account_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const accountId = body?.account_id
  if (!accountId || typeof accountId !== 'string') {
    return json({ error: 'account_id required' }, 400)
  }

  // Resolve every user_id on this account
  const { data: members, error: memErr } = await admin
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId)
  if (memErr) {
    console.error('[list-client-emails] members lookup failed', memErr)
    return json({ error: memErr.message }, 500)
  }
  const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[]
  if (userIds.length === 0) {
    return json({ emails: [], warning: 'No users on this account' })
  }

  // Resolve each user's email via auth admin API
  const accountEmails = new Set<string>()
  for (const uid of userIds) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(uid)
      if (!error && data?.user?.email) {
        accountEmails.add(data.user.email.toLowerCase())
      }
    } catch (e) {
      console.warn('[list-client-emails] getUserById failed for', uid, e)
    }
  }
  if (accountEmails.size === 0) {
    return json({ emails: [], warning: 'No resolvable emails for users on this account' })
  }

  if (!resendKey) {
    return json({ emails: [], warning: 'RESEND_API_KEY not set' })
  }

  // Paginate Resend's global list, filter by recipient.
  const matched: ResultRow[] = []
  let cursor: string | null = null
  let pagesFetched = 0
  let pageWarning: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://api.resend.com/emails')
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (cursor) url.searchParams.set('after', cursor)

    let resp: Response
    try {
      resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
    } catch (e) {
      pageWarning = `Resend fetch failed at page ${page + 1}: ${(e as Error).message}`
      break
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      pageWarning = `Resend returned ${resp.status} at page ${page + 1}: ${text.slice(0, 200)}`
      break
    }

    let payload: ResendListResponse
    try {
      payload = (await resp.json()) as ResendListResponse
    } catch (e) {
      pageWarning = `Failed to parse Resend response: ${(e as Error).message}`
      break
    }

    pagesFetched++
    const items = Array.isArray(payload?.data) ? payload.data : []
    for (const item of items) {
      const recipients = Array.isArray(item.to) ? item.to : []
      const lower = recipients.map((r) => (typeof r === 'string' ? r.toLowerCase() : ''))
      if (lower.some((r) => accountEmails.has(r))) {
        matched.push({
          id: item.id,
          to: recipients,
          from: item.from,
          subject: item.subject ?? '',
          created_at: item.created_at,
          last_event: item.last_event ?? null,
        })
      }
    }

    if (!payload.has_more || items.length === 0) break
    cursor = items[items.length - 1].id
  }

  matched.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return json({
    emails: matched,
    pages_scanned: pagesFetched,
    warning: pageWarning,
  })
})
