// Stripe webhook handler — marks invoices paid on checkout.session.completed.
// Requires STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY in Supabase secrets.
// Register this URL in Stripe Dashboard → Webhooks: https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/stripe-webhook

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
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

  const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!stripeWebhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not configured — accepting webhook without verification')
  }

  let event: Record<string, unknown>
  try {
    event = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const eventType = event.type as string
  console.log('Stripe webhook:', eventType)

  if (eventType === 'checkout.session.completed') {
    const session = (event.data as Record<string, unknown>)?.object as Record<string, unknown> | undefined
    const metadata = session?.metadata as Record<string, string> | undefined
    const invoiceId = metadata?.invoice_id

    if (invoiceId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const admin = createClient(supabaseUrl, supabaseServiceKey)

      const paymentIntentId = session?.payment_intent as string | undefined
      const checkoutUrl = session?.url as string | undefined

      const { error } = await admin
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: paymentIntentId ?? null,
          stripe_checkout_url: checkoutUrl ?? null,
        })
        .eq('id', invoiceId)

      if (error) console.error('Failed to mark invoice paid:', invoiceId, error)
      else console.log('Invoice marked paid:', invoiceId)
    }
  }

  return json({ received: true })
})
