// Edge function: team-contract-send  ("Send to portal for signature")
// Admin-gated. Reuse-aware atomic provisioning for a draft engagement contract:
//   1. Load + validate the draft (status='draft', recipient_email set).
//   2. Reuse the auth user for recipient_email, or create one (email_confirm:false).
//   3/4. Reuse the user's existing account_members/account, or create a team account + membership.
//   5. Reuse the user's freelancer_profiles row, or create one.
//   6. Link the contract (account_id, profile_id), set status='sent', sent_at=now().
//   7. Send the "review and sign" invite via Resend (non-fatal — logged on failure).
//
// "Atomic" = compensating transaction (supabase-js has no multi-statement tx):
// if any of steps 2–6 fails, the pieces THIS request created are rolled back in
// reverse order; a reused auth user / account / profile is never deleted.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildTeamContractInviteHtml, TEAM_CONTRACT_INVITE_SUBJECT } from "../_shared/teamContractInvite.ts";
import { provisionTeamMember, splitName } from "../_shared/teamProvisioning.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Portal-domain verify URL for deliverability (DMARC alignment); falls back to
// the raw action link when token components are missing.
function buildPortalVerifyUrl(properties: Record<string, unknown> | undefined, fallback: string): string {
  const token = (properties?.hashed_token as string | undefined) ?? "";
  const type = (properties?.verification_type as string | undefined) ?? "";
  const redirectTo = (properties?.redirect_to as string | undefined) ?? "";
  if (!token || !type) return fallback;
  const params = new URLSearchParams({ token, type });
  if (redirectTo) params.set("redirect_to", redirectTo);
  return `${APP_BASE_URL}/auth/verify?${params.toString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Admin gate ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const contractId = typeof body?.contract_id === "string" ? body.contract_id : null;
  if (!contractId) return json({ error: "contract_id is required" }, 400);

  // ── Load + validate the draft ───────────────────────────────────────────
  const { data: contract, error: cErr } = await admin.from("team_contracts").select("*").eq("id", contractId).maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!contract) return json({ error: "Contract not found" }, 404);
  if (contract.status !== "draft") return json({ error: `Contract is already ${contract.status}` }, 400);
  const email = (contract.recipient_email as string | null)?.trim().toLowerCase();
  if (!email) return json({ error: "Contract has no recipient email" }, 400);

  // ── Reuse-aware provisioning ──────────────────────────────────────────────
  const isCompany = contract.entity_type === "company";
  const partyName = (isCompany ? contract.company_director_name : contract.individual_full_name) as string | null;
  const { first } = splitName(partyName);
  const companyLabel = (isCompany ? contract.company_name : contract.individual_full_name) as string | null || first;

  let accountId: string;
  let profileId: string;
  try {
    const provisioned = await provisionTeamMember(admin, {
      email,
      partyName,
      companyLabel,
      invitedBy: user.id,
    });
    accountId = provisioned.accountId;
    profileId = provisioned.profileId;

    // Link the contract + mark sent
    const { error: updErr } = await admin.from("team_contracts").update({
      account_id: accountId,
      profile_id: profileId,
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", contractId);
    if (updErr) throw new Error(`Could not update contract: ${updErr.message}`);
  } catch (e) {
    console.error("[team-contract-send] provisioning failed:", e);
    return json({ error: (e as Error)?.message ?? "Provisioning failed" }, 500);
  }

  // Activity event — provisioning succeeded.
  await admin.from("activity_log").insert({
    actor_user_id: user.id,
    actor_role: "admin",
    action: "team_contract_sent",
    description: `Engagement contract sent to ${email}`,
    entity_type: "team_contract",
    entity_id: contractId,
    metadata: { recipient_email: email },
  }).then(() => {}, () => {});

  // ── Step 7 — invite email (non-fatal) ─────────────────────────────────────
  let emailSent = false;
  let ctaUrl = `${APP_BASE_URL}/sign-team-contract/${contractId}`;
  try {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${APP_BASE_URL}/sign-team-contract/${contractId}` },
    });
    if (!linkErr && linkData?.properties) {
      ctaUrl = buildPortalVerifyUrl(linkData.properties as Record<string, unknown>, (linkData.properties.action_link as string) ?? ctaUrl);
    } else if (linkErr) {
      console.error("[team-contract-send] generateLink failed:", linkErr);
    }
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
          to: [email],
          subject: TEAM_CONTRACT_INVITE_SUBJECT,
          html: buildTeamContractInviteHtml(first, ctaUrl),
          headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
          tags: [{ name: "category", value: "team-contract-invite" }],
        }),
      });
      emailSent = res.ok;
      if (!res.ok) console.error("[team-contract-send] Resend error:", await res.text());
    }
  } catch (e) {
    // Contract stays 'sent'; admin can re-send. Email failure is non-fatal.
    console.error("[team-contract-send] invite send failed:", e);
  }

  return json({ success: true, contract_id: contractId, recipient_email: email, emailSent });
});
