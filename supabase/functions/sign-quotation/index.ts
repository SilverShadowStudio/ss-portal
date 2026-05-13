import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  let body: { quotation_id: string; signed_by_name: string; signed_by_position?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { quotation_id, signed_by_name, signed_by_position } = body
  if (!quotation_id || !signed_by_name?.trim()) {
    return json({ error: 'quotation_id and signed_by_name are required' }, 400)
  }

  // Load quotation — RLS ensures caller has read access (account member or admin)
  const { data: quotation } = await userClient
    .from('quotation_documents')
    .select('id, status, account_id, user_id, amount, subtotal, vat_rate, vat_amount, deposit_percentage, gross_total, net_total, currency, quotation_number, reference_number')
    .eq('id', quotation_id)
    .eq('status', 'sent')
    .maybeSingle()

  if (!quotation) return json({ error: 'Quotation not found or not in sent status' }, 404)

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const signedAt = new Date().toISOString()
  const grossTotal = Number(quotation.gross_total ?? quotation.amount ?? 0)
  const depositPct = Number(quotation.deposit_percentage ?? 50)
  const depositAmount = +(grossTotal * depositPct / 100).toFixed(2)
  const vatRate = Number(quotation.vat_rate ?? 20)

  const { error: updateErr } = await admin
    .from('quotation_documents')
    .update({
      status: 'signed',
      signed_at: signedAt,
      signed_by_name: signed_by_name.trim(),
      signed_by_position: signed_by_position?.trim() ?? null,
      gross_total: grossTotal,
      deposit_amount: depositAmount,
    })
    .eq('id', quotation_id)

  if (updateErr) {
    console.error('Failed to update quotation', updateErr)
    return json({ error: updateErr.message }, 500)
  }

  // Auto-create deposit invoice (due in 5 days)
  const quotationNumber = quotation.quotation_number || quotation.reference_number || ''
  const suffix = Date.now().toString(36).toUpperCase().slice(-4)
  const depositInvoiceNumber = `DEP-${quotationNumber}-${suffix}`
  const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const depositSubtotal = +(depositAmount / (1 + vatRate / 100)).toFixed(2)

  const { data: invoice, error: invoiceErr } = await admin
    .from('invoices')
    .insert({
      account_id: quotation.account_id,
      user_id: quotation.user_id,
      invoice_number: depositInvoiceNumber,
      reference_number: depositInvoiceNumber,
      quotation_id: quotation_id,
      type: 'deposit',
      amount: depositAmount,
      subtotal: depositSubtotal,
      vat_rate: vatRate,
      vat_amount: +(depositAmount - depositSubtotal).toFixed(2),
      currency: quotation.currency ?? 'GBP',
      status: 'sent',
      due_date: dueDate,
      issued_at: signedAt,
      notes: `${depositPct}% deposit for quotation ${quotationNumber}`,
      line_items: [{ description: `${depositPct}% Deposit — ${quotationNumber}`, quantity: 1, unit_price: depositAmount }],
    })
    .select('id')
    .single()

  if (invoiceErr) console.error('Failed to create deposit invoice', invoiceErr)

  if (invoice?.id) {
    fetch(`${supabaseUrl}/functions/v1/send-invoice-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ invoiceId: invoice.id }),
    }).catch((e: unknown) => console.warn('[sign-quotation] Invoice email failed:', e))
  }

  return json({ success: true, signedAt, depositAmount, invoiceId: invoice?.id ?? null })
})
