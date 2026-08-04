import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildInviteEmailHtml, EMAIL_INVITE_DEFAULTS, InviteEmailConfig, teamInviteBody } from '../_shared/emailTemplates.ts'
import { loadBrand } from '../_shared/brand.ts'

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

/**
 * Compose the invite link on the portal domain rather than the raw
 * supabase.co host that `properties.action_link` returns. The portal
 * proxies `/auth/verify` to `https://<ref>.supabase.co/auth/v1/verify`
 * via a vercel.json rewrite, so spam scanners see a sender-aligned host
 * in the email body. Falls back to `action_link` when generateLink
 * didn't return the token components — keeps the email functional even
 * if the API shape changes.
 */
function buildPortalVerifyUrl(
  properties: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const token = (properties?.hashed_token as string | undefined) ?? ''
  const type = (properties?.verification_type as string | undefined) ?? ''
  const redirectTo = (properties?.redirect_to as string | undefined) ?? ''
  if (!token || !type) return fallback
  const params = new URLSearchParams({ token, type })
  if (redirectTo) params.set('redirect_to', redirectTo)
  return `${APP_BASE_URL}/auth/verify?${params.toString()}`
}

// Structured error responses for already-registered users. Each category
// (client or team) gets its own message so the admin can give the right
// next step in the toast.
const ALREADY_REGISTERED_MESSAGE =
  'User already registered — direct them to use the forgot password flow'
const WRONG_CATEGORY_MESSAGE =
  'User already registered in another category. Each user can only belong to one category (client or team).'

function categoryOfAccountType(at: string): 'client' | 'team' {
  return at === 'team' ? 'team' : 'client'
}

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
  accountType?: 'partnership' | 'project' | 'team'
  role?: string
  tempPassword?: string
  accountId?: string
  clientCode?: string
  /** Create the account but hold the invite email; caller schedules the send. */
  defer_email?: boolean
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
  const admin = createClient(supabaseUrl, supabaseServiceKey)

  // A function-to-function caller holding the service-role key (the scheduled
  // invite dispatcher). Deliberately narrow: it is rejected below for anything
  // other than `resend`, so it can never create an account or a user.
  const bearer = authHeader.slice(7).trim()
  const isInternal = bearer === supabaseServiceKey

  let callerUserId = ''
  if (!isInternal) {
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: 'Unauthorized' }, 401)
    }
    callerUserId = userData.user.id

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerUserId)
      .eq('role', 'admin')
      .maybeSingle()
    if (!roleRow) {
      return json({ error: 'Forbidden — admin only' }, 403)
    }
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
  // The service-role path exists solely to re-send an invitation for an account
  // that already exists. It must never create one.
  if (isInternal && mode !== 'resend') {
    return json({ error: 'Forbidden — internal caller may only resend' }, 403)
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
      .select('id, company_name, account_type, employment_type')
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

    const props = linkData.properties as Record<string, unknown>
    const inviteUrl = buildPortalVerifyUrl(props, props.action_link as string)

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
    const brand = await loadBrand(admin)

    // Look up the existing user's first name from profiles for the greeting line.
    let resendFirstName: string | null = null
    try {
      const { data: profileRow } = await admin
        .from('profiles')
        .select('first_name')
        .eq('user_id', linkData.user.id)
        .maybeSingle()
      resendFirstName = (profileRow?.first_name as string | null) ?? null
    } catch { /* greeting line is optional */ }

    if (resendKey && inviteUrl) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Silver Shadow Studio <portal@silvershadowstudio.com>',
            to: [email],
            subject: emailConfig.subject || EMAIL_INVITE_DEFAULTS.subject,
            html: buildInviteEmailHtml(acct.company_name, inviteUrl, {
              backgroundColor: brand.background_color,
              ...emailConfig,
              // Team members have no projects or deliveries — a scheduled invite
              // comes through this path, so it needs the same copy as a direct one.
              ...(acct.account_type === 'team'
                ? { bodyCopy: teamInviteBody((acct.employment_type as string | undefined) ?? undefined) }
                : {}),
              ctaUrl: undefined,
              firstName: resendFirstName,
            }),
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

    if (emailSent) {
      try {
        await admin.from('activity_log').insert({
          actor_user_id: callerUserId,
          actor_role: 'admin',
          action: 'invite_sent',
          description: `Invite email sent to ${email}`,
          metadata: { company_name: acct.company_name, mode: 'resend' },
        })
      } catch (e) { console.warn('activity log (invite_sent / resend) failed', e) }
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

    // Block if this user is already linked to another account.
    // Same category → ALREADY_REGISTERED. Different category → WRONG_CATEGORY.
    const { data: existingMembership } = await admin
      .from('account_members')
      .select('account_id, accounts!inner(account_type)')
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (existingMembership) {
      const provisionAccountType =
        body.accountType === 'project' ? 'project'
          : body.accountType === 'team' ? 'team'
          : 'partnership'
      const newCategory = categoryOfAccountType(provisionAccountType)
      const existingCategory = categoryOfAccountType(
        ((existingMembership as any).accounts?.account_type ?? '') as string,
      )
      if (newCategory === existingCategory) {
        return json(
          { code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_MESSAGE, message: ALREADY_REGISTERED_MESSAGE },
          409,
        )
      }
      return json(
        { code: 'WRONG_CATEGORY', error: WRONG_CATEGORY_MESSAGE, message: WRONG_CATEGORY_MESSAGE },
        409,
      )
    }
  }

  const accountType = body.accountType === 'project' ? 'project' : body.accountType === 'team' ? 'team' : 'partnership'

  // ---- invite branch: generateLink then create account ----
  if (mode === 'invite') {
    // If the email already exists in auth, fall back to magiclink (invite type rejects existing users).
    const existingUserId = await findUserByEmail(email)

    let invitedUserId: string
    let inviteUrl: string

    if (existingUserId) {
      // For team invites a user may also be a client — only block if they already
      // have a team account. For all other account types block on any membership.
      const { data: existingMemberships } = await admin
        .from('account_members')
        .select('account_id, accounts!inner(account_type)')
        .eq('user_id', existingUserId)

      // Categorise existing memberships against the category being invited.
      // Same category → ALREADY_REGISTERED; different category → WRONG_CATEGORY.
      const newCategory = categoryOfAccountType(accountType)
      const existingCategories = new Set<'client' | 'team'>(
        (existingMemberships ?? []).map((m) =>
          categoryOfAccountType(((m.accounts as any)?.account_type ?? '') as string),
        ),
      )
      if (existingCategories.has(newCategory)) {
        return json(
          { code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_MESSAGE, message: ALREADY_REGISTERED_MESSAGE },
          409,
        )
      }
      if (existingCategories.size > 0) {
        return json(
          { code: 'WRONG_CATEGORY', error: WRONG_CATEGORY_MESSAGE, message: WRONG_CATEGORY_MESSAGE },
          409,
        )
      }

      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${APP_BASE_URL}/set-password` },
      })
      if (linkErr || !linkData?.user) {
        console.error('generateLink (magiclink) failed', linkErr)
        return json({ error: linkErr?.message || 'Failed to generate invitation link' }, 400)
      }
      invitedUserId = existingUserId
      const props = linkData.properties as Record<string, unknown>
      inviteUrl = buildPortalVerifyUrl(props, props.action_link as string)
    } else {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${APP_BASE_URL}/set-password`,
          data: { full_name: fullName ?? undefined },
        },
      })
      if (linkErr || !linkData?.user) {
        console.error('generateLink (invite) failed', linkErr)
        return json({ error: linkErr?.message || 'Failed to generate invitation link' }, 400)
      }
      invitedUserId = linkData.user.id
      const props = linkData.properties as Record<string, unknown>
      inviteUrl = buildPortalVerifyUrl(props, props.action_link as string)
    }

    // Team members get a 5-char code automatically: first initial + first 4
    // letters of surname (Maycon Santos → MSANT). Deliberately a different
    // length from the clients' 3-char codes so the two are told apart on sight.
    // Shares the accounts.client_code unique index, so the two can never clash.
    const teamAutoCode = (() => {
      if (accountType !== 'team') return null
      const first = (body.contact.firstName ?? '').replace(/[^A-Za-z]/g, '')
      const last = (body.contact.lastName ?? '').replace(/[^A-Za-z]/g, '')
      if (!first || !last) return null   // invite-by-email only: filled in at onboarding
      return (first.slice(0, 1) + last.slice(0, 4)).toUpperCase()
    })()
    const clientCode = body.clientCode?.trim().toUpperCase() || teamAutoCode || null
    // Optional: if the admin chose to link to an existing Airtable Clients
    // row in the Add Client pre-flight match panel, the chosen record id
    // arrives here. Writing it onto the account row at insert time lets
    // the downstream airtable-sync-contact (fired below) recognise the
    // link and PATCH the existing row instead of creating a duplicate.
    const airtableClientId = (body.airtableClientId as string | undefined)?.trim() || null

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
        client_code: clientCode,
        // Admin-set role for team members — locks their role at onboarding.
        ...(typeof body.role === "string" && body.role ? { team_role: body.role } : {}),
        ...(airtableClientId ? { airtable_client_id: airtableClientId } : {}),
      } as Record<string, unknown>)
      .select('id, company_name')
      .single()

    if (accountErr || !account) {
      console.error('Failed to create account', accountErr)
      await admin.auth.admin.deleteUser(invitedUserId).catch(() => {})
      return json({ error: 'Failed to create account' }, 500)
    }

    // For existing users (e.g. a client also becoming a team member) only fill in
    // missing profile fields — don't overwrite account_id or other data.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, account_id')
      .eq('user_id', invitedUserId)
      .maybeSingle()

    if (existingProfile) {
      // Only patch fields that are blank; preserve account_id.
      await admin.from('profiles').update({
        ...(fullName ? { full_name: fullName } : {}),
        ...(body.contact.firstName ? { first_name: body.contact.firstName } : {}),
        ...(body.contact.lastName ? { last_name: body.contact.lastName } : {}),
        ...(body.contact.position ? { position: body.contact.position } : {}),
      }).eq('user_id', invitedUserId)
    } else {
      const profileInsert = await admin.from('profiles').insert({
        user_id: invitedUserId,
        full_name: fullName,
        first_name: body.contact.firstName ?? null,
        last_name: body.contact.lastName ?? null,
        position: body.contact.position ?? null,
        company: companyName,
        account_id: account.id,
      })
      if (profileInsert.error) console.error('profiles insert error', profileInsert.error)
    }

    const memberInsert = await admin.from('account_members').insert({
      account_id: account.id,
      user_id: invitedUserId,
      role: 'owner',
      joined_at: new Date().toISOString(),
      invited_by: callerUserId,
    })
    if (memberInsert.error) console.error('account_members insert error', memberInsert.error)

    const roleToAssign = accountType === 'team' ? 'team' : 'client'
    const roleUpsert = await admin.from('user_roles').upsert(
      { user_id: invitedUserId, role: roleToAssign },
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
    const brand = await loadBrand(admin)

    // defer_email: create the account now, hold the invitation. The caller then
    // records a scheduled_invites row and cron sends it (resend mode) when due.
    // The account existing immediately means the admin's work is never lost.
    if (body.defer_email === true) {
      return json({
        success: true, deferred: true,
        accountId: account.id, userId: invitedUserId, email,
      })
    }

    if (resendKey && inviteUrl) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Silver Shadow Studio <portal@silvershadowstudio.com>',
            to: [email],
            subject: emailConfig.subject || EMAIL_INVITE_DEFAULTS.subject,
            html: buildInviteEmailHtml(companyName, inviteUrl, { backgroundColor: brand.background_color, ...emailConfig, ...(accountType === 'team' ? { bodyCopy: teamInviteBody() } : {}), ctaUrl: undefined, firstName: body.contact?.firstName ?? null }),
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

    if (emailSent) {
      try {
        await admin.from('activity_log').insert({
          actor_user_id: callerUserId,
          actor_role: 'admin',
          action: 'invite_sent',
          description: `Invite email sent to ${email}`,
          metadata: { company_name: companyName, account_type: accountType, mode: 'invite' },
        })
      } catch (e) { console.warn('activity log (invite_sent / invite) failed', e) }
    }

    admin.functions.invoke('airtable-sync-contact', {
      // airtable-sync-contact is gated on X-Cron-Secret (see _shared/cronAuth.ts).
      // The service-role bearer alone is not accepted: it is not a user JWT, so
      // the admin branch cannot verify it.
      headers: { 'X-Cron-Secret': Deno.env.get('CRON_SECRET') ?? '' },
      body: {
        first_name: body.contact.firstName ?? '',
        surname: body.contact.lastName ?? '',
        role: 'Client',
        type_of_client: accountType,
        email,
        account_id: account.id,
      },
    }).catch((e: unknown) => console.error('[admin-create-client] airtable-sync-contact:', e))

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
  const provisionClientCode = body.clientCode?.trim().toUpperCase() || null

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
      client_code: provisionClientCode,
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

    admin.functions.invoke('airtable-sync-contact', {
      // airtable-sync-contact is gated on X-Cron-Secret (see _shared/cronAuth.ts).
      // The service-role bearer alone is not accepted: it is not a user JWT, so
      // the admin branch cannot verify it.
      headers: { 'X-Cron-Secret': Deno.env.get('CRON_SECRET') ?? '' },
      body: {
        first_name: body.contact.firstName ?? '',
        surname: body.contact.lastName ?? '',
        role: 'Client',
        type_of_client: accountType,
        email,
        account_id: account.id,
      },
    }).catch((e: unknown) => console.error('[admin-create-client] airtable-sync-contact:', e))

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