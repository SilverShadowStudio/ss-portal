// Edge function: team-invite-send
// Sends a team member a "set your password" link via RESEND (the HTTP API that
// the portal's invites already use), NOT Supabase's built-in auth SMTP — so it
// works even when the auth mailer is misconfigured. Doubles as a "(re)send
// invite" for any team member. Admin-gated.
//
// Body: { account_id }  → magic link to /set-password, emailed to the account's owner.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildInviteEmailHtml, EMAIL_INVITE_DEFAULTS } from "../_shared/emailTemplates.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com";
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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

  let body: { account_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const accountId = body.account_id?.trim();
  if (!accountId) return json({ error: "account_id is required" }, 400);

  // ── Resolve owner email + name ──────────────────────────────────────────────
  const { data: account } = await admin.from("accounts").select("id, company_name, owner_user_id").eq("id", accountId).maybeSingle();
  if (!account?.owner_user_id) return json({ error: "Account or owner not found" }, 404);
  const { data: ownerUser } = await admin.auth.admin.getUserById(account.owner_user_id as string);
  const email = ownerUser?.user?.email;
  if (!email) return json({ error: "Owner has no email" }, 404);

  const { data: fp } = await admin.from("freelancer_profiles").select("first_name").eq("user_id", account.owner_user_id).maybeSingle();
  const firstName = (fp?.first_name as string | null) ?? null;
  const displayName = (account.company_name as string) || email;

  // ── Generate a magic link → /set-password (no email sent by GoTrue) ─────────
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_BASE_URL}/set-password` },
  });
  if (linkErr || !linkData?.properties) {
    console.error("[team-invite-send] generateLink failed:", linkErr);
    return json({ error: linkErr?.message || "Failed to generate link" }, 500);
  }
  const props = linkData.properties as Record<string, unknown>;
  const ctaUrl = buildPortalVerifyUrl(props, (props.action_link as string) ?? APP_BASE_URL);

  // ── Send via Resend (the working path) ──────────────────────────────────────
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

  const { data: cfgRow } = await admin.from("app_settings").select("value").eq("key", "email_invite_config").maybeSingle();
  const emailConfig = (cfgRow?.value as Record<string, unknown> | null) ?? {};
  const html = buildInviteEmailHtml(displayName, ctaUrl, {
    ...EMAIL_INVITE_DEFAULTS,
    ...emailConfig,
    ctaUrl: undefined,
    firstName,
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
  if (!res.ok) {
    const errText = await res.text();
    console.error("[team-invite-send] Resend error:", errText);
    return json({ error: `Resend failed: ${errText.slice(0, 200)}` }, 502);
  }

  await admin.from("activity_log").insert({
    actor_user_id: user.id,
    actor_role: "admin",
    action: "invite_sent",
    description: `Set-password link emailed to ${email} (Resend)`,
    metadata: { company_name: displayName, mode: "team-invite-send" },
  }).then(() => {}, () => {});

  return json({ success: true, email });
});
