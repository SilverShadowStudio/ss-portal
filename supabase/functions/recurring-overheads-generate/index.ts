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
}

/** Every YYYY-MM from start's month to the earlier of (now, end_date). */
function periodsFor(startDate: string, endDate: string | null): { key: string; y: number; m: number }[] {
  const start = new Date(startDate + "T00:00:00Z");
  const now = new Date();
  const cap = endDate ? new Date(endDate + "T00:00:00Z") : now;
  const last = now.getTime() < cap.getTime() ? now : cap;
  const out: { key: string; y: number; m: number }[] = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth(); // 0-based
  const lastY = last.getUTCFullYear(), lastM = last.getUTCMonth();
  // Guard against runaway loops (e.g. a bad far-past start_date).
  let safety = 0;
  while ((y < lastY || (y === lastY && m <= lastM)) && safety < 240) {
    out.push({ key: `${y}-${pad(m + 1)}`, y, m });
    m++; if (m > 11) { m = 0; y++; }
    safety++;
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
  const isCron = cronSecret.length > 0 && provided.length === cronSecret.length && provided === cronSecret;
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
    const periods = periodsFor(t.start_date, t.end_date);
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
        const due = `${p.y}-${pad(p.m + 1)}-${pad(t.day_of_month)}`;
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
