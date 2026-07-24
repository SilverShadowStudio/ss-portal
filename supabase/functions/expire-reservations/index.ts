import { createClient } from 'npm:@supabase/supabase-js@2'
import { requireAuthenticatedUser } from '../_shared/cronAuth.ts'

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

// Reservation-expiry sweep. Cancels rounds that are ALREADY expired
// (status='reserved' AND reservation_expires_at < now). Called fire-and-forget
// on admin dashboard + client portal load.
//
// Auth: any signed-in user. The original design was deliberately auth-free, on
// the reasoning that the sweep is idempotent and only does what would happen
// anyway — correct as far as it goes, but it left a service-role write path
// open to anonymous callers, i.e. free unbounded DB writes for anyone who read
// the function name out of the client bundle. Correctness was never the
// exposure; cost and write amplification were.
//
// Both call sites live inside authenticated layouts and now wait for a session
// before firing, so requiring a JWT changes nothing for real users.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const auth = await requireAuthenticatedUser(req, { corsHeaders })
  if (!auth.ok) return auth.response

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
