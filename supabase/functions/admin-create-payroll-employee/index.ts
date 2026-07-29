// Edge function: admin-create-payroll-employee
// Creates a PAYROLL-ONLY employee record — a bare accounts row used purely for
// Salaries / Taxes / P&L + payslips. No auth user, no membership, no invite, no
// onboarding: it never appears as a team member. Owned by the admin who creates
// it (accounts.owner_user_id is NOT NULL) so it stays private to the studio.
//
// Body: { name: string, position?: string, gross_salary_annual?: number }

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

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  let body: { name?: string; position?: string; gross_salary_annual?: number | string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const name = (body.name ?? "").trim();
  if (!name) return json({ error: "name is required" }, 400);
  const position = (body.position ?? "").toString().trim() || null;
  const grossRaw = body.gross_salary_annual;
  const gross = typeof grossRaw === "number" ? grossRaw : parseFloat(String(grossRaw ?? "").replace(/[^0-9.]/g, ""));

  const { data: acct, error } = await admin.from("accounts").insert({
    company_name: name,
    account_type: "team",
    owner_user_id: user.id,       // owned by the creating admin; no membership created
    employment_type: "employee",
    payroll_only: true,
    position,
    gross_salary_annual: Number.isFinite(gross) && gross > 0 ? gross : null,
    salary_start_date: null,
  } as Record<string, unknown>).select("id").single();

  if (error) return json({ error: error.message }, 500);
  return json({ success: true, account_id: acct.id });
});
