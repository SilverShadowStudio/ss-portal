// Account-scoped agreement check. "Signed" means the user's account has
// any row in `agreements` whose version is in SUPPORTED_AGREEMENT_VERSIONS.
// Scope is the account (not the auth user) so an invitee whose Manager
// already signed is not gated, and so the `hasSignedAgreement` flag in
// AuthContext and `status` in useAgreementGate cannot drift.
//
// Uses the SECURITY DEFINER RPC `public.account_has_signed_agreement` so
// invitees — who cannot SELECT public.agreements rows directly under RLS
// — still get a boolean answer. The RPC verifies caller membership
// before answering; see migration 20260623000001.

import { supabase } from "@/integrations/supabase/client";

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

  const { data: signed } = await supabase
    .rpc("account_has_signed_agreement", { p_account_id: accountId });
  return signed === true ? "signed" : "no_signature";
}
