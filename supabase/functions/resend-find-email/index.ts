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
 * Admin-only triage tool. Two modes:
 *   1. POST { recipient, after?, before?, max_pages? }
 *      → paginate Resend's GET /emails (recipient filter not supported
 *      server-side), narrow to messages for `recipient` in the time
 *      window, and return GET /emails/{id} detail for each hit.
 *   2. POST { probe_endpoints: true, email_id, recipient? }
 *      → probe undocumented/less-used Resend endpoints (events, bounce,
 *      suppressions) and return raw responses for each.
 *
 * Service-role bearer is accepted as a shell-side bypass.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const resendKey = Deno.env.get('RESEND_API_KEY')

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const bearer = authHeader.slice('Bearer '.length).trim()

  if (bearer !== supabaseServiceKey) {
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, supabaseServiceKey)
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'admin')
      .maybeSingle()
    if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)
  }

  if (!resendKey) return json({ error: 'RESEND_API_KEY not set' }, 500)

  let body: {
    recipient?: string
    after?: string
    before?: string
    max_pages?: number
    probe_endpoints?: boolean
    email_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // --- Probe mode -----------------------------------------------------
  if (body.probe_endpoints) {
    const eid = body.email_id ?? ''
    const recipient = body.recipient ?? ''
    const paths = [
      `/events?limit=20`,
      eid ? `/events?email_id=${eid}` : null,
      eid ? `/events?email=${eid}` : null,
      eid ? `/v1/emails/${eid}/events` : null,
      recipient ? `/events?recipient=${encodeURIComponent(recipient)}` : null,
      recipient ? `/events?to=${encodeURIComponent(recipient)}` : null,
      eid ? `/audit-logs?email_id=${eid}` : null,
      recipient ? `/emails?to=${encodeURIComponent(recipient)}` : null,
    ].filter(Boolean) as string[]

    const probes: Array<{ path: string; status: number; body: unknown }> = []
    for (const path of paths) {
      const r = await fetch(`https://api.resend.com${path}`, {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
      let parsed: unknown
      const text = await r.text()
      try { parsed = JSON.parse(text) } catch { parsed = text }
      probes.push({ path, status: r.status, body: parsed })
    }
    return json({ probes })
  }

  // --- Listing mode ---------------------------------------------------
  const recipient = body.recipient?.trim().toLowerCase()
  if (!recipient) return json({ error: 'recipient is required' }, 400)
  const after = body.after ? new Date(body.after).getTime() : null
  const before = body.before ? new Date(body.before).getTime() : null
  const maxPages = Math.min(20, Math.max(1, body.max_pages ?? 10))

  type ResendListItem = {
    id: string
    to: string[] | string
    from: string
    subject?: string
    created_at: string
    last_event?: string | null
  }
  type ResendListResponse = { data?: ResendListItem[]; has_more?: boolean }

  const matchedSummaries: ResendListItem[] = []
  let cursor: string | null = null
  let pagesFetched = 0
  let pageWarning: string | null = null

  for (let page = 0; page < maxPages; page++) {
    const url = new URL('https://api.resend.com/emails')
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('after', cursor)
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${resendKey}` },
    })
    if (!resp.ok) {
      pageWarning = `Resend ${resp.status} at page ${page + 1}: ${(await resp.text()).slice(0, 200)}`
      break
    }
    const payload = (await resp.json()) as ResendListResponse
    pagesFetched++
    const items = Array.isArray(payload.data) ? payload.data : []
    for (const item of items) {
      const recipients = Array.isArray(item.to) ? item.to : [item.to]
      const lower = recipients.map((r) => (typeof r === 'string' ? r.toLowerCase() : ''))
      if (!lower.includes(recipient)) continue
      const ts = new Date(item.created_at).getTime()
      if (after !== null && ts < after) continue
      if (before !== null && ts > before) continue
      matchedSummaries.push(item)
    }
    if (!payload.has_more || items.length === 0) break
    cursor = items[items.length - 1].id
  }

  const details: Array<{ id: string; detail: unknown; warning?: string }> = []
  for (const m of matchedSummaries) {
    const detailRes = await fetch(`https://api.resend.com/emails/${m.id}`, {
      headers: { Authorization: `Bearer ${resendKey}` },
    })
    if (!detailRes.ok) {
      details.push({
        id: m.id,
        detail: null,
        warning: `GET /emails/${m.id} failed: ${detailRes.status} ${(await detailRes.text()).slice(0, 300)}`,
      })
      continue
    }
    details.push({ id: m.id, detail: await detailRes.json() })
  }

  return json({
    pages_fetched: pagesFetched,
    match_count: matchedSummaries.length,
    page_warning: pageWarning,
    summaries: matchedSummaries,
    details,
  })
})
