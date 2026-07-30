// Edge function: payroll-roll-forward
// Monthly: for each employee, if there's no payslip for the CURRENT month, create
// one by copying the most recent month's figures (net, tax, NI, student loan…).
// This keeps Debts → Salaries and Debts → Taxes populated automatically once the
// imported accountant's tracker runs out. Re-importing the tracker or an admin
// manual entry corrects any month. Idempotent (skips months that already exist).
//
// Auth: shared cron secret (X-Cron-Secret) OR an admin JWT.

import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  // Auth: cron secret OR admin JWT.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("PAYABLES_CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const isCron = cronSecret.length > 0 && constantTimeEqual(provided, cronSecret);
  if (!isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await uc.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Forbidden" }, 403);
  }

  // Allow a specific month via body (year, month 1-12); default to the current month.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const now = new Date();
  const y = Number(body.year) || now.getUTCFullYear();
  const m0 = (Number(body.month) || (now.getUTCMonth() + 1)) - 1; // 0-based
  const periodLabel = `${MON[m0]} ${y}`;
  const periodEnd = `${y}-${pad(m0 + 1)}-${pad(new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate())}`;

  const { data: employees, error: empErr } = await sb.from("accounts").select("id").eq("employment_type", "employee");
  if (empErr) return json({ error: empErr.message }, 500);

  const created: string[] = [];
  for (const emp of employees ?? []) {
    const accountId = (emp as { id: string }).id;
    // Already have this month?
    const { data: existing } = await sb.from("payslips").select("id").eq("account_id", accountId).eq("period_label", periodLabel).limit(1).maybeSingle();
    if (existing) continue;
    // Copy the most recent month.
    const { data: last } = await sb.from("payslips")
      .select("gross, net, income_tax, employee_ni, employer_ni, student_loan, employer_pension, employer_cost")
      .eq("account_id", accountId).order("period_end", { ascending: false }).limit(1).maybeSingle();
    if (!last) continue; // nothing to roll forward from yet
    const { error: insErr } = await sb.from("payslips").insert({
      account_id: accountId,
      period_label: periodLabel,
      period_end: periodEnd,
      gross: last.gross,
      net: last.net,
      income_tax: last.income_tax,
      employee_ni: last.employee_ni,
      employer_ni: last.employer_ni,
      student_loan: last.student_loan,
      employer_pension: last.employer_pension ?? 0,
      employer_cost: last.employer_cost,
    });
    if (insErr) console.error(`[payroll-roll-forward] insert failed for ${accountId}:`, insErr.message);
    else created.push(accountId);
  }

  return json({ success: true, period: periodLabel, created: created.length });
});
