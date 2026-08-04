// Edge function: admin-clear-member-activity
// Clears a team member's tracked activity history — the session/page-view rows
// (client_activity) and the "logged in" audit rows (activity_log client_login /
// client_registered) — while KEEPING real lifecycle milestones (invite_opened,
// password_set, team_onboarding_confirmed, etc.). Used to wipe test/setup noise
// so a card reflects genuine access only. Admin-gated. Fully scoped to one
// account's members.
//
// Body: { account_id: string }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, service);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  let body: { account_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const accountId = body.account_id?.trim();
  if (!accountId) return json({ error: "account_id is required" }, 400);

  // Resolve the account's member user ids.
  const { data: members } = await admin.from("account_members").select("user_id").eq("account_id", accountId);
  const userIds = Array.from(new Set((members ?? []).map((m) => (m as { user_id: string }).user_id).filter(Boolean)));
  if (userIds.length === 0) return json({ error: "No members found for that account" }, 404);

  // 1) All session/page-view tracking for these users.
  const { error: caErr, count: caCount } = await admin
    .from("client_activity").delete({ count: "exact" }).in("user_id", userIds);
  if (caErr) return json({ error: `client_activity: ${caErr.message}` }, 500);

  // 2) The "logged in" audit rows only — genuine milestones (invite_opened,
  //    password_set, team_onboarding_confirmed, …) are deliberately preserved.
  const { error: alErr, count: alCount } = await admin
    .from("activity_log").delete({ count: "exact" })
    .in("actor_user_id", userIds)
    .in("action", ["client_login", "client_registered"]);
  if (alErr) return json({ error: `activity_log: ${alErr.message}` }, 500);

  return json({ success: true, cleared: { client_activity: caCount ?? 0, logins: alCount ?? 0 } });
});
