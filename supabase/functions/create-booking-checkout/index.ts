import { createClient } from 'npm:@supabase/supabase-js@2'
import { calculateTotalsForRounds, calculatePaymentOption, type PaymentOption } from '../_shared/roundPricing.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const DEFAULT_ORIGIN = 'https://portal.silvershadowstudio.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // Test-mode key only for this commit; the live STRIPE_SECRET_KEY is left for
  // the existing invoice flow (Fred's decision, Part 0).
  const stripeKey = Deno.env.get('STRIPE_TEST_SECRET_KEY')
  if (!stripeKey) return json({ error: 'Stripe test key not configured' }, 500)

  // ── Auth: caller must be signed in ──
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
  const callerId = userData.user.id
  const callerEmail = userData.user.email ?? undefined

  let body: { booking_group_id?: string; payment_option?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const bookingGroupId = body.booking_group_id?.trim()
  const paymentOption = body.payment_option as PaymentOption | undefined
  if (!bookingGroupId) return json({ error: 'booking_group_id is required' }, 400)
  if (paymentOption !== 'deposit_50' && paymentOption !== 'full_100_discount_3') {
    return json({ error: 'Invalid payment_option' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey)

  // ── Load the booking's rounds + scene/project/account ──
  const { data: rounds } = await admin
    .from('scene_rounds')
    .select('id, round_number, status, reservation_expires_at, scene_id, scenes(name, projects(name, account_id))')
    .eq('booking_group_id', bookingGroupId)
  if (!rounds || rounds.length === 0) return json({ error: 'Booking not found' }, 404)

  // deno-lint-ignore no-explicit-any
  const first = rounds[0] as any
  const accountId: string | undefined = first?.scenes?.projects?.account_id
  const sceneName: string = first?.scenes?.name ?? 'Scene'
  if (!accountId) return json({ error: 'Booking account not resolved' }, 400)

  // ── Manager gate: caller must be a non-invitee member of the account ──
  const { data: callerRow } = await admin
    .from('account_members').select('role').eq('account_id', accountId).eq('user_id', callerId).maybeSingle()
  if (!callerRow || callerRow.role === 'client_invitee') return json({ error: 'Only a manager can pay for a booking' }, 403)

  // ── All rounds must still be reserved + unexpired ──
  const now = Date.now()
  for (const r of rounds as Array<{ status: string; reservation_expires_at: string | null }>) {
    if (r.status !== 'reserved') return json({ error: 'Booking is no longer reservable' }, 409)
    if (r.reservation_expires_at && new Date(r.reservation_expires_at).getTime() < now) {
      return json({ error: 'Reservation has expired' }, 409)
    }
  }

  // ── Existing payment row? Block if already paid; otherwise we reuse the row
  //    (booking_group_id is UNIQUE) and overwrite it with a fresh Stripe
  //    session — simplest + avoids stale/duplicate sessions. ──
  const { data: existing } = await admin
    .from('booking_payments').select('id, status').eq('booking_group_id', bookingGroupId).maybeSingle()
  if (existing?.status === 'paid') return json({ error: 'Booking already paid' }, 409)

  // ── Totals + payment option ──
  const roundNumbers = (rounds as Array<{ round_number: number }>).map((r) => r.round_number)
  const totals = calculateTotalsForRounds(roundNumbers)
  const opt = calculatePaymentOption(totals.netTotal, totals.vatAmount, totals.grossTotal, paymentOption)
  const amountPence = Math.round(opt.amount_to_charge * 100)
  const numRounds = roundNumbers.length
  const description = paymentOption === 'deposit_50'
    ? `50% deposit — ${numRounds} round${numRounds === 1 ? '' : 's'}, ${sceneName}`
    : `Full payment (3% discount) — ${numRounds} round${numRounds === 1 ? '' : 's'}, ${sceneName}`

  // ── Bump the hold +2 days so it can't lapse while the client is on Stripe (§5.2) ──
  await admin.from('scene_rounds')
    .update({ reservation_expires_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString() })
    .eq('booking_group_id', bookingGroupId).eq('status', 'reserved')

  // ── Create the Stripe Checkout session via REST (no SDK). Single line item =
  //    amount to charge; the per-round breakdown lives on the receipt PDF (§5.3). ──
  const origin = req.headers.get('origin') || DEFAULT_ORIGIN
  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('success_url', `${origin}/portfolio?booking_paid=1`)
  form.set('cancel_url', `${origin}/portfolio?booking_canceled=1`)
  if (callerEmail) form.set('customer_email', callerEmail)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', 'gbp')
  form.set('line_items[0][price_data][unit_amount]', String(amountPence))
  form.set('line_items[0][price_data][product_data][name]', description)
  form.set('metadata[booking_group_id]', bookingGroupId)
  form.set('metadata[payment_option]', paymentOption)
  form.set('metadata[account_id]', accountId)

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!stripeRes.ok) {
    console.error('Stripe checkout create failed:', await stripeRes.text())
    return json({ error: 'Could not start checkout' }, 502)
  }
  const session = await stripeRes.json()

  // ── Upsert booking_payments (booking_group_id UNIQUE) — fresh pending row ──
  const { error: upErr } = await admin.from('booking_payments').upsert({
    booking_group_id: bookingGroupId,
    account_id: accountId,
    stripe_session_id: session.id,
    stripe_payment_intent_id: null,
    payment_option: paymentOption,
    subtotal_gbp: totals.netTotal,
    vat_gbp: totals.vatAmount,
    discount_gbp: opt.discount,
    total_gbp: totals.grossTotal,
    amount_charged_gbp: opt.amount_to_charge,
    amount_outstanding_gbp: opt.amount_outstanding,
    status: 'pending',
    paid_at: null,
    metadata: { rounds: roundNumbers, scene_name: sceneName },
  } as Record<string, unknown>, { onConflict: 'booking_group_id' })
  if (upErr) {
    console.error('booking_payments upsert failed:', upErr)
    return json({ error: 'Could not record payment' }, 500)
  }

  await admin.from('activity_log').insert({
    actor_user_id: callerId,
    actor_role: 'client',
    action: 'booking_checkout_started',
    description: `Started checkout for ${numRounds} round${numRounds === 1 ? '' : 's'} (${opt.label})`,
    entity_type: 'booking_payment',
    metadata: { booking_group_id: bookingGroupId, session_id: session.id, payment_option: paymentOption },
  }).then(() => {}, () => {})

  return json({ checkout_url: session.url, session_id: session.id })
})
