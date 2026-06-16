// Edge function: team-contract-upload-presigned
// Admin-gated. Records a pre-existing paper/PDF contract for a team member:
//   1. Admin gate
//   2. Parse + validate multipart/form-data (PDF + metadata)
//   3. Provision team member — find/create auth user, account, membership, profile
//   4. Create team_contracts row (status='signed', is_pre_signed=true)
//   5. Upload PDF to freelancer-documents bucket
//   6. Write storage_path back to the contract row
//   7. Send standard portal invite email so the member can log in (non-fatal)
//   8. Log team_contract_uploaded activity
//
// Accepted form fields:
//   email         (required) — member email
//   name          (required) — member full name
//   signed_by_name (required) — name of the physical signatory on the paper
//   signing_date  (required) — ISO date YYYY-MM-DD when the paper was signed
//   subject_line  (optional) — contract title (default: "Pre-signed engagement contract")
//   pdf           (required) — File, application/pdf, max 10MB

import { createClient } from "npm:@supabase/supabase-js@2";
import { provisionTeamMember, splitName } from "../_shared/teamProvisioning.ts";
import { buildInviteEmailHtml, EMAIL_INVITE_DEFAULTS } from "../_shared/emailTemplates.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com";
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Forbidden" }, 403);

  // ── Parse multipart form ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const name = (formData.get("name") as string | null)?.trim();
  const signedByName = (formData.get("signed_by_name") as string | null)?.trim();
  const signingDate = (formData.get("signing_date") as string | null)?.trim();
  const subjectLine = (formData.get("subject_line") as string | null)?.trim() || "Pre-signed engagement contract";
  const pdfFile = formData.get("pdf") as File | null;

  // Required field validation
  if (!email) return json({ error: "email is required" }, 400);
  if (!name) return json({ error: "name is required" }, 400);
  if (!signedByName) return json({ error: "signed_by_name is required" }, 400);
  if (!signingDate) return json({ error: "signing_date is required" }, 400);
  if (!pdfFile) return json({ error: "pdf file is required" }, 400);

  // Date validation
  const signedAt = new Date(signingDate);
  if (isNaN(signedAt.getTime())) return json({ error: "signing_date must be a valid date (YYYY-MM-DD)" }, 400);

  // PDF validation
  if (pdfFile.type !== "application/pdf") return json({ error: "File must be a PDF (application/pdf)" }, 400);
  if (pdfFile.size > MAX_PDF_BYTES) return json({ error: "PDF must be 10 MB or smaller" }, 400);

  const { first } = splitName(name);

  // ── Provision team member ───────────────────────────────────────────────────
  let userId: string;
  let accountId: string;
  let profileId: string;
  try {
    const provisioned = await provisionTeamMember(admin, {
      email,
      partyName: name,
      companyLabel: name,
      invitedBy: user.id,
    });
    userId = provisioned.userId;
    accountId = provisioned.accountId;
    profileId = provisioned.profileId;
  } catch (e) {
    console.error("[team-contract-upload-presigned] provisioning failed:", e);
    return json({ error: (e as Error)?.message ?? "Provisioning failed" }, 500);
  }

  // ── Create signed contract row (storage_path filled after upload) ───────────
  const { data: contractRow, error: insertErr } = await admin
    .from("team_contracts")
    .insert({
      account_id: accountId,
      profile_id: profileId,
      entity_type: "individual",
      individual_full_name: name,
      recipient_email: email,
      subject_line: subjectLine,
      scope_description: "See attached signed contract document.",
      fee_amount: 0,
      fee_currency: "GBP",
      status: "signed",
      is_pre_signed: true,
      signed_at: signedAt.toISOString(),
      signed_by_name: signedByName,
      signed_by_user_id: userId,
      created_by: user.id,
    } as Record<string, unknown>)
    .select("id")
    .single();

  if (insertErr || !contractRow) {
    console.error("[team-contract-upload-presigned] contract insert failed:", insertErr);
    return json({ error: insertErr?.message ?? "Failed to create contract record" }, 500);
  }

  const contractId = contractRow.id as string;

  // ── Upload PDF ──────────────────────────────────────────────────────────────
  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
  const storagePath = `${userId}/team-contracts/${contractId}-presigned.pdf`;

  const { error: upErr } = await admin.storage
    .from("freelancer-documents")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (upErr) {
    console.error("[team-contract-upload-presigned] upload failed:", upErr);
    // Contract row exists but has no storage_path — mark it cancelled so it
    // doesn't appear as a phantom signed record without a file.
    await admin.from("team_contracts").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", contractId).then(() => {}, () => {});
    return json({ error: "Failed to upload PDF — please try again" }, 500);
  }

  // Write storage_path back to contract row
  await admin.from("team_contracts").update({
    storage_path: storagePath,
    updated_at: new Date().toISOString(),
  }).eq("id", contractId);

  // ── Activity log ────────────────────────────────────────────────────────────
  await admin.from("activity_log").insert({
    actor_user_id: user.id,
    actor_role: "admin",
    action: "team_contract_uploaded",
    description: `Pre-signed contract uploaded for ${name}`,
    entity_type: "team_contract",
    entity_id: contractId,
    metadata: { recipient_email: email, signed_by_name: signedByName },
  }).then(() => {}, () => {});

  // ── Portal invite email (non-fatal) ─────────────────────────────────────────
  // Member still needs portal access — send the standard invite email.
  let emailSent = false;
  try {
    const { data: settingsRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "email_invite_config")
      .maybeSingle();
    const emailConfig = (settingsRow?.value as Record<string, unknown> | null) ?? {};

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: APP_BASE_URL },
    });
    let ctaUrl = APP_BASE_URL;
    if (!linkErr && linkData?.properties) {
      ctaUrl = buildPortalVerifyUrl(linkData.properties as Record<string, unknown>, (linkData.properties.action_link as string) ?? ctaUrl);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const html = buildInviteEmailHtml(name, ctaUrl, {
        ...EMAIL_INVITE_DEFAULTS,
        ...emailConfig,
        ctaUrl: undefined,
        firstName: first,
      });
      const subject = (emailConfig.subject as string | undefined) ?? EMAIL_INVITE_DEFAULTS.subject ?? "Your Silver Shadow Studio portal is ready.";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
          to: [email],
          subject,
          html,
          headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
          tags: [{ name: "category", value: "team-invite" }],
        }),
      });
      emailSent = res.ok;
      if (!res.ok) console.error("[team-contract-upload-presigned] Resend error:", await res.text());
    }
  } catch (e) {
    console.error("[team-contract-upload-presigned] invite email failed:", e);
  }

  return json({ success: true, contract_id: contractId, storage_path: storagePath, emailSent });
});
