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

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const APP_BASE_URL =
  Deno.env.get('APP_BASE_URL') || 'https://portal.silvershadowstudio.com'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface CompanyDetails {
  companyName: string
  country?: string | null
  registrationNumber?: string | null
  streetName?: string | null
  buildingNumber?: string | null
  city?: string | null
  postcode?: string | null
}

interface ContactDetails {
  email: string
  firstName?: string | null
  lastName?: string | null
  position?: string | null
}

interface RequestBody {
  mode: 'invite' | 'provision'
  company: CompanyDetails
  contact: ContactDetails
  // Required when mode === 'provision'. If absent, a random one is generated.
  tempPassword?: string
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

  // ---- Authenticate caller and verify admin role ----
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
  const callerUserId = userData.user.id

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', callerUserId)
    .eq('role', 'admin')
    .maybeSingle()
  if (!roleRow) {
    return json({ error: 'Forbidden — admin only' }, 403)
  }

  // ---- Parse + validate body ----
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const mode = body.mode
  if (mode !== 'invite' && mode !== 'provision') {
    return json({ error: 'mode must be "invite" or "provision"' }, 400)
  }

  const companyName = body.company?.companyName?.trim()
  if (!companyName) {
    return json({ error: 'company.companyName is required' }, 400)
  }

  const email = body.contact?.email?.trim().toLowerCase()
  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ error: 'A valid contact.email is required' }, 400)
  }

  const fullName = [body.contact?.firstName, body.contact?.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ') || null

  // ---- Step 1: Resolve or create the auth user ----
  // For 'provision' mode we MUST have a real auth user up-front (so we can
  // make them an account_member + owner). For 'invite' mode the auth user
  // may not exist yet — they'll sign up themselves via the invite link.
  let targetUserId: string | null = null
  let createdAuthUser = false
  let generatedTempPassword: string | null = null

  // Try to find an existing auth user with this email (by scanning a small
  // page — sufficient for this admin tool).
  async function findUserByEmail(em: string): Promise<string | null> {
    // listUsers paginates; we look at the first page (default 50) and filter.
    // For larger user bases, switch to the admin API once Supabase exposes a
    // direct getUserByEmail RPC.
    let page = 1
    while (page <= 5) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      })
      if (error) return null
      const found = data.users.find(
        (u) => (u.email || '').toLowerCase() === em,
      )
      if (found) return found.id
      if (data.users.length < 200) break
      page += 1
    }
    return null
  }

  if (mode === 'provision') {
    const existingId = await findUserByEmail(email)
    if (existingId) {
      targetUserId = existingId
    } else {
      const tempPassword =
        body.tempPassword?.trim() ||
        // 16-char random password if none supplied
        Array.from(crypto.getRandomValues(new Uint8Array(12)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16)
      generatedTempPassword = body.tempPassword ? null : tempPassword

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName ?? undefined },
        })
      if (createErr || !created?.user) {
        console.error('createUser failed', createErr)
        return json(
          { error: createErr?.message || 'Failed to create user' },
          400,
        )
      }
      targetUserId = created.user.id
      createdAuthUser = true
    }

    // Block if this user is already linked to another account
    const { data: existingMembership } = await admin
      .from('account_members')
      .select('account_id')
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (existingMembership) {
      return json(
        {
          error:
            'This user is already a member of an account. Use the existing account instead.',
        },
        409,
      )
    }
  } else {
    // invite mode: ensure no active invite exists already for this email
    // across any account (we'd be creating a fresh account anyway).
    // We'll re-check after the account row is created, scoped to it.
  }

  // ---- Step 2: Create the account (company) ----
  // owner_user_id: in 'provision' we set the real user; in 'invite' we have to
  // temporarily set the calling admin as owner_user_id (it's NOT NULL). When
  // the invitation is accepted, the accept-invitation function will swap
  // ownership.
  const ownerForInsert =
    mode === 'provision' ? targetUserId! : callerUserId

  const { data: account, error: accountErr } = await admin
    .from('accounts')
    .insert({
      company_name: companyName,
      country: body.company.country ?? null,
      registration_number: body.company.registrationNumber ?? null,
      street_name: body.company.streetName ?? null,
      building_number: body.company.buildingNumber ?? null,
      city: body.company.city ?? null,
      postcode: body.company.postcode ?? null,
      owner_user_id: ownerForInsert,
    })
    .select('id, company_name')
    .single()

  if (accountErr || !account) {
    console.error('Failed to create account', accountErr)
    return json({ error: 'Failed to create account' }, 500)
  }

  // ---- Step 3a: provision branch — finalize membership + profile + role ----
  if (mode === 'provision' && targetUserId) {
    // Create profile row if missing (handle_new_user trigger may have done it)
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (!existingProfile) {
      await admin.from('profiles').insert({
        user_id: targetUserId,
        full_name: fullName,
        first_name: body.contact.firstName ?? null,
        last_name: body.contact.lastName ?? null,
        position: body.contact.position ?? null,
        company: companyName,
        account_id: account.id,
      })
    } else {
      await admin
        .from('profiles')
        .update({
          account_id: account.id,
          ...(body.contact.position
            ? { position: body.contact.position }
            : {}),
          ...(body.contact.firstName
            ? { first_name: body.contact.firstName }
            : {}),
          ...(body.contact.lastName
            ? { last_name: body.contact.lastName }
            : {}),
          ...(fullName ? { full_name: fullName } : {}),
          company: companyName,
        })
        .eq('user_id', targetUserId)
    }

    const { error: memberErr } = await admin
      .from('account_members')
      .insert({
        account_id: account.id,
        user_id: targetUserId,
        role: 'owner',
        joined_at: new Date().toISOString(),
        invited_by: callerUserId,
      })
    if (memberErr) {
      console.error('Failed to add owner membership', memberErr)
      return json({ error: 'Failed to assign owner membership' }, 500)
    }

    // Ensure the user_roles row is 'client' (default if missing)
    await admin
      .from('user_roles')
      .upsert(
        { user_id: targetUserId, role: 'client' },
        { onConflict: 'user_id,role' },
      )

    await admin.from('account_user_audit').insert({
      account_id: account.id,
      actor_user_id: callerUserId,
      target_user_id: targetUserId,
      target_email: email,
      event_type: 'admin_provisioned_account',
      metadata: {
        company_name: companyName,
        created_auth_user: createdAuthUser,
      },
    })

    return json({
      success: true,
      mode,
      accountId: account.id,
      userId: targetUserId,
      // Only returned the FIRST time we generated it; admin must copy now.
      tempPassword: generatedTempPassword,
      createdAuthUser,
    })
  }

  // ---- Step 3b: invite branch — create invitation + send email ----
  const token = generateToken()

  const { data: invite, error: inviteErr } = await admin
    .from('account_invitations')
    .insert({
      account_id: account.id,
      email,
      role: 'owner',
      token,
      invited_by: callerUserId,
    })
    .select('id, expires_at')
    .single()

  if (inviteErr || !invite) {
    console.error('Failed to create invitation', inviteErr)
    return json({ error: 'Failed to create invitation' }, 500)
  }

  await admin.from('account_user_audit').insert({
    account_id: account.id,
    actor_user_id: callerUserId,
    event_type: 'admin_created_account_with_invite',
    target_email: email,
    metadata: {
      invitation_id: invite.id,
      company_name: companyName,
    },
  })

  const inviteUrl = `${APP_BASE_URL}/accept-invite?token=${token}`

  // Inviter name (the calling admin's display name)
  const { data: inviterProfile } = await admin
    .from('profiles')
    .select('full_name, first_name, last_name')
    .eq('user_id', callerUserId)
    .maybeSingle()
  const inviterName =
    inviterProfile?.full_name ||
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(' ') ||
    userData.user.email ||
    'Silver Shadow Studio'

  const { error: sendError } = await admin.functions.invoke(
    'send-transactional-email',
    {
      body: {
        templateName: 'team-invitation',
        recipientEmail: email,
        idempotencyKey: `admin-client-invite-${invite.id}`,
        templateData: {
          inviterName,
          companyName,
          inviteUrl,
        },
      },
    },
  )

  if (sendError) {
    console.error('Failed to enqueue invitation email', sendError)
    return json({
      success: true,
      mode,
      accountId: account.id,
      invitationId: invite.id,
      inviteUrl,
      emailQueued: false,
      warning: 'Account created but invitation email could not be queued',
    })
  }

  return json({
    success: true,
    mode,
    accountId: account.id,
    invitationId: invite.id,
    inviteUrl,
    emailQueued: true,
  })
})