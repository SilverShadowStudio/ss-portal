// Edge function: create-balance-invoice
//
// Admin-only. Given a scene_id, finds the most recent signed quotation for
// the scene's account, calculates the balance as:
//   balance = gross_total * (1 - deposit_percentage / 100)
// Creates a balance invoice (type='balance'), pre-generates the Stripe
// checkout URL, and dispatches the branded invoice email via send-invoice-email.
//
// Fails soft on Stripe + email — the invoice row is always created if we get
// past auth + quotation lookup.

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

  let body: { scene_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const sceneId = body?.scene_id
  if (!sceneId || typeof sceneId !== 'string') {
    return json({ error: 'scene_id required' }, 400)
  }

  // Resolve scene → project → account
  const { data: scene, error: sceneErr } = await admin
    .from('scenes')
    .select('id, name, project_id')
    .eq('id', sceneId)
    .maybeSingle()
  if (sceneErr || !scene) return json({ error: 'Scene not found' }, 404)

  const { data: project, error: projErr } = await admin
    .from('projects')
    .select('id, name, account_id, user_id')
    .eq('id', scene.project_id)
    .maybeSingle()
  if (projErr || !project) return json({ error: 'Project not found' }, 404)

  const accountId = project.account_id
  if (!accountId) return json({ error: 'Project has no account_id' }, 422)

  // Most recent signed quotation for the account
  const { data: quotation, error: qErr } = await admin
    .from('quotation_documents')
    .select('id, account_id, user_id, quotation_number, reference_number, currency, gross_total, net_total, vat_rate, deposit_percentage, amount, signed_at')
    .eq('account_id', accountId)
    .eq('status', 'signed')
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (qErr || !quotation) {
    return json({ error: 'No signed quotation found for this account' }, 404)
  }

  const grossTotal = Number(quotation.gross_total ?? quotation.amount ?? 0)
  const depositPct = Number(quotation.deposit_percentage ?? 50)
  if (!isFinite(grossTotal) || grossTotal <= 0) {
    return json({ error: 'Quotation has no gross_total — cannot compute balance' }, 422)
  }

  const balanceAmount = +(grossTotal * (1 - depositPct / 100)).toFixed(2)
  if (balanceAmount <= 0) {
    return json({ error: 'Balance amount is zero or negative' }, 422)
  }

  const vatRate = Number(quotation.vat_rate ?? 20)
  const balanceSubtotal = +(balanceAmount / (1 + vatRate / 100)).toFixed(2)
  const balanceVat = +(balanceAmount - balanceSubtotal).toFixed(2)

  const issuedAt = new Date().toISOString()
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const quotationNumber = quotation.quotation_number || quotation.reference_number || ''
  const suffix = Date.now().toString(36).toUpperCase().slice(-4)
  const balanceInvoiceNumber = `BAL-${quotationNumber || sceneId.slice(0, 8)}-${suffix}`
  const remainingPct = +(100 - depositPct).toFixed(2)

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .insert({
      account_id: accountId,
      user_id: quotation.user_id ?? project.user_id ?? null,
      project_id: project.id,
      invoice_number: balanceInvoiceNumber,
      reference_number: balanceInvoiceNumber,
      quotation_id: quotation.id,
      type: 'balance',
      amount: balanceAmount,
      subtotal: balanceSubtotal,
      vat_rate: vatRate,
      vat_amount: balanceVat,
      currency: quotation.currency ?? 'GBP',
      status: 'sent',
      due_date: dueDate,
      issued_at: issuedAt,
      notes: `${remainingPct}% balance for quotation ${quotationNumber}`,
      line_items: [{
        description: `${remainingPct}% Balance — ${quotationNumber}${scene.name ? ` (${scene.name})` : ''}`,
        quantity: 1,
        unit_price: balanceAmount,
      }],
    })
    .select('id')
    .single()

  if (invErr || !invoice?.id) {
    console.error('[create-balance-invoice] insert failed', invErr)
    return json({ error: invErr?.message || 'Failed to create invoice' }, 500)
  }

  // Pre-generate Stripe checkout URL. Fail-soft.
  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (stripeKey) {
      const Stripe = (await import('https://esm.sh/stripe@17.2.0?target=deno')).default
      const stripe = new Stripe(stripeKey, { apiVersion: '2024-10-28.acacia' })
      const origin = req.headers.get('origin') || 'https://portal.silvershadowstudio.com'
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: (quotation.currency ?? 'GBP').toLowerCase(),
            unit_amount: Math.round(balanceAmount * 100),
            product_data: { name: `Invoice ${balanceInvoiceNumber}` },
          },
          quantity: 1,
        }],
        success_url: `${origin}/invoices?paid=1&invoice=${invoice.id}`,
        cancel_url: `${origin}/invoices?canceled=1`,
        metadata: { invoice_id: invoice.id },
      })
      if (session.url) {
        await admin
          .from('invoices')
          .update({ stripe_checkout_url: session.url })
          .eq('id', invoice.id)
      }
    } else {
      console.warn('[create-balance-invoice] STRIPE_SECRET_KEY not set — skipping checkout pre-gen')
    }
  } catch (e) {
    console.warn('[create-balance-invoice] Stripe pre-gen failed (non-fatal):', (e as Error).message)
  }

  // Dispatch branded invoice email. Fail-soft.
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-invoice-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ invoiceId: invoice.id }),
    })
  } catch (e) {
    console.warn('[create-balance-invoice] email dispatch failed (non-fatal):', (e as Error).message)
  }

  return json({
    success: true,
    invoiceId: invoice.id,
    invoiceNumber: balanceInvoiceNumber,
    amount: balanceAmount,
    currency: quotation.currency ?? 'GBP',
    quotationId: quotation.id,
    quotationNumber,
  })
})
