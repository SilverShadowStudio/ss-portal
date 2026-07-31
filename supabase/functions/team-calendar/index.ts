// team-calendar
//
// Backs the team availability calendar. One action-routed function (invoke with
// a body { action }) so it works through supabase.functions.invoke.
//
//   get          → calendar data for one account+year: worked days (live from
//                  Airtable for freelancers, weekday pattern for employees),
//                  bank holidays, leave/unavailability requests, allowance +
//                  taken + remaining.
//   request      → submit day(s) as holiday/unavailable. Team member → pending;
//                  admin → approved immediately.
//   review       → admin approves/declines a pending request.
//   cancel       → remove a request (own pending, or admin any).
//   set-allowance→ admin sets an account's annual leave allowance.
//
// Auth: caller's JWT. Admins act on any account; a team member only on the
// account they belong to (account_members). Service role does the writes, with
// the caller check enforced in-handler — same trust model as freelancer-earnings.
//
// Deploy: npx supabase functions deploy team-calendar \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Airtable day-log mapping (dated sources only — worked days need a date) ────
interface LineMap { date: string; qty: string; unit: string; }
const DAY_SOURCES: Record<string, { invoiceTable: string; lineLink: string; lineTable: string; map: LineMap }> = {
  scene_manager_invoice: {
    invoiceTable: "tblhYCC3InxUJUK3H", lineLink: "fldsmMtc29qeZGdWx", lineTable: "tblCOVVdOsjRt06iO",
    map: { date: "fldQTfPwfe0E4oNcF", qty: "fldaIEHxMv3eF8wQJ", unit: "days" },
  },
  photographer_invoice: {
    invoiceTable: "tblCoQXYZuUCh0Vgc", lineLink: "fldjSsRGpHvlXdyPf", lineTable: "tblsqmojQaxNM27GG",
    map: { date: "fldGvGiChWeAnqOAx", qty: "fld0k5aDOdhaYaxeB", unit: "hrs" },
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

async function atFetch(pat: string, url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}`);
  return await r.json();
}

// Worked-day fractions for one account, keyed by ISO date, within [from,to].
// Scene-manager lines carry the fraction directly (days); hour-based sources
// count as a worked day (fraction 1) on the logged date.
async function fetchWorkedDays(
  sb: ReturnType<typeof createClient>, pat: string, baseId: string, email: string, from: string, to: string,
): Promise<Record<string, number>> {
  const worked: Record<string, number> = {};
  const { data: invoices } = await sb.from("payables_snapshot")
    .select("source_table, airtable_record_id")
    .ilike("payee_email", email)
    .in("source_table", Object.keys(DAY_SOURCES));
  for (const inv of invoices ?? []) {
    const cfg = DAY_SOURCES[inv.source_table as string];
    if (!cfg) continue;
    let rec: Record<string, unknown>;
    try {
      rec = await atFetch(pat, `https://api.airtable.com/v0/${baseId}/${cfg.invoiceTable}/${inv.airtable_record_id}?returnFieldsByFieldId=true`);
    } catch { continue; }
    const linked = ((rec.fields as Record<string, unknown>)[cfg.lineLink] as string[] | undefined) ?? [];
    for (let i = 0; i < linked.length; i += 40) {
      const chunk = linked.slice(i, i + 40);
      const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const url = `https://api.airtable.com/v0/${baseId}/${cfg.lineTable}?returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`;
      let res: Record<string, unknown>;
      try { res = await atFetch(pat, url); } catch { continue; }
      for (const r of (res.records as { fields: Record<string, unknown> }[]) ?? []) {
        const date = str(r.fields[cfg.map.date]).slice(0, 10);
        if (!date || date < from || date > to) continue;
        const qty = num(r.fields[cfg.map.qty]);
        const frac = cfg.map.unit === "days" && qty != null ? qty : 1;
        worked[date] = (worked[date] ?? 0) + frac;
      }
    }
  }
  return worked;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  const caller = u?.user;
  if (!caller?.id) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Admin?
  const { data: roleRow } = await sb.from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
  const isAdmin = !!roleRow;

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  // Resolve the target account and authorize the caller against it.
  async function resolveAccount(explicitId?: string): Promise<{ id: string; error?: string } | null> {
    if (explicitId) {
      if (isAdmin) return { id: explicitId };
      // Non-admin: must belong to this account.
      const { data: mem } = await sb.from("account_members").select("account_id").eq("user_id", caller.id).eq("account_id", explicitId).maybeSingle();
      return mem ? { id: explicitId } : { id: "", error: "Forbidden" };
    }
    // No id → the caller's own team account.
    const { data: mine } = await sb.from("account_members")
      .select("account_id, accounts(account_type)")
      .eq("user_id", caller.id);
    const team = (mine ?? []).find((m: Record<string, unknown>) => (m.accounts as { account_type?: string } | null)?.account_type === "team");
    if (!team) return { id: "", error: "No team account for this user" };
    return { id: team.account_id as string };
  }

  try {
    if (action === "get") {
      const resolved = await resolveAccount(body?.account_id);
      if (!resolved || resolved.error) return json({ error: resolved?.error ?? "Not found" }, resolved?.error === "Forbidden" ? 403 : 404);
      const accountId = resolved.id;
      const year = Number(body?.year) || new Date().getUTCFullYear();
      const from = body?.from || `${year}-01-01`;
      const to = body?.to || `${year}-12-31`;

      const { data: acct } = await sb.from("accounts")
        .select("company_name, employment_type, annual_leave_allowance, work_start_date").eq("id", accountId).maybeSingle();
      if (!acct) return json({ error: "Account not found" }, 404);

      // Worked days: freelancers → Airtable; employees → weekday pattern (client renders).
      let workedDays: { date: string; fraction: number }[] = [];
      let workPattern: "airtable" | "weekdays" = "weekdays";
      if (acct.employment_type !== "employee") {
        workPattern = "airtable";
        const pat = Deno.env.get("AIRTABLE_PAT"); const baseId = Deno.env.get("AIRTABLE_BASE_ID");
        // Find the account's Airtable-matching email via its members' freelancer profiles.
        const { data: members } = await sb.from("account_members").select("user_id").eq("account_id", accountId);
        const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
        let email: string | null = null;
        if (userIds.length) {
          const { data: prof } = await sb.from("freelancer_profiles").select("email").in("user_id", userIds).not("email", "is", null).limit(1).maybeSingle();
          email = prof?.email ?? null;
        }
        if (pat && baseId && email) {
          const worked = await fetchWorkedDays(sb, pat, baseId, email.toLowerCase(), from, to);
          workedDays = Object.entries(worked).map(([date, fraction]) => ({ date, fraction: Math.round(fraction * 100) / 100 }));
        }
      }

      const { data: holidays } = await sb.from("bank_holidays")
        .select("holiday_date, name").eq("division", "england-and-wales").gte("holiday_date", from).lte("holiday_date", to);

      const { data: leave } = await sb.from("team_leave_requests")
        .select("id, leave_date, kind, fraction, status, note").eq("account_id", accountId).gte("leave_date", from).lte("leave_date", to);

      // Allowance countdown: approved holiday fractions in the calendar year.
      const { data: yearLeave } = await sb.from("team_leave_requests")
        .select("fraction").eq("account_id", accountId).eq("kind", "holiday").eq("status", "approved")
        .gte("leave_date", `${year}-01-01`).lte("leave_date", `${year}-12-31`);
      const taken = (yearLeave ?? []).reduce((s, r) => s + Number(r.fraction || 0), 0);
      const allowance = Number(acct.annual_leave_allowance ?? 20);

      return json({
        accountId, accountName: acct.company_name, employmentType: acct.employment_type ?? null,
        workStartDate: acct.work_start_date ?? null,
        isAdmin, year, from, to, workPattern, workedDays,
        bankHolidays: (holidays ?? []).map((h) => ({ date: h.holiday_date, name: h.name })),
        leave: (leave ?? []).map((l) => ({ id: l.id, date: l.leave_date, kind: l.kind, fraction: Number(l.fraction), status: l.status, note: l.note })),
        allowance, taken: Math.round(taken * 100) / 100, remaining: Math.round((allowance - taken) * 100) / 100,
      });
    }

    if (action === "request") {
      const resolved = await resolveAccount(body?.account_id);
      if (!resolved || resolved.error) return json({ error: resolved?.error ?? "Not found" }, resolved?.error === "Forbidden" ? 403 : 404);
      const accountId = resolved.id;
      const days = Array.isArray(body?.days) ? body.days : [];
      if (!days.length) return json({ error: "No days provided" }, 400);
      const status = isAdmin ? "approved" : "pending";
      const now = new Date().toISOString();
      const rows = days.map((d: { date: string; kind: string; fraction?: number }) => ({
        account_id: accountId, leave_date: d.date,
        kind: d.kind === "unavailable" ? "unavailable" : "holiday",
        fraction: d.fraction && d.fraction > 0 && d.fraction <= 1 ? d.fraction : 1,
        status, note: body?.note ?? null, requested_by: caller.id,
        reviewed_by: isAdmin ? caller.id : null, reviewed_at: isAdmin ? now : null, updated_at: now,
      }));
      const { error } = await sb.from("team_leave_requests").upsert(rows, { onConflict: "account_id,leave_date,kind" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, status, count: rows.length });
    }

    if (action === "review") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const requestId = body?.request_id as string;
      const decision = body?.decision === "approved" ? "approved" : body?.decision === "declined" ? "declined" : null;
      if (!requestId || !decision) return json({ error: "request_id and decision required" }, 400);
      const { error } = await sb.from("team_leave_requests")
        .update({ status: decision, reviewed_by: caller.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "cancel") {
      const requestId = body?.request_id as string;
      if (!requestId) return json({ error: "request_id required" }, 400);
      const { data: row } = await sb.from("team_leave_requests").select("account_id, status").eq("id", requestId).maybeSingle();
      if (!row) return json({ error: "Not found" }, 404);
      if (!isAdmin) {
        // Team member may only cancel their own still-pending request.
        const { data: mem } = await sb.from("account_members").select("account_id").eq("user_id", caller.id).eq("account_id", row.account_id).maybeSingle();
        if (!mem || row.status !== "pending") return json({ error: "Forbidden" }, 403);
      }
      const { error } = await sb.from("team_leave_requests").delete().eq("id", requestId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "set-allowance") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const accountId = body?.account_id as string;
      const allowance = Number(body?.allowance);
      if (!accountId || !Number.isFinite(allowance) || allowance < 0) return json({ error: "account_id and allowance required" }, 400);
      const { error } = await sb.from("accounts").update({ annual_leave_allowance: allowance }).eq("id", accountId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, allowance });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
