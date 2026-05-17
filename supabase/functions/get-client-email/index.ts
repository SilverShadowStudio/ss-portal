// Edge function: get-client-email
//
// Admin-only. Fetches a single email's rendered HTML and metadata from
// Resend's `GET /emails/{id}` endpoint. Read-only; never modifies anything.
//
// Resend exposes only `last_event` per email, not a full event timeline,
// so the `events` field in the response is either a single-element array
// or empty depending on whether Resend has recorded a delivery status yet.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

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

  let body: { email_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const emailId = body?.email_id
  if (!emailId || typeof emailId !== 'string') {
    return json({ error: 'email_id required' }, 400)
  }

  if (!resendKey) {
    return json({ error: 'RESEND_API_KEY not set' }, 500)
  }

  let resp: Response
  try {
    resp = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${resendKey}` },
    })
  } catch (e) {
    return json({ error: `Resend fetch failed: ${(e as Error).message}` }, 502)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return json(
      { error: `Resend returned ${resp.status}`, details: text.slice(0, 500) },
      resp.status === 404 ? 404 : 502,
    )
  }

  let payload: {
    id: string
    to?: string[]
    from?: string
    subject?: string
    html?: string
    text?: string
    created_at?: string
    last_event?: string
  }
  try {
    payload = await resp.json()
  } catch (e) {
    return json({ error: `Failed to parse Resend response: ${(e as Error).message}` }, 502)
  }

  const events = payload.last_event
    ? [{ name: payload.last_event, occurred_at: payload.created_at ?? null }]
    : []

  return json({
    id: payload.id,
    to: payload.to ?? [],
    from: payload.from ?? null,
    subject: payload.subject ?? '',
    html: payload.html ?? null,
    text: payload.text ?? null,
    created_at: payload.created_at ?? null,
    last_event: payload.last_event ?? null,
    events,
  })
})
