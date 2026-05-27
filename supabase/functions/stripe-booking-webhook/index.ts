import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateBookingReceiptPdf } from '../_shared/documents/bookingReceiptPdf.ts'
import { buildBookingReceiptEmail } from '../_shared/bookingReceiptEmail.ts'
import { buildBookingPaidAdminEmail } from '../_shared/bookingPaidAdminEmail.ts'
import { loadDesignConfig } from '../_shared/pdfUtils.ts'

const FROM_ADDRESS = 'Silver Shadow Studio <portal@silvershadowstudio.com>'
// Kieran runs production scheduling, so paid bookings are operationally his —
// same recipient set as the Airtable auto-sync notifications.
const ADMIN_EMAILS = ['fred@silvershadowstudio.com', 'kieran@silvershadowstudio.com']
const PORTAL_URL = 'https://portal.silvershadowstudio.com'

function ok(msg = 'ok') { return new Response(msg, { status: 200 }) }

// ── Manual Stripe signature verification (no SDK). Stripe's `Stripe-Signature`
//    header is "t=<unix>,v1=<hex hmac>[,v1=...]"; the signed payload is
//    `${t}.${rawBody}`, HMAC-SHA256 with the endpoint secret. ──
async function verifyStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const parts = header.split(',').map((kv) => kv.split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const v1s = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || v1s.length === 0) return false
  // Replay guard: reject signatures older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return v1s.some((v) => timingSafeEqualHex(v, expected))
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const fmtMoney = (n: number) => `£${(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function fmtRange(start?: string | null, end?: string | null): string | null {
  if (!start) return null
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const s = new Date(start)
  return end ? `${fmt(s)} — ${fmt(new Date(end))}` : fmt(s)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET')
  if (!secret) { console.error('STRIPE_TEST_WEBHOOK_SECRET not set'); return new Response('Not configured', { status: 500 }) }

  const raw = await req.text()
  const valid = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret)
  if (!valid) { console.error('Invalid Stripe signature'); return new Response('Invalid signature', { status: 400 }) }

  // deno-lint-ignore no-explicit-any
  let event: any
  try { event = JSON.parse(raw) } catch { return new Response('Bad payload', { status: 400 }) }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const type: string = event.type

  // ── Failure / expiry: mark the row, leave the rounds reserved for retry ──
  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    const session = event.data.object
    const newStatus = type === 'checkout.session.expired' ? 'cancelled' : 'failed'
    const { data: row } = await admin.from('booking_payments')
      .update({ status: newStatus }).eq('stripe_session_id', session.id).is('paid_at', null)
      .select('account_id, booking_group_id').maybeSingle()
    if (row) {
      await admin.from('activity_log').insert({
        actor_role: 'client', action: 'booking_payment_failed',
        description: `Checkout ${newStatus}`, entity_type: 'booking_payment',
        metadata: { booking_group_id: row.booking_group_id, session_id: session.id },
      }).then(() => {}, () => {})
    }
    return ok()
  }

  if (type !== 'checkout.session.completed') return ok('ignored')

  const session = event.data.object
  const sessionId: string = session.id
  const paymentIntentId: string | null = session.payment_intent ?? null
  const customerEmail: string | null = session.customer_details?.email ?? session.customer_email ?? null

  // ── Idempotency lock: only the first call where paid_at IS NULL wins ──
  const paidAt = new Date().toISOString()
  const { data: locked } = await admin.from('booking_payments')
    .update({ status: 'paid', paid_at: paidAt, stripe_payment_intent_id: paymentIntentId })
    .eq('stripe_session_id', sessionId).is('paid_at', null)
    .select('*').maybeSingle()
  if (!locked) return ok('already processed') // duplicate delivery or unknown session

  const bookingGroupId: string = locked.booking_group_id
  const accountId: string = locked.account_id

  // ── Flip every round in the group reserved-or-cancelled → pending (§5.2) ──
  await admin.from('scene_rounds')
    .update({ status: 'pending', reservation_expires_at: null })
    .eq('booking_group_id', bookingGroupId).in('status', ['reserved', 'cancelled'])

  // ── Gather data for the receipt + emails ──
  const { data: rounds } = await admin.from('scene_rounds')
    .select('round_number, round_fee, start_date, end_date, created_by, scenes(name, projects(name))')
    .eq('booking_group_id', bookingGroupId).order('round_number')
  // deno-lint-ignore no-explicit-any
  const rs = (rounds ?? []) as any[]
  const sceneName: string | null = rs[0]?.scenes?.name ?? null
  const projectName: string | null = rs[0]?.scenes?.projects?.name ?? null
  const bookerId: string | null = rs[0]?.created_by ?? null

  const { data: account } = await admin.from('accounts').select('company_name').eq('id', accountId).maybeSingle()
  const accountName = account?.company_name ?? 'Client'
  let contactName: string | null = null
  if (bookerId) {
    const { data: prof } = await admin.from('profiles').select('first_name, last_name').eq('user_id', bookerId).maybeSingle()
    contactName = [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') || null
  }

  const optLabel = locked.payment_option === 'deposit_50'
    ? '50% deposit now, 50% on delivery (net 15)'
    : 'Pay in full now (3% discount)'
  const receiptNumber = `BR-${String(locked.id).slice(0, 8).toUpperCase()}-${paidAt.slice(0, 7).replace('-', '')}`

  // ── Receipt PDF → private booking-receipts bucket ──
  const design = await loadDesignConfig(admin)
  let receiptPath: string | null = null
  try {
    const pdf = generateBookingReceiptPdf({
      receiptNumber,
      paidAt,
      accountName,
      contactName,
      contactEmail: customerEmail,
      projectName,
      sceneName,
      lineItems: rs.map((r) => ({ roundNumber: r.round_number, fee: Number(r.round_fee) || 0 })),
      subtotal: Number(locked.subtotal_gbp) || 0,
      vat: Number(locked.vat_gbp) || 0,
      gross: Number(locked.total_gbp) || 0,
      discount: Number(locked.discount_gbp) || 0,
      amountCharged: Number(locked.amount_charged_gbp) || 0,
      amountOutstanding: Number(locked.amount_outstanding_gbp) || 0,
      paymentOptionLabel: optLabel,
      stripePaymentIntentId: paymentIntentId,
      currency: 'GBP',
    }, design)

    receiptPath = `${accountId}/${locked.id}.pdf`
    const { error: upErr } = await admin.storage.from('booking-receipts')
      .upload(receiptPath, pdf, { contentType: 'application/pdf', upsert: true })
    if (upErr) { console.error('Receipt upload failed:', upErr); receiptPath = null }
    else await admin.from('booking_payments').update({ receipt_pdf_path: receiptPath }).eq('id', locked.id)

    // ── Emails (client receipt w/ attachment + admin notification) ──
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey) {
      const emailRounds = rs.map((r) => ({ roundNumber: r.round_number, range: fmtRange(r.start_date, r.end_date) }))
      const sends: Promise<unknown>[] = []
      if (customerEmail) {
        const clientHtml = buildBookingReceiptEmail({
          firstName: contactName, projectName, sceneName, rounds: emailRounds,
          amountPaid: fmtMoney(Number(locked.amount_charged_gbp) || 0),
          amountOutstanding: Number(locked.amount_outstanding_gbp) > 0 ? fmtMoney(Number(locked.amount_outstanding_gbp)) : null,
          portalUrl: `${PORTAL_URL}/portfolio`, backgroundColor: design.background_color,
        })
        sends.push(fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_ADDRESS, to: [customerEmail],
            subject: 'Your Silver Shadow Studio booking is confirmed',
            html: clientHtml,
            attachments: [{ filename: `${receiptNumber}.pdf`, content: toBase64(pdf) }],
          }),
        }))
      }
      const adminHtml = buildBookingPaidAdminEmail({
        accountName, projectName, sceneName, rounds: emailRounds,
        amountPaid: fmtMoney(Number(locked.amount_charged_gbp) || 0),
        paymentOptionLabel: optLabel, adminUrl: `${PORTAL_URL}/admin/bookings`, backgroundColor: design.background_color,
      })
      sends.push(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_ADDRESS, to: ADMIN_EMAILS, subject: `New booking paid — ${accountName}`, html: adminHtml }),
      }))
      await Promise.allSettled(sends)
    }
  } catch (e) {
    // Payment is already recorded + rounds flipped; a receipt/email failure must
    // not 500 back to Stripe (it would retry and we'd double-send).
    console.error('Receipt/email step failed:', e instanceof Error ? e.message : String(e))
  }

  await admin.from('activity_log').insert({
    actor_user_id: bookerId, actor_role: 'client', action: 'booking_paid',
    description: `Booking paid — ${fmtMoney(Number(locked.amount_charged_gbp) || 0)} (${optLabel})`,
    entity_type: 'booking_payment',
    metadata: { booking_group_id: bookingGroupId, payment_intent: paymentIntentId, amount_charged: locked.amount_charged_gbp },
  }).then(() => {}, () => {})

  return ok()
})
