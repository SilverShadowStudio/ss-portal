// Edge function: recurring-overheads-generate
// Turns recurring_overheads templates into concrete monthly overheads. For each
// active template it walks every month from start_date to the current month
// (capped at end_date) and, where an overhead for that template+period doesn't
// already exist, inserts an UNPAID overhead due on the template's day_of_month.
// Idempotent via the (recurring_overhead_id, recurring_period) unique index, so
// it's safe to run monthly by cron AND on-demand right after a template is
// created (which backfills any arrears immediately).
//
// Auth: shared cron secret (X-Cron-Secret) OR an admin JWT. Mirrors payables-sync.

import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const pad = (n: number) => String(n).padStart(2, "0");

interface Template {
  id: string; supplier_name: string; category_code: string | null; description: string | null;
  currency: string; net_amount: number; vat_amount: number; gross_amount: number; vat_treatment: string | null;
  day_of_month: number; start_date: string; end_date: string | null; active: boolean;
  frequency: string | null; lead_days: number | null;
}

const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * Every occurrence date from the contract start to (now + lead_days), stepping
 * by the cadence. lead_days lets a bill appear ahead of its period — rent set
 * to ~20 days surfaces next month's 1st-of-month entry around the 15th.
 * Each occurrence is dated on day_of_month of its month.
 */
function occurrencesFor(t: Template): { key: string; date: string; y: number; m: number }[] {
  const step = t.frequency === "annual" ? 12 : t.frequency === "quarterly" ? 3 : 1;
  const start = new Date(t.start_date + "T00:00:00Z");
  const lead = Math.max(0, Number(t.lead_days) || 0);
  const horizon = new Date(Date.now() + lead * 86_400_000);
  const end = t.end_date ? new Date(t.end_date + "T00:00:00Z") : null;
  const out: { key: string; date: string; y: number; m: number }[] = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  let safety = 0;
  while (safety < 600) {
    safety++;
    const day = Math.min(t.day_of_month || 1, daysInMonth(y, m));
    const d = new Date(Date.UTC(y, m, day));
    if (d.getTime() > horizon.getTime()) break;
    if (end && d.getTime() > end.getTime()) break;
    // Don't bill before the contract starts.
    if (d.getTime() >= start.getTime()) out.push({ key: `${y}-${pad(m + 1)}`, date: `${y}-${pad(m + 1)}-${pad(day)}`, y, m });
    m += step; while (m > 11) { m -= 12; y++; }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  // Auth: cron secret OR admin JWT. Secret lives in Vault as 'cron_secret' and
  // is exposed to functions as CRON_SECRET (fallback to the older PAYABLES name).
  const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("PAYABLES_CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const isCron = cronSecret.length > 0 && constantTimeEqual(provided, cronSecret);
  let actorId: string | null = null;
  if (!isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await uc.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Forbidden" }, 403);
    actorId = u.user.id;
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const onlyId = typeof body.recurring_overhead_id === "string" ? body.recurring_overhead_id : null;

  let q = sb.from("recurring_overheads").select("*").eq("active", true);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: templates, error: tErr } = await q;
  if (tErr) return json({ error: tErr.message }, 500);

  let created = 0;
  const details: { template: string; created: string[] }[] = [];

  for (const t of (templates ?? []) as Template[]) {
    const periods = occurrencesFor(t);
    if (periods.length === 0) continue;

    // Which periods already have a generated overhead?
    const { data: existing } = await sb
      .from("overheads")
      .select("recurring_period")
      .eq("recurring_overhead_id", t.id);
    const have = new Set((existing ?? []).map((r: { recurring_period: string | null }) => r.recurring_period));

    const rowsToInsert = periods
      .filter((p) => !have.has(p.key))
      .map((p) => {
        const due = p.date;
        return {
          supplier_name: t.supplier_name,
          category_code: t.category_code,
          description: t.description,
          currency: t.currency || "GBP",
          net_amount: t.net_amount,
          vat_amount: t.vat_amount,
          gross_amount: t.gross_amount,
          vat_treatment: t.vat_treatment,
          invoice_date: due, // tax point ~ due day for a recurring bill
          due_date: due,
          // Every generated bill starts DUE — Fred ticks them off in Debts.
          payment_status: "unpaid",
          payment_date: null,
          source: "recurring",
          recurring_overhead_id: t.id,
          recurring_period: p.key,
          created_by: actorId,
        } as Record<string, unknown>;
      });

    if (rowsToInsert.length > 0) {
      // onConflict guard in case of a race — the unique index makes re-inserts no-ops.
      const { error: insErr } = await sb.from("overheads").insert(rowsToInsert);
      if (insErr) {
        console.error("[recurring-overheads-generate] insert failed for", t.id, insErr.message);
      } else {
        created += rowsToInsert.length;
        details.push({ template: t.supplier_name, created: rowsToInsert.map((r) => r.recurring_period as string) });
      }
    }
  }

  return json({ success: true, created, details });
});
