// Edge function: team-contract-accept
// Recipient-gated (authorised via the team_contracts SELECT RLS — the signer
// or the linked freelancer-profile owner; admins too). Handles the acceptance
// gate's Accept and Decline actions.
//
// accept:  generate the signed PDF (no watermark, signed name + date on the
//          signature page) → upload to freelancer-documents at
//          {user_id}/team-contracts/{contract_id}.pdf → mark signed → log →
//          email recipient + studio.
// decline: mark declined → log → notify studio.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadDesignConfig } from "../_shared/pdfUtils.ts";
import { generateTeamContractPdf, type TeamContractData } from "../_shared/documents/teamContractPdf.ts";

const STUDIO_NOTIFY_EMAIL = "fred@silvershadowstudio.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function partyOf(c: Record<string, unknown>): string {
  return (c.entity_type === "company" ? c.company_name : c.individual_full_name) as string ?? "the contractor";
}

async function notify(resendKey: string | undefined, to: string[], subject: string, html: string) {
  if (!resendKey) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
        to, subject, html,
        headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
        tags: [{ name: "category", value: "team-contract" }],
      }),
    });
    if (!res.ok) console.error("[team-contract-accept] Resend error:", await res.text());
  } catch (e) {
    console.error("[team-contract-accept] Resend exception:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => ({}));
  const contractId = typeof body?.contract_id === "string" ? body.contract_id : null;
  const action = body?.action === "decline" ? "decline" : body?.action === "accept" ? "accept" : null;
  const typedName = typeof body?.typed_name === "string" ? body.typed_name.trim() : "";
  if (!contractId) return json({ error: "contract_id is required" }, 400);
  if (!action) return json({ error: "action must be 'accept' or 'decline'" }, 400);

  // Authorise via RLS: if the user-scoped client can read the row, they own it.
  const { data: contract } = await userClient.from("team_contracts").select("*").eq("id", contractId).maybeSingle();
  if (!contract) return json({ error: "Not found or not authorised" }, 403);
  if (contract.status !== "sent") {
    return json({ error: `Contract is ${contract.status}; only a sent contract can be ${action}ed` }, 400);
  }

  // ── Decline ───────────────────────────────────────────────────────────────
  if (action === "decline") {
    const { error: updErr } = await admin.from("team_contracts")
      .update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", contractId);
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("activity_log").insert({
      actor_user_id: user.id, actor_role: "client", action: "team_contract_declined",
      description: `Engagement contract declined by ${partyOf(contract)}`,
      entity_type: "team_contract", entity_id: contractId,
    }).then(() => {}, () => {});

    await notify(resendKey, [STUDIO_NOTIFY_EMAIL],
      `Contract declined — ${partyOf(contract)}`,
      `<p style="font-family:Georgia,serif">${partyOf(contract)} has declined the engagement contract "${contract.subject_line}".</p>`);

    return json({ success: true });
  }

  // ── Accept ────────────────────────────────────────────────────────────────
  if (!typedName) return json({ error: "typed_name is required to accept" }, 400);

  const signedAt = new Date().toISOString();
  const design = await loadDesignConfig(admin);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateTeamContractPdf(
      { ...contract, signed_at: signedAt, signed_by_name: typedName } as TeamContractData,
      design,
      { watermark: false },
    );
  } catch (e) {
    console.error("[team-contract-accept] PDF generation failed:", e);
    return json({ error: "Failed to generate signed PDF" }, 500);
  }

  const storagePath = `${user.id}/team-contracts/${contractId}.pdf`;
  const { error: upErr } = await admin.storage.from("freelancer-documents")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    console.error("[team-contract-accept] upload failed:", upErr);
    return json({ error: "Failed to store signed PDF" }, 500);
  }

  const { error: updErr } = await admin.from("team_contracts").update({
    status: "signed",
    signed_at: signedAt,
    signed_by_user_id: user.id,
    storage_path: storagePath,
    updated_at: signedAt,
  }).eq("id", contractId);
  if (updErr) {
    console.error("[team-contract-accept] contract update failed:", updErr);
    return json({ error: updErr.message }, 500);
  }

  await admin.from("activity_log").insert({
    actor_user_id: user.id, actor_role: "client", action: "team_contract_signed",
    description: `Engagement contract signed by ${typedName}`,
    entity_type: "team_contract", entity_id: contractId,
    metadata: { signed_by_name: typedName },
  }).then(() => {}, () => {});

  const recipientEmail = contract.recipient_email as string | null;
  const confirmHtml = `<p style="font-family:Georgia,serif;color:#1A1814">Thank you — your engagement contract with Silver Shadow Studio ("${contract.subject_line}") has been signed and recorded on ${new Date(signedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. A copy is available in your portal.</p>`;
  if (recipientEmail) await notify(resendKey, [recipientEmail], "Your contract is signed — Silver Shadow Studio", confirmHtml);
  await notify(resendKey, [STUDIO_NOTIFY_EMAIL],
    `Contract signed — ${partyOf(contract)}`,
    `<p style="font-family:Georgia,serif">${typedName} has signed the engagement contract "${contract.subject_line}".</p>`);

  return json({ success: true, storage_path: storagePath });
});
