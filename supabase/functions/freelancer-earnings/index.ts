// freelancer-earnings/index.ts
//
// Returns the signed-in freelancer's own earnings, itemised LIVE from Airtable:
//   modeller_invoices     → Models              (model per model:  hours × rate)
//   scene_manager_invoice → Scene Manager Day Logs (day per day:   days × rate)
//   photographer_invoice  → Photographer Timesheet (session per session)
//
// The list of monthly invoices comes from payables_snapshot (the freelancer's
// own rows, matched on their authenticated email — they only ever see their
// own); the per-line detail + amounts are fetched live from Airtable on each
// request. Auth: the caller's own JWT.
//
// Deploy: npx supabase functions deploy freelancer-earnings \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(d: Record<string, unknown>, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// ── Airtable line-item mapping (field IDs from the base schema) ───────────────
interface LineMap { desc: string; date?: string; qty: string; unit: string; rate: string; amount: string; }
const SOURCES: Record<string, { invoiceTable: string; lineLink: string; lineTable: string; role: string; map: LineMap }> = {
  modeller_invoices: {
    invoiceTable: "tbl6WfMgznJYgevRt", lineLink: "fldyx5HEpDWR1aJp9", lineTable: "tbls6j4jyNifFyucU", role: "3D modelling",
    map: { desc: "fldfLuaosgg5GXQp0", qty: "fld13WMfDTokxMVsU", unit: "hrs", rate: "flddqPhtjYv0kN0tF", amount: "fldbCLIMAdyXTM1oF" },
  },
  scene_manager_invoice: {
    invoiceTable: "tblhYCC3InxUJUK3H", lineLink: "fldsmMtc29qeZGdWx", lineTable: "tblCOVVdOsjRt06iO", role: "Scene management",
    map: { desc: "fldCXuxsXzomGNuU4", date: "fldQTfPwfe0E4oNcF", qty: "fldaIEHxMv3eF8wQJ", unit: "days", rate: "fldBjguZNxzCCnySe", amount: "fldm2UMPMfvgGRYTf" },
  },
  photographer_invoice: {
    invoiceTable: "tblCoQXYZuUCh0Vgc", lineLink: "fldjSsRGpHvlXdyPf", lineTable: "tblsqmojQaxNM27GG", role: "Photography",
    map: { desc: "fldoyw861KQuk6SwU", date: "fldGvGiChWeAnqOAx", qty: "fld0k5aDOdhaYaxeB", unit: "hrs", rate: "fldrVHX5PfNyVpzg6", amount: "fldcElfVOXJcZTZh7" },
  },
};

function unwrap(v: unknown): unknown { return Array.isArray(v) ? v[0] : v; }
function num(v: unknown): number | null {
  const u = unwrap(v);
  if (u == null || typeof u === "object") return null;
  const n = typeof u === "number" ? u : parseFloat(String(u).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string { const u = unwrap(v); return u == null || typeof u === "object" ? "" : String(u); }

interface Line { description: string; date: string | null; qty: number | null; unit: string; rate: number | null; amount: number }
async function atFetch(pat: string, url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}`);
  return await r.json();
}
async function fetchLineItems(pat: string, baseId: string, source: string, invoiceRecId: string): Promise<Line[]> {
  const cfg = SOURCES[source];
  const rec = await atFetch(pat, `https://api.airtable.com/v0/${baseId}/${cfg.invoiceTable}/${invoiceRecId}?returnFieldsByFieldId=true`);
  const linked = ((rec.fields as Record<string, unknown>)[cfg.lineLink] as string[] | undefined) ?? [];
  if (!linked.length) return [];
  const lines: Line[] = [];
  for (let i = 0; i < linked.length; i += 40) {
    const chunk = linked.slice(i, i + 40);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const url = `https://api.airtable.com/v0/${baseId}/${cfg.lineTable}?returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`;
    const res = await atFetch(pat, url);
    for (const r of (res.records as { fields: Record<string, unknown> }[]) ?? []) {
      const fl = r.fields, m = cfg.map;
      const qty = num(fl[m.qty]), rate = num(fl[m.rate]);
      let amount = num(fl[m.amount]);
      if (amount == null && qty != null && rate != null) amount = Math.round(qty * rate * 100) / 100;
      const dateVal = m.date ? (str(fl[m.date]) || null) : null;
      const description = str(fl[m.desc]) || "Work item";
      lines.push({ description, date: dateVal, qty, unit: m.unit, rate, amount: amount ?? 0 });
    }
  }
  // Chronological: latest date at the top, earliest at the bottom.
  lines.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return lines;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.email) return json({ error: "Unauthorized" }, 401);
  let email = u.user.email.toLowerCase();

  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const pat = Deno.env.get("AIRTABLE_PAT");
  const baseId = Deno.env.get("AIRTABLE_BASE_ID");
  if (!pat || !baseId) return json({ error: "Airtable not configured" }, 500);

  // Admin override: an admin may view a specific team member's earnings by
  // passing { accountId }. We resolve that account's member to their email and
  // read that person's data instead of the caller's own.
  const body = req.method === "POST" ? await req.json().catch(() => ({} as Record<string, unknown>)) : {};
  const targetAccountId = typeof body.accountId === "string" ? body.accountId : null;
  if (targetAccountId) {
    const { data: adminRole } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!adminRole) return json({ error: "Forbidden — admin only" }, 403);
    const { data: mem } = await sb.from("account_members").select("user_id").eq("account_id", targetAccountId).order("joined_at", { ascending: true }).limit(1).maybeSingle();
    if (!mem?.user_id) return json({ error: "No member found for that account" }, 404);
    const { data: tu } = await sb.auth.admin.getUserById(mem.user_id);
    if (!tu?.user?.email) return json({ error: "That member has no email on file" }, 404);
    email = tu.user.email.toLowerCase();
  }

  // The freelancer's own monthly invoices (their email only).
  const { data: rows, error } = await sb.from("payables_snapshot")
    .select("source_table, airtable_record_id, period_year, period_month, period_date, invoice_total, amount_paid, balance_remaining, paid_status")
    .ilike("payee_email", email)
    .in("source_table", Object.keys(SOURCES));
  if (error) return json({ error: error.message }, 500);

  // Earliest year shown anywhere in the portal — matches the calendar's floor.
  // Future years are unbounded; this only ever hides history before 2026.
  const MIN_YEAR = 2026;
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const periods: Record<string, unknown>[] = [];
  let earned = 0, paid = 0, outstanding = 0;

  for (const row of rows ?? []) {
    // Earnings start in 2026 — nothing before that is shown, and it's excluded
    // from the totals too so the summary always matches the periods listed.
    // Rows with no year are kept (they'd otherwise vanish with no way to see them).
    const rowYear = row.period_year as number | null;
    if (rowYear != null && rowYear < MIN_YEAR) continue;

    const source = row.source_table as string;
    const total = Number(row.invoice_total) || 0;
    // Airtable tracks payment via paid_status + Remaining Balance (which is £0
    // once paid); the amount_paid field is left empty. So the balance is the
    // source of truth, and paid is derived from it — keeping earned − paid =
    // outstanding consistent across all three figures.
    const bal = row.balance_remaining != null
      ? Number(row.balance_remaining)
      : (row.paid_status === "paid" ? 0 : total);
    const amtPaid = Math.max(0, total - bal);
    earned += total; paid += amtPaid; outstanding += bal;

    let lines: Line[] = [];
    try { lines = await fetchLineItems(pat, baseId, source, row.airtable_record_id as string); } catch { /* leave empty on Airtable hiccup */ }

    const y = row.period_year as number | null;
    const m = row.period_month as number | null;
    periods.push({
      key: `${source}-${row.airtable_record_id}`,
      role: SOURCES[source].role,
      period_year: y, period_month: m,
      period_label: y && m ? `${MONTHS[m - 1]} ${y}` : (row.period_date ?? "—"),
      total, amount_paid: amtPaid, balance: bal,
      paid_status: row.paid_status ?? null,
      lines,
    });
  }

  // Newest period first.
  periods.sort((a, b) => {
    const ay = (a.period_year as number) || 0, by = (b.period_year as number) || 0;
    const am = (a.period_month as number) || 0, bm = (b.period_month as number) || 0;
    return by - ay || bm - am;
  });

  // Role for the header: the freelancer's profile role, else the first source seen.
  const { data: prof } = await sb.from("freelancer_profiles").select("first_name, last_name, role, rate_currency").ilike("email", email).maybeSingle();
  const currency = prof?.rate_currency || "GBP";

  return json({
    name: prof ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") : null,
    role: prof?.role ?? (periods[0]?.role ?? null),
    currency,
    totals: { earned, paid, outstanding },
    periods,
  });
});
