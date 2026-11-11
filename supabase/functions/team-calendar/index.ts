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
//   Hourly work (members with a team_hours_settings row — Isabella, Nov 2026):
//   hours-get     → this week, this month and pending entries, plus the weekly
//                   hours and rate. Retries any Airtable write still owed.
//   hours-log     → log date/hours/note. Up to the weekly hours: approved and
//                   written to Airtable. Beyond: pending, admins emailed.
//                   An admin logging for someone is always approved.
//   hours-review  → admin approves (→ Airtable) or declines a pending entry.
//   hours-cancel  → member removes her own pending entry; admin any entry
//                   (its Airtable record is removed with it).
//   hours-settings→ admin sets weekly hours and hourly rate (creates the row,
//                   which is what gives a member her Hours page).
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
interface LineMap { date: string; qty: string; unit: string; desc?: string; }
const DAY_SOURCES: Record<string, { invoiceTable: string; lineLink: string; lineTable: string; role: string; map: LineMap }> = {
  scene_manager_invoice: {
    invoiceTable: "tblhYCC3InxUJUK3H", lineLink: "fldsmMtc29qeZGdWx", lineTable: "tblCOVVdOsjRt06iO",
    role: "Scene management",
    map: { date: "fldQTfPwfe0E4oNcF", qty: "fldaIEHxMv3eF8wQJ", unit: "days", desc: "fldCXuxsXzomGNuU4" },
  },
  photographer_invoice: {
    invoiceTable: "tblCoQXYZuUCh0Vgc", lineLink: "fldjSsRGpHvlXdyPf", lineTable: "tblsqmojQaxNM27GG",
    role: "Photography",
    map: { date: "fldGvGiChWeAnqOAx", qty: "fld0k5aDOdhaYaxeB", unit: "hrs", desc: "fldoyw861KQuk6SwU" },
  },
};

/** One logged piece of work on a day — powers the calendar hover detail. */
interface WorkEntry { role: string; project: string; qty: number | null; unit: string; }

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
): Promise<Record<string, { fraction: number; entries: WorkEntry[] }>> {
  const worked: Record<string, { fraction: number; entries: WorkEntry[] }> = {};
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
        const slot = worked[date] ?? (worked[date] = { fraction: 0, entries: [] });
        slot.fraction += frac;
        slot.entries.push({
          role: cfg.role,
          project: cfg.map.desc ? str(r.fields[cfg.map.desc]) : "",
          qty, unit: cfg.map.unit,
        });
      }
    }
  }
  return worked;
}

// ── Hourly work → Airtable ──────────────────────────────────────────────────
// Written by NAME, not id: the Business Development tables are duplicates of
// the Photographer pair made in Airtable's own UI, so their ids aren't known
// here ahead of time, and names keep this working if they're ever re-made.
const HOURS_TABLE = "Business Development Timesheet";

/** Monday–Sunday around a date, as ISO dates (UTC calendar days). */
function weekOf(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Write one approved entry to Airtable; records the record id or the error. */
// deno-lint-ignore no-explicit-any
async function pushHours(sb: any, entry: Record<string, unknown>): Promise<void> {
  const pat = Deno.env.get("AIRTABLE_PAT"); const baseId = Deno.env.get("AIRTABLE_BASE_ID");
  if (!pat || !baseId || entry.status !== "approved" || entry.airtable_record_id) return;
  try {
    const { data: au } = await sb.auth.admin.getUserById(entry.user_id as string);
    const email = (au?.user?.email ?? "").toLowerCase();
    if (!email) throw new Error("no email for this member");
    const users = await atFetch(pat, `https://api.airtable.com/v0/${baseId}/Users?maxRecords=1&filterByFormula=${encodeURIComponent(`LOWER({Email})='${email.replace(/'/g, "\\'")}'`)}`);
    const userRec = ((users.records as { id: string }[]) ?? [])[0]?.id;
    if (!userRec) throw new Error(`${email} isn't in Airtable's Users table yet`);
    const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(HOURS_TABLE)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields: { "Link to Users": [userRec], "Date": entry.work_date, "Work Time (Hrs)": Number(entry.hours) } }] }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (body as { error?: { type?: string; message?: string } }).error;
      throw new Error(r.status === 404 ? `the "${HOURS_TABLE}" table doesn't exist in Airtable yet` : `Airtable ${r.status}: ${msg?.message ?? msg?.type ?? ""}`);
    }
    const id = ((body as { records?: { id: string }[] }).records ?? [])[0]?.id ?? null;
    await sb.from("team_hours").update({ airtable_record_id: id, airtable_error: null, updated_at: new Date().toISOString() }).eq("id", entry.id);
  } catch (e) {
    await sb.from("team_hours").update({ airtable_error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() }).eq("id", entry.id);
  }
}

async function removeFromAirtable(recordId: string | null): Promise<void> {
  const pat = Deno.env.get("AIRTABLE_PAT"); const baseId = Deno.env.get("AIRTABLE_BASE_ID");
  if (!recordId || !pat || !baseId) return;
  await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(HOURS_TABLE)}/${recordId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${pat}` },
  }).catch(() => {});
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
      let workedDays: { date: string; fraction: number; entries: WorkEntry[] }[] = [];
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
          workedDays = Object.entries(worked).map(([date, v]) => ({
            date, fraction: Math.round(v.fraction * 100) / 100, entries: v.entries,
          }));
        }
      }

      // Bank holidays are an EMPLOYEE benefit (paid days the studio is closed).
      // A freelancer either works a day or blocks it out — a UK bank holiday
      // means nothing on their calendar, so they never see them.
      const { data: holidays } = acct.employment_type === "employee"
        ? await sb.from("bank_holidays")
            .select("holiday_date, name").eq("division", "england-and-wales").gte("holiday_date", from).lte("holiday_date", to)
        : { data: [] as { holiday_date: string; name: string }[] };

      const { data: leave } = await sb.from("team_leave_requests")
        .select("id, leave_date, kind, fraction, status, note").eq("account_id", accountId).gte("leave_date", from).lte("leave_date", to);

      // Allowance countdown: approved holiday fractions in the calendar year.
      const { data: yearLeave } = await sb.from("team_leave_requests")
        .select("fraction").eq("account_id", accountId).eq("kind", "holiday").eq("status", "approved")
        .gte("leave_date", `${year}-01-01`).lte("leave_date", `${year}-12-31`);
      const taken = (yearLeave ?? []).reduce((s, r) => s + Number(r.fraction || 0), 0);
      // Per-year allowance override, falling back to the account default.
      const { data: yearAllow } = await sb.from("team_leave_allowances")
        .select("allowance").eq("account_id", accountId).eq("year", year).maybeSingle();
      const allowance = yearAllow ? Number(yearAllow.allowance) : Number(acct.annual_leave_allowance ?? 20);

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

      // A freelancer marking themselves unavailable is a COURTESY, not a request:
      // they're telling us not to count on them, and that needs no approval. It
      // lands approved straight away. Employee paid holiday still needs a review.
      const { data: reqAcct } = await sb.from("accounts").select("employment_type").eq("id", accountId).maybeSingle();
      const isFreelancer = reqAcct?.employment_type !== "employee";
      const now = new Date().toISOString();
      const rows = days.map((d: { date: string; kind: string; fraction?: number }) => {
        const kind = d.kind === "unavailable" ? "unavailable" : "holiday";
        const auto = isAdmin || (isFreelancer && kind === "unavailable");
        return {
          account_id: accountId, leave_date: d.date, kind,
          fraction: 1, // full days only — half days were dropped for everyone
          status: auto ? "approved" : "pending",
          note: body?.note ?? null, requested_by: caller.id,
          reviewed_by: auto ? caller.id : null, reviewed_at: auto ? now : null, updated_at: now,
        };
      });
      const { error } = await sb.from("team_leave_requests").upsert(rows, { onConflict: "account_id,leave_date,kind" });
      if (error) return json({ error: error.message }, 500);

      // Tell the admins when something actually needs a decision. Without this a
      // request just sits in the database and nobody knows to look.
      const pendingRows = rows.filter((r) => r.status === "pending");
      if (pendingRows.length) {
        try {
          const { data: acctRow } = await sb.from("accounts").select("company_name").eq("id", accountId).maybeSingle();
          const who = (acctRow?.company_name as string) || "A team member";
          const dates = pendingRows.map((r) => r.leave_date).sort();
          const label = dates.length === 1
            ? new Date(`${dates[0]}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
            : `${dates.length} days · ${dates[0]} → ${dates[dates.length - 1]}`;
          const kindLabel = pendingRows[0].kind === "holiday" ? "paid holiday" : "unavailability";

          // Every admin, resolved live — no hardcoded recipients.
          const { data: adminRoles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
          const to: string[] = [];
          for (const a of (adminRoles ?? []) as { user_id: string }[]) {
            const { data: au } = await sb.auth.admin.getUserById(a.user_id);
            if (au?.user?.email) to.push(au.user.email);
          }
          const resendKey = Deno.env.get("RESEND_API_KEY");
          if (resendKey && to.length) {
            const url = `${Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com"}/admin/team/${accountId}/calendar`;
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
                to,
                subject: `${who} has requested ${kindLabel} — ${label}`,
                html: `<div style="font-family:Georgia,serif;color:#1b1916;max-width:520px;margin:0 auto;padding:24px;background:#EDE8E0">
                  <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8A8070;margin:0 0 18px">Leave request</p>
                  <p style="font-size:15px;margin:0 0 8px"><strong>${who}</strong> has requested ${kindLabel}.</p>
                  <p style="font-size:14px;color:#5b554d;margin:0 0 22px">${label}</p>
                  <p style="margin:0"><a href="${url}" style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814">Review the request</a></p>
                </div>`,
              }),
            });
          }
        } catch { /* never fail the request because the email didn't send */ }
      }

      return json({ ok: true, status: rows[0]?.status ?? "pending", count: rows.length });
    }

    if (action === "review") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const requestId = body?.request_id as string;
      const decision = body?.decision === "approved" ? "approved" : body?.decision === "declined" ? "declined" : null;
      if (!requestId || !decision) return json({ error: "request_id and decision required" }, 400);
      const { error } = await sb.from("team_leave_requests")
        .update({ status: decision, reviewed_by: caller!.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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
      const year = Number(body?.year) || new Date().getUTCFullYear();
      if (!accountId || !Number.isFinite(allowance) || allowance < 0) return json({ error: "account_id and allowance required" }, 400);
      // Year-scoped: only this year's allowance changes.
      const { error } = await sb.from("team_leave_allowances")
        .upsert({ account_id: accountId, year, allowance, updated_at: new Date().toISOString() }, { onConflict: "account_id,year" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, allowance, year });
    }

    // ── Hourly work ───────────────────────────────────────────────────────────
    if (action === "hours-settings") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const accountId = body?.account_id as string;
      if (!accountId) return json({ error: "account_id required" }, 400);
      const patch: Record<string, unknown> = { account_id: accountId, updated_by: caller!.id, updated_at: new Date().toISOString() };
      if (body?.weekly_hours != null) {
        const w = Number(body.weekly_hours);
        if (!Number.isFinite(w) || w < 0 || w > 80) return json({ error: "weekly_hours must be 0–80" }, 400);
        patch.weekly_hours = w;
      }
      if (body?.hourly_rate !== undefined) {
        const r = body.hourly_rate === null ? null : Number(body.hourly_rate);
        if (r !== null && (!Number.isFinite(r) || r < 0)) return json({ error: "hourly_rate must be a positive number" }, 400);
        patch.hourly_rate = r;
      }
      const { data, error } = await sb.from("team_hours_settings").upsert(patch, { onConflict: "account_id" }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, settings: data });
    }

    if (action === "hours-get" || action === "hours-log" || action === "hours-review" || action === "hours-cancel") {
      // Review and cancel are addressed by entry; the account follows from it.
      let accountId: string;
      let entryRow: Record<string, unknown> | null = null;
      if (action === "hours-review" || action === "hours-cancel") {
        const { data } = await sb.from("team_hours").select("*").eq("id", body?.entry_id ?? "").maybeSingle();
        if (!data) return json({ error: "Not found" }, 404);
        entryRow = data as Record<string, unknown>;
        const resolved = await resolveAccount(entryRow.account_id as string);
        if (!resolved || resolved.error) return json({ error: "Forbidden" }, 403);
        accountId = resolved.id;
      } else {
        const resolved = await resolveAccount(body?.account_id);
        if (!resolved || resolved.error) return json({ error: resolved?.error ?? "Not found" }, resolved?.error === "Forbidden" ? 403 : 404);
        accountId = resolved.id;
      }
      const { data: settings } = await sb.from("team_hours_settings").select("weekly_hours, hourly_rate").eq("account_id", accountId).maybeSingle();

      if (action === "hours-review") {
        if (!isAdmin) return json({ error: "Forbidden" }, 403);
        const decision = body?.decision === "approved" ? "approved" : body?.decision === "declined" ? "declined" : null;
        if (!decision) return json({ error: "decision required" }, 400);
        if (entryRow!.status !== "pending") return json({ error: "Already reviewed" }, 409);
        const { data: updated, error } = await sb.from("team_hours")
          .update({ status: decision, reviewed_by: caller.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", entryRow!.id).select().single();
        if (error) return json({ error: error.message }, 500);
        if (decision === "approved") await pushHours(sb, updated as Record<string, unknown>);
        return json({ ok: true });
      }

      if (action === "hours-cancel") {
        if (!isAdmin && entryRow!.status !== "pending") return json({ error: "Only an entry still awaiting approval can be removed" }, 403);
        await removeFromAirtable(entryRow!.airtable_record_id as string | null);
        const { error } = await sb.from("team_hours").delete().eq("id", entryRow!.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (!settings) return json({ error: "Hours aren't set up for this member", setup: false }, action === "hours-get" ? 200 : 400);
      const weekly = Number(settings.weekly_hours);

      if (action === "hours-log") {
        const date = String(body?.date ?? "").slice(0, 10);
        const hours = round2(Number(body?.hours));
        const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "A date is required" }, 400);
        if (!(hours > 0 && hours <= 24)) return json({ error: "Hours must be between 0 and 24" }, 400);
        if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return json({ error: "Hours can't be logged ahead of the day" }, 400);
        const { data: members } = await sb.from("account_members").select("user_id").eq("account_id", accountId).limit(1);
        const userId = isAdmin ? ((members ?? [])[0]?.user_id as string ?? caller!.id) : caller!.id;

        // Pending counts against the week too: it isn't room she has yet.
        const wk = weekOf(date);
        const { data: weekRows } = await sb.from("team_hours").select("hours, status")
          .eq("account_id", accountId).gte("work_date", wk.from).lte("work_date", wk.to).neq("status", "declined");
        const used = ((weekRows ?? []) as { hours: number }[]).reduce((t: number, r) => t + Number(r.hours), 0);
        const room = isAdmin ? hours : Math.max(0, round2(weekly - used));
        const within = round2(Math.min(hours, room));
        const over = round2(hours - within);
        const now = new Date().toISOString();
        const base = { account_id: accountId, user_id: userId, work_date: date, note: note || null, updated_at: now };
        const rows: Record<string, unknown>[] = [];
        if (within > 0) rows.push({ ...base, hours: within, status: "approved", reviewed_by: isAdmin ? caller!.id : null, reviewed_at: isAdmin ? now : null });
        if (over > 0) rows.push({ ...base, hours: over, status: "pending" });
        const { data: inserted, error } = await sb.from("team_hours").insert(rows).select();
        if (error) return json({ error: error.message }, 500);
        for (const r of (inserted ?? []) as Record<string, unknown>[]) await pushHours(sb, r);

        if (over > 0) {
          // Same as a holiday request: a decision nobody knows about never gets made.
          try {
            const { data: acctRow } = await sb.from("accounts").select("company_name").eq("id", accountId).maybeSingle();
            const who = (acctRow?.company_name as string) || "A team member";
            const day = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
            const { data: adminRoles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
            const to: string[] = [];
            for (const a of (adminRoles ?? []) as { user_id: string }[]) {
              const { data: au } = await sb.auth.admin.getUserById(a.user_id);
              if (au?.user?.email) to.push(au.user.email);
            }
            const resendKey = Deno.env.get("RESEND_API_KEY");
            if (resendKey && to.length) {
              const url = `${Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com"}/admin/team/${accountId}/calendar`;
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "Silver Shadow Studio <portal@silvershadowstudio.com>", to,
                  subject: `${who} asked for ${over} extra hour${over === 1 ? "" : "s"} — ${day}`,
                  html: `<div style="font-family:Georgia,serif;color:#1b1916;max-width:520px;margin:0 auto;padding:24px;background:#EDE8E0">
                    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8A8070;margin:0 0 18px">Extra hours</p>
                    <p style="font-size:15px;margin:0 0 8px"><strong>${who}</strong> logged ${hours} h on ${day}; ${over} h of it is over her ${weekly} h this week.</p>
                    ${note ? `<p style="font-size:14px;color:#5b554d;margin:0 0 22px">“${note.replace(/</g, "&lt;")}”</p>` : ""}
                    <p style="margin:0"><a href="${url}" style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814">Approve or decline</a></p>
                  </div>`,
                }),
              });
            }
          } catch { /* never fail the log because the email didn't send */ }
        }
        return json({ ok: true, approved: within, pending: over });
      }

      // hours-get: retry Airtable writes still owed, then report.
      const { data: owed } = await sb.from("team_hours").select("*").eq("account_id", accountId)
        .eq("status", "approved").is("airtable_record_id", null).limit(20);
      for (const r of (owed ?? []) as Record<string, unknown>[]) await pushHours(sb, r);

      const today = new Date().toISOString().slice(0, 10);
      const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? "")) ? String(body.month) : today.slice(0, 7);
      const wk = weekOf(today);
      const monthStart = `${month}-01`;
      const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const from = monthStart < wk.from ? monthStart : wk.from;
      const to = monthEnd > wk.to ? monthEnd : wk.to;
      const { data: entries } = await sb.from("team_hours")
        .select("id, work_date, hours, note, status, airtable_record_id, airtable_error, created_at")
        .eq("account_id", accountId).gte("work_date", from).lte("work_date", to)
        .order("work_date", { ascending: false }).order("created_at", { ascending: false });
      const { data: pending } = await sb.from("team_hours")
        .select("id, work_date, hours, note, status, created_at").eq("account_id", accountId).eq("status", "pending").order("work_date");
      const { data: acct } = await sb.from("accounts").select("company_name").eq("id", accountId).maybeSingle();
      return json({
        setup: true, isAdmin, accountName: acct?.company_name ?? null,
        weekly_hours: weekly, hourly_rate: settings.hourly_rate != null ? Number(settings.hourly_rate) : null,
        week: wk, month, entries: entries ?? [], pending: pending ?? [],
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
