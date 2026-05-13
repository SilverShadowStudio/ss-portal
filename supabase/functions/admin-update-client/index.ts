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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface RequestBody {
  accountId: string
  company?: {
    companyName?: string | null
    clientCode?: string | null
    country?: string | null
    registrationNumber?: string | null
    streetName?: string | null
    buildingNumber?: string | null
    city?: string | null
    postcode?: string | null
  }
  contact?: {
    firstName?: string | null
    lastName?: string | null
    position?: string | null
    email?: string | null
    password?: string | null
  }
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
  const callerUserId = userData.user.id

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', callerUserId)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) return json({ error: 'Forbidden — admin only' }, 403)

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (!body.accountId) return json({ error: 'accountId is required' }, 400)

  // Look up account + owner
  const { data: account, error: accountErr } = await admin
    .from('accounts')
    .select('id, owner_user_id, company_name')
    .eq('id', body.accountId)
    .maybeSingle()
  if (accountErr || !account) return json({ error: 'Account not found' }, 404)

  const ownerId = account.owner_user_id as string

  // ---- Update account (company) ----
  if (body.company) {
    const c = body.company
    const accountUpdate: Record<string, unknown> = {}
    if (typeof c.companyName === 'string') {
      const trimmed = c.companyName.trim()
      if (!trimmed) return json({ error: 'Company name cannot be empty' }, 400)
      accountUpdate.company_name = trimmed
    }
    if (c.clientCode !== undefined) accountUpdate.client_code = c.clientCode?.trim() || null
    if (c.country !== undefined) accountUpdate.country = c.country?.trim() || null
    if (c.registrationNumber !== undefined)
      accountUpdate.registration_number = c.registrationNumber?.trim() || null
    if (c.streetName !== undefined) accountUpdate.street_name = c.streetName?.trim() || null
    if (c.buildingNumber !== undefined)
      accountUpdate.building_number = c.buildingNumber?.trim() || null
    if (c.city !== undefined) accountUpdate.city = c.city?.trim() || null
    if (c.postcode !== undefined) accountUpdate.postcode = c.postcode?.trim() || null

    if (Object.keys(accountUpdate).length) {
      const { error: updErr } = await admin
        .from('accounts')
        .update(accountUpdate)
        .eq('id', account.id)
      if (updErr) {
        console.error('account update failed', updErr)
        return json({ error: 'Failed to update company details' }, 500)
      }
    }
  }

  // ---- Update profile (owner contact) ----
  if (body.contact && ownerId) {
    const ct = body.contact
    const profileUpdate: Record<string, unknown> = {}
    if (ct.firstName !== undefined) profileUpdate.first_name = ct.firstName?.trim() || null
    if (ct.lastName !== undefined) profileUpdate.last_name = ct.lastName?.trim() || null
    if (ct.position !== undefined) profileUpdate.position = ct.position?.trim() || null

    const fullName =
      [ct.firstName, ct.lastName]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .join(' ') || null
    if (ct.firstName !== undefined || ct.lastName !== undefined) {
      profileUpdate.full_name = fullName
    }

    if (Object.keys(profileUpdate).length) {
      const { data: existingProfile } = await admin
        .from('profiles')
        .select('id')
        .eq('user_id', ownerId)
        .maybeSingle()
      if (existingProfile) {
        const { error: profErr } = await admin
          .from('profiles')
          .update(profileUpdate)
          .eq('user_id', ownerId)
        if (profErr) {
          console.error('profile update failed', profErr)
          return json({ error: 'Failed to update contact details' }, 500)
        }
      } else {
        await admin.from('profiles').insert({
          user_id: ownerId,
          account_id: account.id,
          ...profileUpdate,
        })
      }
    }

    // ---- Auth email / password ----
    const authUpdate: { email?: string; password?: string } = {}
    if (typeof ct.email === 'string' && ct.email.trim()) {
      const newEmail = ct.email.trim().toLowerCase()
      if (!EMAIL_REGEX.test(newEmail)) return json({ error: 'Invalid email' }, 400)
      authUpdate.email = newEmail
    }
    if (typeof ct.password === 'string' && ct.password.length > 0) {
      if (ct.password.length < 8)
        return json({ error: 'Password must be at least 8 characters' }, 400)
      authUpdate.password = ct.password
    }
    if (Object.keys(authUpdate).length) {
      const { error: authErr } = await admin.auth.admin.updateUserById(ownerId, {
        ...authUpdate,
        ...(authUpdate.email ? { email_confirm: true } : {}),
      })
      if (authErr) {
        console.error('auth update failed', authErr)
        return json({ error: authErr.message || 'Failed to update auth' }, 400)
      }
    }
  }

  await admin.from('account_user_audit').insert({
    account_id: account.id,
    actor_user_id: callerUserId,
    target_user_id: ownerId,
    event_type: 'admin_updated_client',
    metadata: {
      updated_company: !!body.company,
      updated_contact: !!body.contact,
      updated_email: !!body.contact?.email,
      updated_password: !!body.contact?.password,
    },
  })

  return json({ success: true })
})