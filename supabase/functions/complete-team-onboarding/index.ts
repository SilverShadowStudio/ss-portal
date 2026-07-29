// Edge function: complete-team-onboarding
// The no-sign path for PRE-SIGNED team members. Their agreement was signed on
// paper and uploaded by an admin, so onboarding is a proofread-and-confirm step,
// not a signing step. The member reviews their prefilled details, fills in what
// the contract didn't carry (address, bank), and confirms — this writes those to
// their freelancer_profiles row and flips onboarding_confirmed = true.
//
// Self-service: the caller updates only their OWN profile. No admin gate.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Body {
  role?: string;
  rateAmount?: number | string;
  rateCurrency?: string;
  ratePeriod?: string;
  flatNumber?: string;
  houseNumber?: string;
  streetName?: string;
  city?: string;
  postcode?: string;
  country?: string;
  bankName?: string;
  accountHolder?: string;
  sortCode?: string;
  accountNumber?: string;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function formatAddress(b: Body): string {
  const flat = s(b.flatNumber) ? `Flat ${s(b.flatNumber)}, ` : "";
  return `${flat}${s(b.houseNumber)} ${s(b.streetName)}, ${s(b.city)}, ${s(b.postcode)}, ${s(b.country)}`.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Auth: the caller acts on their own profile only ──────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Guard: only complete a profile that is actually a pending pre-signed one.
  const { data: profile } = await admin
    .from("freelancer_profiles")
    .select("id, onboarding_confirmed")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "No team profile found for this user" }, 404);

  const rateNum = typeof body.rateAmount === "number"
    ? body.rateAmount
    : parseFloat(String(body.rateAmount ?? "").replace(/[^0-9.]/g, ""));

  const { error: upErr } = await admin
    .from("freelancer_profiles")
    .update({
      role: s(body.role) || null,
      day_rate: Number.isFinite(rateNum) && rateNum > 0 ? rateNum : null,
      rate_currency: s(body.rateCurrency) || "GBP",
      rate_period: s(body.ratePeriod) || "day",
      flat_number: s(body.flatNumber) || null,
      house_number: s(body.houseNumber) || null,
      street_name: s(body.streetName) || null,
      city: s(body.city) || null,
      postcode: s(body.postcode) || null,
      country: s(body.country) || null,
      address: formatAddress(body),
      bank_name: s(body.bankName) || null,
      account_holder: s(body.accountHolder) || null,
      sort_code: s(body.sortCode) || null,
      account_number: s(body.accountNumber) || null,
      onboarding_confirmed: true,
    } as Record<string, unknown>)
    .eq("user_id", user.id);

  if (upErr) {
    console.error("[complete-team-onboarding] update failed:", upErr);
    return json({ error: upErr.message }, 500);
  }

  await admin.from("activity_log").insert({
    actor_user_id: user.id,
    actor_role: "team",
    action: "team_onboarding_confirmed",
    description: "Pre-signed team member confirmed their details",
    entity_type: "freelancer_profile",
    entity_id: profile.id,
  }).then(() => {}, () => {});

  return json({ success: true });
});
