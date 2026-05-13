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
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!anthropicKey) return json({ error: 'Anthropic API key not configured' }, 500)

  // Auth — caller must be a logged-in admin
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden' }, 403)

  let signature: string
  try {
    const body = await req.json()
    signature = body.signature
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!signature || typeof signature !== 'string' || !signature.trim()) {
    return json({ error: 'signature is required' }, 400)
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system:
        'You are a contact information extractor. Extract structured contact info from email signatures. ' +
        'Return ONLY a valid JSON object with exactly these fields: ' +
        'first_name, last_name, position, company_name, email, country, city. ' +
        'Use null for any field that cannot be determined. No explanation, no markdown, no extra text.',
      messages: [{ role: 'user', content: signature.trim() }],
    }),
  })

  if (!anthropicRes.ok) {
    console.error('Anthropic API error:', await anthropicRes.text())
    return json({ error: 'Failed to call Anthropic API' }, 502)
  }

  const anthropicData = await anthropicRes.json()
  const text: string = anthropicData.content?.[0]?.text ?? ''

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    console.error('Could not parse Anthropic response as JSON:', text)
    return json({ error: 'Could not parse response', raw: text }, 500)
  }

  return json({ data: parsed })
})
