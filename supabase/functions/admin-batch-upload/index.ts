import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) {
    return json({ error: 'Forbidden — admin only' }, 403)
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return json({ error: 'Expected multipart/form-data' }, 400)
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return json({ error: 'Missing file' }, 400)
  }

  const filename = (formData.get('filename') as string | null)?.trim() || file.name
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    return json({ error: 'Invalid filename' }, 400)
  }

  // Sanitize for Supabase Storage key: replace spaces with underscores,
  // em/en dashes with a regular hyphen, and strip any other characters
  // outside the safe set Supabase accepts.
  const storageKey = filename
    .replace(/\s+/g, '_')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^A-Za-z0-9._\-]/g, '_')

  const { error: uploadError } = await admin.storage
    .from('round-uploads')
    .upload(storageKey, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || undefined,
    })

  if (uploadError) {
    console.error('Upload failed', uploadError)
    return json({ success: false, error: uploadError.message }, 500)
  }

  return json({ success: true, path: storageKey, originalFilename: filename })
})