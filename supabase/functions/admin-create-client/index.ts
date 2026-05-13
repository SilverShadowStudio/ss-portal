import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildInviteEmailHtml, InviteEmailConfig } from '../_shared/emailTemplates.ts'

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
  mode: 'invite' | 'provision' | 'resend'
  company?: CompanyDetails
  contact: ContactDetails
  accountType?: 'partnership' | 'project'
  tempPassword?: string
  accountId?: string
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
  if (mode !== 'invite' && mode !== 'provision' && mode !== 'resend') {
    return json({ error: 'mode must be "invite", "provision", or "resend"' }, 400)
  }

  const email = body.contact?.email?.trim().toLowerCase()
  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ error: 'A valid contact.email is required' }, 400)
  }

  // ---- Resend mode: re-invite an existing client ----
  if (mode === 'resend') {
    const targetAccountId = body.accountId?.trim()
    if (!targetAccountId) {
      return json({ error: 'accountId is required for resend mode' }, 400)
    }

    const { data: acct } = await admin
      .from('accounts')
      .select('id, company_name')
      .eq('id', targetAccountId)
      .maybeSingle()
    if (!acct) return json({ error: 'Account not found' }, 404)

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${APP_BASE_URL}/set-password` },
    })

    if (linkErr || !linkData?.user) {
      console.error('generateLink failed for resend', linkErr)
      return json({ error: linkErr?.message || 'Failed to generate invitation link' }, 400)
    }

    const inviteUrl = (linkData.properties as Record<string, unknown>).action_link as string

    try {
      await admin.from('account_user_audit').insert({
        account_id: acct.id,
        actor_user_id: callerUserId,
        target_user_id: linkData.user.id,
        target_email: email,
        event_type: 'admin_resent_invite',
        metadata: { company_name: acct.company_name },
      })
    } catch { /* best-effort audit */ }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    let emailSent = false

    let emailConfig: InviteEmailConfig = {}
    try {
      const { data: cfgRow } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'email_invite_config')
        .maybeSingle()
      if (cfgRow?.value) emailConfig = cfgRow.value as InviteEmailConfig
    } catch { /* use defaults */ }

    if (resendKey && inviteUrl) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Silver Shadow Studio <portal@silvershadowstudio.com>',
            to: [email],
            subject: 'Your Silvershadow Studio portal is ready.',
            html: buildInviteEmailHtml(acct.company_name, inviteUrl, { ...emailConfig, ctaUrl: undefined }),
            headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
            tags: [{ name: 'category', value: 'reinvite' }],
          }),
        })
        emailSent = res.ok
        if (!res.ok) console.error('Resend error (resend mode):', await res.text())
      } catch (e) {
        console.error('Resend exception (resend mode):', e)
      }
    }

    return json({
      success: true,
      mode,
      accountId: acct.id,
      inviteUrl,
      emailSent,
    })
  }

  const companyName = body.company?.companyName?.trim()
  if (!companyName) {
    return json({ error: 'company.companyName is required' }, 400)
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
  }

  const accountType = body.accountType === 'project' ? 'project' : 'partnership'

  // ---- invite branch: generateLink then create account ----
  if (mode === 'invite') {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${APP_BASE_URL}/set-password`,
        data: { full_name: fullName ?? undefined },
      },
    })

    if (linkErr || !linkData?.user) {
      console.error('generateLink failed', linkErr)
      return json({ error: linkErr?.message || 'Failed to generate invitation link' }, 400)
    }

    const invitedUserId = linkData.user.id
    const inviteUrl = (linkData.properties as Record<string, unknown>).action_link as string

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
        owner_user_id: invitedUserId,
        account_type: accountType,
      })
      .select('id, company_name')
      .single()

    if (accountErr || !account) {
      console.error('Failed to create account', accountErr)
      await admin.auth.admin.deleteUser(invitedUserId).catch(() => {})
      return json({ error: 'Failed to create account' }, 500)
    }

    const profileInsert = await admin.from('profiles').upsert({
      user_id: invitedUserId,
      full_name: fullName,
      first_name: body.contact.firstName ?? null,
      last_name: body.contact.lastName ?? null,
      position: body.contact.position ?? null,
      company: companyName,
      account_id: account.id,
    }, { onConflict: 'user_id' })
    if (profileInsert.error) console.error('profiles upsert error', profileInsert.error)

    const memberInsert = await admin.from('account_members').insert({
      account_id: account.id,
      user_id: invitedUserId,
      role: 'owner',
      joined_at: new Date().toISOString(),
      invited_by: callerUserId,
    })
    if (memberInsert.error) console.error('account_members insert error', memberInsert.error)

    const roleUpsert = await admin.from('user_roles').upsert(
      { user_id: invitedUserId, role: 'client' },
      { onConflict: 'user_id,role' },
    )
    if (roleUpsert.error) console.error('user_roles upsert error', roleUpsert.error)

    try {
      await admin.from('account_user_audit').insert({
        account_id: account.id,
        actor_user_id: callerUserId,
        target_user_id: invitedUserId,
        target_email: email,
        event_type: 'admin_created_account_with_invite',
        metadata: { company_name: companyName, account_type: accountType },
      })
    } catch { /* best-effort audit */ }

    // Send branded invitation email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    let emailSent = false

    // Load stored email config (best-effort — falls back to defaults on error)
    let emailConfig: InviteEmailConfig = {}
    try {
      const { data: cfgRow } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'email_invite_config')
        .maybeSingle()
      if (cfgRow?.value) emailConfig = cfgRow.value as InviteEmailConfig
    } catch { /* use defaults */ }

    if (resendKey && inviteUrl) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Silver Shadow Studio <portal@silvershadowstudio.com>',
            to: [email],
            subject: 'Your Silvershadow Studio portal is ready.',
            html: buildInviteEmailHtml(companyName, inviteUrl, { ...emailConfig, ctaUrl: undefined }),
            headers: {
              'X-Entity-Ref-ID': crypto.randomUUID(),
            },
            tags: [
              { name: 'category', value: 'invite' },
            ],
          }),
        })
        emailSent = res.ok
        if (!res.ok) console.error('Resend error:', await res.text())
      } catch (e) {
        console.error('Resend exception:', e)
      }
    }

    return json({
      success: true,
      mode,
      accountId: account.id,
      userId: invitedUserId,
      inviteUrl,
      emailSent,
    })
  }

  // ---- Step 2: Create the account (provision mode) ----
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
      owner_user_id: targetUserId!,
      account_type: accountType,
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

  // provision mode — should never reach here (handled above), but return cleanly
  return json({ success: true, mode, accountId: account.id })
})