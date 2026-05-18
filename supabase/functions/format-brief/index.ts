// format-brief
//
// Takes a raw dictation transcript and returns a clean, structured interior
// design brief via Anthropic Claude. Used by the client-facing Round Request
// modal after speech-to-text capture.
//
// Replaces the dead `polish-task` function (which used the legacy
// LOVABLE_API_KEY no longer valid for this project). Matches the
// authentication + Anthropic-call pattern from `parse-signature`, minus the
// admin-role gate — any authenticated client may call it.

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

const SYSTEM_PROMPT = `You are an expert at composing interior design briefs for a high-end CGI visualisation studio. You will be given a raw transcript of a client speaking informally about changes they want made to a scene. Your task is to rewrite this into a clear, structured, professional brief.

Requirements:
- Organise the content by element (architecture, finishes, lighting, furniture, materials, references).
- Use the professional vocabulary of interior design and architectural visualisation.
- Remove filler words, hesitations, and repetitions.
- Preserve all instructions accurately — never invent detail not present in the original.
- Use clear imperative phrasing ("Change the...", "Lower the...", "Replace the...").
- Output in British English.
- Keep it concise. Do not pad.
- Format as a single coherent paragraph or short bulleted list, whichever is clearer for the content.

Do not include preamble, explanation, or commentary. Output only the formatted brief.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!anthropicKey) return json({ error: 'Anthropic API key not configured' }, 500)

  // Auth — caller must be a logged-in user (any role).
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  let transcript: string
  try {
    const body = await req.json()
    transcript = body.transcript
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    return json({ error: 'transcript is required' }, 400)
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript.trim() }],
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    console.error('[format-brief] Anthropic API error:', anthropicRes.status, errText)
    return json({ error: 'Failed to format brief', status: anthropicRes.status }, 502)
  }

  const anthropicData = await anthropicRes.json()
  const formatted: string = (anthropicData.content?.[0]?.text ?? '').trim()

  if (!formatted) {
    return json({ error: 'Empty response from formatter' }, 502)
  }

  return json({ formatted })
})
