import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
  const callerId = userData.user.id

  let body: { booking_payment_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const paymentId = body.booking_payment_id?.trim()
  if (!paymentId) return json({ error: 'booking_payment_id is required' }, 400)

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: payment } = await admin
    .from('booking_payments').select('account_id, receipt_pdf_path').eq('id', paymentId).maybeSingle()
  if (!payment) return json({ error: 'Not found' }, 404)
  if (!payment.receipt_pdf_path) return json({ error: 'No receipt available' }, 404)

  // ── Gate: admin OR a non-invitee member (manager) of the booking's account ──
  const { data: adminRow } = await admin
    .from('user_roles').select('role').eq('user_id', callerId).eq('role', 'admin').maybeSingle()
  let allowed = !!adminRow
  if (!allowed) {
    const { data: memberRow } = await admin
      .from('account_members').select('role').eq('account_id', payment.account_id).eq('user_id', callerId).maybeSingle()
    allowed = !!memberRow && memberRow.role !== 'client_invitee'
  }
  if (!allowed) return json({ error: 'Forbidden' }, 403)

  const { data: signed, error: signErr } = await admin.storage
    .from('booking-receipts').createSignedUrl(payment.receipt_pdf_path, 60)
  if (signErr || !signed?.signedUrl) return json({ error: 'Could not mint URL' }, 500)

  return json({ url: signed.signedUrl })
})
