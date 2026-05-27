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

// Reservation-expiry sweep. Deliberately auth-free: it only cancels rounds that
// are ALREADY expired (status='reserved' AND reservation_expires_at < now), so
// the result is correct regardless of caller. Called fire-and-forget on admin
// dashboard + client portal load. Deployed --no-verify-jwt.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('scene_rounds')
    .update({ status: 'cancelled' })
    .eq('status', 'reserved')
    .lt('reservation_expires_at', nowIso)
    .select('id')

  if (error) {
    console.error('expire-reservations error:', error)
    return json({ success: false, error: error.message }, 500)
  }
  return json({ success: true, expired: (data || []).length })
})
