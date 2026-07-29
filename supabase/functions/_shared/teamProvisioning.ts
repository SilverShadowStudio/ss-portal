// Reuse-aware team member provisioning shared across team-contract-send and
// team-contract-upload-presigned. Creates or reuses auth user, team account,
// account membership, and freelancer profile — in that order — with a
// compensating rollback if any step fails.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export function splitName(full: string | null): { first: string; last: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Contractor", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Scans up to 1000 auth users (5 pages × 200) to find a matching email.
export async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  let page = 1;
  while (page <= 5) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

export interface ProvisionResult {
  userId: string;
  accountId: string;
  profileId: string;
  first: string;
  last: string;
  /** True when the freelancer profile already existed — i.e. a returning member
   *  (e.g. uploading a second/additional document), not a brand-new one. */
  profileExisted: boolean;
}

// Provisions (or reuses) the auth user, team account, account membership, and
// freelancer profile for a team member. Throws after compensating rollback if
// any step fails; only pieces created by THIS call are rolled back — reused
// records are never touched.
export async function provisionTeamMember(
  admin: SupabaseClient,
  params: {
    email: string;         // recipient email (lowercase)
    partyName: string | null; // individual_full_name or company_director_name
    companyLabel: string;  // accounts.company_name (individual name or company name)
    invitedBy: string;     // admin user.id
  },
): Promise<ProvisionResult> {
  const { email, partyName, companyLabel, invitedBy } = params;
  const { first, last } = splitName(partyName);

  let createdUserId: string | null = null;
  let createdAccountId: string | null = null;
  let createdMemberId: string | null = null;
  let createdProfileId: string | null = null;

  const rollback = async () => {
    if (createdProfileId) await admin.from("freelancer_profiles").delete().eq("id", createdProfileId).then(() => {}, () => {});
    if (createdMemberId) await admin.from("account_members").delete().eq("id", createdMemberId).then(() => {}, () => {});
    if (createdAccountId) await admin.from("accounts").delete().eq("id", createdAccountId).then(() => {}, () => {});
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).then(() => {}, () => {});
  };

  let userId: string;
  let accountId: string;
  let profileId: string;
  let profileExisted = false;

  try {
    // Step 1 — auth user
    const existingUserId = await findUserByEmail(admin, email);
    if (existingUserId) {
      userId = existingUserId;
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: false });
      if (error || !created?.user) throw new Error(`Could not create user: ${error?.message ?? "unknown"}`);
      userId = created.user.id;
      createdUserId = userId;
    }

    // Steps 2/3 — team account + membership (reuse single existing membership if any)
    const { data: existingMember } = await admin
      .from("account_members")
      .select("account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMember?.account_id) {
      accountId = existingMember.account_id as string;
    } else {
      const { data: acct, error: acctErr } = await admin
        .from("accounts")
        .insert({ company_name: companyLabel, account_type: "team", owner_user_id: userId } as Record<string, unknown>)
        .select("id")
        .single();
      if (acctErr || !acct) throw new Error(`Could not create account: ${acctErr?.message ?? "unknown"}`);
      accountId = acct.id;
      createdAccountId = acct.id;

      const { data: member, error: memErr } = await admin
        .from("account_members")
        .insert({ account_id: accountId, user_id: userId, role: "owner", joined_at: new Date().toISOString(), invited_by: invitedBy } as Record<string, unknown>)
        .select("id")
        .single();
      if (memErr || !member) throw new Error(`Could not create membership: ${memErr?.message ?? "unknown"}`);
      createdMemberId = member.id;
    }

    // Step 4 — freelancer profile (reuse if user already has one)
    const { data: existingProfile } = await admin
      .from("freelancer_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    profileExisted = !!existingProfile?.id;
    if (existingProfile?.id) {
      profileId = existingProfile.id as string;
    } else {
      const { data: prof, error: profErr } = await admin
        .from("freelancer_profiles")
        .insert({ user_id: userId, first_name: first, last_name: last, email } as Record<string, unknown>)
        .select("id")
        .single();
      if (profErr || !prof) throw new Error(`Could not create profile: ${profErr?.message ?? "unknown"}`);
      profileId = prof.id;
      createdProfileId = prof.id;
    }
  } catch (e) {
    await rollback();
    throw e;
  }

  return { userId, accountId, profileId, first, last, profileExisted };
}
