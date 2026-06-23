// Account-scoped agreement check. "Signed" means the user's account has
// any row in `agreements` whose version is in SUPPORTED_AGREEMENT_VERSIONS.
// Scope is the account (not the auth user) so an invitee whose Manager
// already signed is not gated, and so the `hasSignedAgreement` flag in
// AuthContext and `status` in useAgreementGate cannot drift.

import { supabase } from "@/integrations/supabase/client";
import { SUPPORTED_AGREEMENT_VERSIONS } from "@/lib/agreements";

export type AccountAgreementResult = "no_account" | "no_signature" | "signed";

export async function checkAccountAgreementForUser(
  userId: string,
): Promise<AccountAgreementResult> {
  const { data: membership } = await supabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();
  const accountId =
    (membership as { account_id: string } | null)?.account_id ?? null;
  if (!accountId) return "no_account";

  const { data: rows } = await supabase
    .from("agreements")
    .select("id")
    .eq("account_id", accountId)
    .in("agreement_version", SUPPORTED_AGREEMENT_VERSIONS as unknown as string[])
    .limit(1);
  if (Array.isArray(rows) && rows.length > 0) return "signed";
  return "no_signature";
}
