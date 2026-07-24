// Edge function: dispatch-pending-deliveries
//
// Cron target. Runs every 5 minutes (see migration 20260518000001).
// Reads up to N due-but-unsent rows from pending_delivery_notifications,
// invokes send-delivery-notification for each via server-to-server fetch
// using the service-role bearer.
//
// The dispatcher itself does not send the email — it just routes. The send
// function handles Resend + marking sent_at. Errors are recorded on the row.
//
// This function is intentionally idempotent: rows are picked up by send_at;
// once send-delivery-notification stamps sent_at the row is no longer due.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { requireCronOrAdmin } from '../_shared/cronAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BATCH_SIZE = 50

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Auth: pg_cron (*/5) presenting X-Cron-Secret, or an admin JWT for a manual
  // flush. Previously ungated — the cron carried only the anon Bearer, which is
  // public, so any caller could drain the delivery queue and fire client emails
  // early.
  const auth = await requireCronOrAdmin(req, {
    secretEnvVar: 'CRON_SECRET',
    corsHeaders,
  })
  if (!auth.ok) return auth.response

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const admin = createClient(supabaseUrl, serviceKey)

  const nowIso = new Date().toISOString()
  const { data: due, error } = await admin
    .from('pending_delivery_notifications')
    .select('id')
    .is('sent_at', null)
    .lte('send_at', nowIso)
    .order('send_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[dispatch-pending-deliveries] query failed', error)
    return json({ error: error.message }, 500)
  }

  const ids = (due ?? []).map((r: any) => r.id as string)
  if (ids.length === 0) return json({ processed: 0 })

  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-delivery-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ pending_id: id }),
      })
      if (resp.ok) {
        results.push({ id, ok: true })
      } else {
        const text = await resp.text().catch(() => '')
        results.push({ id, ok: false, error: `${resp.status}: ${text.slice(0, 200)}` })
      }
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message })
    }
  }

  return json({
    processed: ids.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failures: results.filter((r) => !r.ok),
  })
})
