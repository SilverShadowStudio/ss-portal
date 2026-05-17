// Edge function: send-delivery-notification
//
// Sends a single "your renders are ready" email for one pending delivery
// notification row. Called by dispatch-pending-deliveries on the cron schedule.
//
// Input: { pending_id }  — a uuid in pending_delivery_notifications
// Auth:  service-role bearer (called server-to-server from the dispatcher)
//
// Resolves recipients via account_members → auth.users.email. Sends via Resend.
// Marks the queue row as sent (or records last_error + attempts on failure).

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LOGO_URL =
  'https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png'
const FROM_ADDRESS = 'Silvershadow Studio <portal@silvershadowstudio.com>'
const PORTFOLIO_URL = 'https://portal.silvershadowstudio.com/portfolio'
const BACKGROUND_COLOR = '#EDE8E0'

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface DeliveryPayload {
  project_name?: string | null
  scene_name?: string | null
  round_number?: number | null
  recipients?: string[]
}

function buildDeliveryEmailHtml(args: {
  projectName: string
  sceneName: string
  roundLabel: string
}): string {
  const { projectName, sceneName, roundLabel } = args
  const bodyCopy =
    `Your renders for ${projectName} are ready for review. ${roundLabel} of ${sceneName} has just been delivered to your portal.`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${BACKGROUND_COLOR}"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BACKGROUND_COLOR}"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:40px"><img src="${LOGO_URL}" alt="Silvershadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8A8070;text-align:center;margin:0 0 24px">${roundLabel} · ${escapeHtml(sceneName)}</p><p style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1A1814;text-align:center;margin:0 0 32px;letter-spacing:0.02em">${escapeHtml(projectName)}</p><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:360px;margin:0 auto 36px">${escapeHtml(bodyCopy)}</p><p style="text-align:center;margin:0 0 40px"><a href="${PORTFOLIO_URL}" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:underline;display:block">View your renders</a></p><p style="font-family:Arial,sans-serif;font-size:11px;text-align:center;margin:0"><a href="https://www.silvershadowstudio.com" style="color:#8A8070;text-decoration:none">silvershadowstudio.com</a></p></td></tr></table></td></tr></table></body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function resolveRecipients(
  admin: ReturnType<typeof createClient>,
  accountId: string,
): Promise<string[]> {
  const { data: members } = await admin
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId)
  const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean) as string[]
  const emails: string[] = []
  for (const uid of userIds) {
    try {
      const { data } = await admin.auth.admin.getUserById(uid)
      if (data?.user?.email) emails.push(data.user.email)
    } catch (e) {
      console.warn('[send-delivery-notification] getUserById failed', uid, e)
    }
  }
  return emails
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const resendKey = Deno.env.get('RESEND_API_KEY')

  if (!resendKey) return json({ error: 'RESEND_API_KEY not set' }, 500)

  const admin = createClient(supabaseUrl, serviceKey)

  let body: { pending_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const pendingId = body?.pending_id
  if (!pendingId || typeof pendingId !== 'string') {
    return json({ error: 'pending_id required' }, 400)
  }

  const { data: pending, error: fetchErr } = await admin
    .from('pending_delivery_notifications')
    .select('id, scene_round_id, account_id, payload, sent_at, attempts')
    .eq('id', pendingId)
    .maybeSingle()

  if (fetchErr || !pending) {
    return json({ error: 'Pending notification not found' }, 404)
  }
  if (pending.sent_at) {
    return json({ success: true, skipped: 'already sent' })
  }

  const payload = (pending.payload ?? {}) as DeliveryPayload
  const projectName = (payload.project_name ?? '').toString().trim() || 'your project'
  const sceneName = (payload.scene_name ?? '').toString().trim() || 'a scene'
  const roundNumber = Number(payload.round_number ?? 0)
  const roundLabel = `Round ${String(roundNumber).padStart(2, '0')}`

  // Prefer recipients carried on the payload (snapshot at enqueue time).
  // Fall back to live resolution if missing.
  const recipientsFromPayload = Array.isArray(payload.recipients)
    ? payload.recipients.filter((r): r is string => typeof r === 'string' && r.length > 0)
    : []
  const recipients = recipientsFromPayload.length > 0
    ? recipientsFromPayload
    : await resolveRecipients(admin, pending.account_id)

  if (recipients.length === 0) {
    const message = 'No recipients to send to'
    await admin
      .from('pending_delivery_notifications')
      .update({ attempts: (pending.attempts ?? 0) + 1, last_error: message })
      .eq('id', pendingId)
    return json({ error: message }, 422)
  }

  const subject = `Your renders are ready — ${projectName}`
  const html = buildDeliveryEmailHtml({ projectName, sceneName, roundLabel })

  let resendResp: Response
  try {
    resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: recipients,
        subject,
        html,
      }),
    })
  } catch (e) {
    const message = `Resend fetch failed: ${(e as Error).message}`
    await admin
      .from('pending_delivery_notifications')
      .update({ attempts: (pending.attempts ?? 0) + 1, last_error: message })
      .eq('id', pendingId)
    return json({ error: message }, 502)
  }

  if (!resendResp.ok) {
    const text = await resendResp.text().catch(() => '')
    const message = `Resend returned ${resendResp.status}: ${text.slice(0, 200)}`
    await admin
      .from('pending_delivery_notifications')
      .update({ attempts: (pending.attempts ?? 0) + 1, last_error: message })
      .eq('id', pendingId)
    return json({ error: message }, 502)
  }

  await admin
    .from('pending_delivery_notifications')
    .update({ sent_at: new Date().toISOString(), last_error: null })
    .eq('id', pendingId)

  return json({ success: true, recipients_count: recipients.length })
})
