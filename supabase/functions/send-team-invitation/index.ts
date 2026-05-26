import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildClientMemberInviteHtml } from '../_shared/clientMemberInvite.ts'
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

// Compose the invite link on the portal domain (DMARC alignment): the portal
// proxies /auth/verify → supabase verify via vercel.json. Falls back to the
// raw action_link when generateLink didn't return the token components.
// (Mirror of admin-create-client's helper.)
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

// First-page scan for an existing auth user by email (sufficient for this tool;
// mirror of admin-create-client's findUserByEmail).
async function findUserByEmail(
  // deno-lint-ignore no-explicit-any
  admin: any,
  email: string,
): Promise<string | null> {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const match = data.users.find(
      // deno-lint-ignore no-explicit-any
      (u: any) => (u.email || '').toLowerCase() === email.toLowerCase(),
    )
    if (match) return match.id
    if (data.users.length < 200) return null
    page += 1
    if (page > 10) return null
  }
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

  // Resolve the calling user using the anon client + their JWT
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const callerUserId = userData.user.id

  let body: {
    accountId?: string
    email?: string
    first_name?: string
    last_name?: string
    position?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const accountId = body.accountId?.trim()
  const rawEmail = body.email?.trim().toLowerCase()

  if (!accountId || !rawEmail) {
    return json({ error: 'accountId and email are required' }, 400)
  }

  if (!EMAIL_REGEX.test(rawEmail)) {
    return json({ error: 'Invalid email address' }, 400)
  }

  // Service role for downstream writes / lookups bypassing RLS where needed
  const admin = createClient(supabaseUrl, supabaseServiceKey)

  // Caller must be a Manager of this account — any member whose role is not
  // 'client_invitee' (Managers are stored as role='owner'; Invitees cannot
  // invite). Owners of freelancer/team accounts pass too.
  const { data: callerRow } = await admin
    .from('account_members')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', callerUserId)
    .maybeSingle()

  if (!callerRow || callerRow.role === 'client_invitee') {
    return json({ error: 'Only a manager can invite members' }, 403)
  }

  // Load account for company name + type, and the caller profile for the
  // inviter name used in the email + activity log.
  const { data: account } = await admin
    .from('accounts')
    .select('company_name, account_type')
    .eq('id', accountId)
    .maybeSingle()

  if (!account) {
    return json({ error: 'Account not found' }, 404)
  }

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
    'A team member'

  const isClientAccount =
    account.account_type === 'project' || account.account_type === 'partnership'

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 multi-user — invite a Client-Invitee into a client account.
  // The pending invitation + Resend email path; the member row and its
  // pin_colour are created on acceptance (accept-invitation). Freelancer/team
  // accounts fall through to the existing path below (unchanged).
  // ─────────────────────────────────────────────────────────────────────────
  if (isClientAccount) {
    const firstName = (body.first_name || '').trim()
    const lastName = (body.last_name || '').trim()
    const position = (body.position || '').trim()
    if (!firstName || !lastName) {
      return json({ error: 'First and last name are required' }, 400)
    }

    // Resolve or create the invitee's auth user (no password yet; the magic
    // link signs them in, after which they can set one in Settings).
    let inviteeUserId = await findUserByEmail(admin, rawEmail)
    if (!inviteeUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: rawEmail,
        email_confirm: false,
      })
      if (createErr || !created?.user) {
        console.error('Failed to create invitee user', createErr)
        return json({ error: 'Failed to create invitee account' }, 500)
      }
      inviteeUserId = created.user.id
    }

    // UNIQUE(account_members.user_id): a user can belong to only one account.
    // Phase 1 leaves the constraint in place — surface a clean error rather
    // than letting the INSERT throw on acceptance.
    const { data: anyMembership } = await admin
      .from('account_members')
      .select('account_id')
      .eq('user_id', inviteeUserId)
      .maybeSingle()
    if (anyMembership) {
      if (anyMembership.account_id === accountId) {
        return json({ error: 'This person is already a member of your team.' }, 409)
      }
      return json(
        {
          error:
            'This email is already associated with another Silver Shadow account and cannot be added to a second team.',
        },
        409,
      )
    }

    // Store the Manager-entered name + position on the invitee's profile
    // (fill blanks only; never overwrite existing values).
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('user_id', inviteeUserId)
      .maybeSingle()
    if (existingProfile) {
      await admin
        .from('profiles')
        .update({
          ...(fullName ? { full_name: fullName } : {}),
          first_name: firstName,
          last_name: lastName,
          ...(position ? { position } : {}),
        })
        .eq('user_id', inviteeUserId)
    } else {
      await admin.from('profiles').insert({
        user_id: inviteeUserId,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        position: position || null,
        company: account.company_name,
      })
    }

    // Reuse an existing active invitation if one exists, else create one.
    const { data: existingInvite } = await admin
      .from('account_invitations')
      .select('id, token')
      .eq('account_id', accountId)
      .eq('email', rawEmail)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    let token: string
    let invitationId: string
    if (existingInvite) {
      token = existingInvite.token
      invitationId = existingInvite.id
    } else {
      token = generateToken()
      const { data: invite, error: insErr } = await admin
        .from('account_invitations')
        .insert({
          account_id: accountId,
          email: rawEmail,
          role: 'client_invitee',
          token,
          invited_by: callerUserId,
        })
        .select('id')
        .single()
      if (insErr || !invite) {
        console.error('Failed to create invitation', insErr)
        return json({ error: 'Failed to create invitation' }, 500)
      }
      invitationId = invite.id
    }

    // Portal-domain magic link that lands on /accept-invite?token=… so the
    // existing accept-invitation flow creates the membership + pin_colour.
    const redirectTo = `${APP_BASE_URL}/accept-invite?token=${token}`
    let inviteUrl = redirectTo
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: rawEmail,
      options: { redirectTo },
    })
    if (!linkErr && linkData?.properties) {
      const props = linkData.properties as Record<string, unknown>
      inviteUrl = buildPortalVerifyUrl(props, (props.action_link as string) || redirectTo)
    } else if (linkErr) {
      console.error('generateLink (client invite) failed', linkErr)
    }

    // Branded invite email via Resend (portal-domain sender + assets).
    const resendKey = Deno.env.get('RESEND_API_KEY')
    let emailSent = false
    if (resendKey) {
      let backgroundColor = '#EDE8E0'
      try {
        const brand = await loadBrand(admin)
        // deno-lint-ignore no-explicit-any
        backgroundColor = (brand as any)?.background_color || backgroundColor
      } catch { /* brand defaults */ }
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Silver Shadow Studio <portal@silvershadowstudio.com>',
            to: [rawEmail],
            subject: `You've been invited to ${account.company_name} on Silver Shadow Studio`,
            html: buildClientMemberInviteHtml({
              companyName: account.company_name,
              inviterName,
              inviteUrl,
              firstName,
              backgroundColor,
            }),
            headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
            tags: [{ name: 'category', value: 'client-member-invite' }],
          }),
        })
        emailSent = res.ok
        if (!res.ok) console.error('Resend error (client invite):', await res.text())
      } catch (e) {
        console.error('Resend exception (client invite):', e)
      }
    }

    // Activity log (best-effort).
    await admin
      .from('activity_log')
      .insert({
        actor_user_id: callerUserId,
        actor_name: inviterName,
        actor_role: 'client',
        action: 'client_member_invited',
        description: `Invited ${firstName} ${lastName} (${rawEmail})`,
        entity_type: 'account_member',
        metadata: { account_id: accountId, invitee_email: rawEmail, invitation_id: invitationId },
      })
      .then(() => {}, () => {})

    return json({
      success: true,
      invitationId,
      recipientEmail: rawEmail,
      emailSent,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Existing freelancer/team-account path — unchanged.
  // ─────────────────────────────────────────────────────────────────────────

  // Reject if a non-revoked, non-accepted invitation already exists
  const { data: existingInvite } = await admin
    .from('account_invitations')
    .select('id, accepted_at, revoked_at, expires_at')
    .eq('account_id', accountId)
    .eq('email', rawEmail)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (existingInvite) {
    return json(
      { error: 'An active invitation already exists for this email' },
      409,
    )
  }

  const token = generateToken()

  const { data: invite, error: insertError } = await admin
    .from('account_invitations')
    .insert({
      account_id: accountId,
      email: rawEmail,
      role: 'user',
      token,
      invited_by: callerUserId,
    })
    .select('id, expires_at')
    .single()

  if (insertError || !invite) {
    console.error('Failed to create invitation', insertError)
    return json({ error: 'Failed to create invitation' }, 500)
  }

  // Audit log (best-effort)
  await admin.from('account_user_audit').insert({
    account_id: accountId,
    actor_user_id: callerUserId,
    event_type: 'invitation_sent',
    target_email: rawEmail,
    metadata: { invitation_id: invite.id },
  })

  // Enqueue the invitation email via the existing transactional sender
  const inviteUrl = `${APP_BASE_URL}/accept-invite?token=${token}`

  const { error: sendError } = await admin.functions.invoke(
    'send-transactional-email',
    {
      body: {
        templateName: 'team-invitation',
        recipientEmail: rawEmail,
        idempotencyKey: `team-invite-${invite.id}`,
        templateData: {
          inviterName,
          companyName: account?.company_name ?? 'a team',
          inviteUrl,
        },
      },
    },
  )

  if (sendError) {
    console.error('Failed to enqueue invitation email', sendError)
    // Invitation row was created successfully; surface a soft warning
    return json(
      {
        success: true,
        invitationId: invite.id,
        emailQueued: false,
        warning: 'Invitation created but email could not be queued',
      },
      200,
    )
  }

  return json({
    success: true,
    invitationId: invite.id,
    emailQueued: true,
  })
})
