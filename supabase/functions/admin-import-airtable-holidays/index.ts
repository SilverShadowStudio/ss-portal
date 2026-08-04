// admin-import-airtable-holidays
//
// One-off migration: Airtable "Team Holiday Tracker" → Supabase team_leave_requests.
// Airtable stores RANGES (Start Date → End Date); the portal stores one row PER DAY,
// so each range is expanded. Weekends are skipped (they aren't leave).
//
// Airtable is READ ONLY here — nothing is ever written back.
//
// Body: { dry_run?: boolean }   — defaults TRUE. Nothing is written unless
//                                 dry_run is explicitly false.
// Auth: admin JWT.
//
// Idempotent: skips any (account, date) that already exists in team_leave_requests,
// so re-running imports only what's missing.
//
// Deploy: npx supabase functions deploy admin-import-airtable-holidays \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const HOLIDAY_TABLE = "tblDJjhosve79HISi"; // Team Holiday Tracker
const USERS_TABLE = "tbl8V5Hd20UN9Jax6";   // Users

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const dayOf = (v: string) => (v ?? "").slice(0, 10); // dateTime → date; the times in Airtable are noise

/** Every calendar day from start to end inclusive, weekends excluded. */
function expandRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = new Date(`${endIso}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // Sun/Sat
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function atAll(pat: string, baseId: string, table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = "";
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${table}?pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!r.ok) throw new Error(`Airtable ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    rows.push(...(j.records ?? []));
    offset = j.offset ?? "";
  } while (offset);
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const pat = Deno.env.get("AIRTABLE_PAT");
  const baseId = Deno.env.get("AIRTABLE_BASE_ID");
  if (!pat || !baseId) return json({ error: "Airtable not configured" }, 500);

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run !== false; // default TRUE — never writes unless told to

  // ── Airtable: users (for the record-link → person mapping) + holiday rows ────
  const [atUsers, atRows] = await Promise.all([
    atAll(pat, baseId, USERS_TABLE),
    atAll(pat, baseId, HOLIDAY_TABLE),
  ]);

  const userById = new Map<string, { name: string; email: string }>();
  for (const u of atUsers as { id: string; fields: Record<string, unknown> }[]) {
    const f = u.fields ?? {};
    userById.set(u.id, {
      name: String(f["Full Name"] ?? f["Name"] ?? "").trim(),
      email: String(f["Email"] ?? "").trim().toLowerCase(),
    });
  }

  // ── Portal team accounts, keyed by email and by normalised name ─────────────
  const { data: accounts } = await admin.from("accounts").select("id, company_name").eq("account_type", "team");
  const { data: members } = await admin.from("account_members").select("account_id, user_id");
  const { data: profiles } = await admin.from("freelancer_profiles").select("user_id, email");
  const emailByUser = new Map((profiles ?? []).map((p: { user_id: string; email: string | null }) => [p.user_id, (p.email ?? "").toLowerCase()]));
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const a of (accounts ?? []) as { id: string; company_name: string }[]) {
    byName.set(norm(a.company_name), a.id);
    for (const m of (members ?? []) as { account_id: string; user_id: string }[]) {
      if (m.account_id !== a.id) continue;
      const em = emailByUser.get(m.user_id);
      if (em) byEmail.set(em, a.id);
    }
  }

  // ── Existing portal leave, to dedupe against ────────────────────────────────
  const { data: existing } = await admin.from("team_leave_requests").select("account_id, leave_date");
  const seen = new Set((existing ?? []).map((r: { account_id: string; leave_date: string }) => `${r.account_id}|${r.leave_date}`));

  // ── Build the plan ─────────────────────────────────────────────────────────
  const toInsert: { account_id: string; leave_date: string; kind: string; fraction: number; status: string; note: string }[] = [];
  const perPerson: Record<string, { matched: boolean; ranges: number; days: number; new_days: number; already: number }> = {};
  const unmatched: { airtable_user: string; email: string; ranges: number; days: number }[] = [];
  const skipped: string[] = [];

  for (const rec of atRows as { id: string; fields: Record<string, unknown> }[]) {
    const f = rec.fields ?? {};
    const link = (f["User"] as string[] | undefined) ?? [];
    const person = link.length ? userById.get(link[0]) : undefined;
    const label = person?.name || String(f["Name"] ?? "(unknown)");
    const start = dayOf(String(f["Start Date"] ?? ""));
    const end = dayOf(String(f["End Date"] ?? start));
    if (!start) { skipped.push(`${label}: no start date`); continue; }

    const days = expandRange(start, end || start);
    if (!days.length) { skipped.push(`${label}: ${start}→${end} produced no weekdays`); continue; }

    const accountId = (person?.email && byEmail.get(person.email)) || byName.get(norm(label)) || null;
    if (!accountId) {
      const u = unmatched.find((x) => x.airtable_user === label);
      if (u) { u.ranges++; u.days += days.length; }
      else unmatched.push({ airtable_user: label, email: person?.email ?? "", ranges: 1, days: days.length });
      continue;
    }

    const p = perPerson[label] ?? (perPerson[label] = { matched: true, ranges: 0, days: 0, new_days: 0, already: 0 });
    p.ranges++; p.days += days.length;
    for (const d of days) {
      const key = `${accountId}|${d}`;
      if (seen.has(key)) { p.already++; continue; }
      seen.add(key);
      p.new_days++;
      toInsert.push({
        account_id: accountId, leave_date: d, kind: "holiday", fraction: 1,
        status: "approved", note: `Imported from Airtable ${start}→${end}`,
      });
    }
  }

  const summary = {
    dry_run: dryRun,
    airtable_rows: atRows.length,
    would_insert: toInsert.length,
    per_person: perPerson,
    unmatched_people: unmatched,
    skipped,
    sample: toInsert.slice(0, 15),
  };

  if (dryRun) return json({ success: true, ...summary, note: "DRY RUN — nothing written. Re-run with { dry_run: false } to commit." });

  if (toInsert.length) {
    const { error } = await admin.from("team_leave_requests").insert(toInsert);
    if (error) return json({ error: `Insert failed: ${error.message}`, ...summary }, 200);
  }
  return json({ success: true, ...summary, inserted: toInsert.length });
});
