// freelancer-self-bill-run/index.ts
//
// Generates self-billed invoices for freelancers for a given month, files each
// to Dropbox, and records it in public.self_bill_invoices. Per Fred: files to
// Dropbox only — it does NOT email freelancers (emailing is a separate, opt-in
// step once a real run has been reviewed).
//
// Line items are pulled live from Airtable:
//   modeller_invoices     → Models              (per model:  hours × rate)
//   scene_manager_invoice → Scene Manager Day Logs (per day:  days × rate)
//   photographer_invoice  → Photographer Timesheet (per session: hours × rate)
//
// Auth: admin JWT, OR shared cron secret via X-Cron-Secret (like payables-sync).
// Input JSON: { period_year?, period_month?, dry_run?: boolean }.
//   Default period = the previous calendar month. dry_run (default false when
//   called explicitly) generates PDFs and reports, without filing or recording.
//
// Deploy: npx supabase functions deploy freelancer-self-bill-run \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateSelfBillPdf, roleLabel, type SelfBillLine } from "../_shared/documents/selfBillPdf.ts";

const DROPBOX_ROOT = "/03_Portal_Admin_Docs/03_Invoices/INV002_Payable/01_Freelancers";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
function json(d: Record<string, unknown>, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// ── Airtable line-item mapping (field IDs from the base schema) ───────────────
interface LineMap { desc: string; project?: string; date?: string; qty: string; unit: string; rate: string; amount: string; }
interface SourceCfg { invoiceTable: string; lineLink: string; lineTable: string; map: LineMap; }
const SOURCES: Record<string, SourceCfg> = {
  modeller_invoices: {
    invoiceTable: "tbl6WfMgznJYgevRt", lineLink: "fldyx5HEpDWR1aJp9", lineTable: "tbls6j4jyNifFyucU",
    map: { desc: "fldfLuaosgg5GXQp0", project: "fldyb332F1q8HUrR7", qty: "fld13WMfDTokxMVsU", unit: "hrs", rate: "flddqPhtjYv0kN0tF", amount: "fldbCLIMAdyXTM1oF" },
  },
  scene_manager_invoice: {
    invoiceTable: "tblhYCC3InxUJUK3H", lineLink: "fldsmMtc29qeZGdWx", lineTable: "tblCOVVdOsjRt06iO",
    map: { desc: "fldCXuxsXzomGNuU4", date: "fldQTfPwfe0E4oNcF", qty: "fldaIEHxMv3eF8wQJ", unit: "days", rate: "fldBjguZNxzCCnySe", amount: "fldm2UMPMfvgGRYTf" },
  },
  photographer_invoice: {
    invoiceTable: "tblCoQXYZuUCh0Vgc", lineLink: "fldjSsRGpHvlXdyPf", lineTable: "tblsqmojQaxNM27GG",
    map: { desc: "fldoyw861KQuk6SwU", date: "fldGvGiChWeAnqOAx", qty: "fld0k5aDOdhaYaxeB", unit: "hrs", rate: "fldrVHX5PfNyVpzg6", amount: "fldcElfVOXJcZTZh7" },
  },
};

// ── Airtable helpers ──────────────────────────────────────────────────────────
function unwrap(v: unknown): unknown { return Array.isArray(v) ? v[0] : v; }
function num(v: unknown): number | null {
  const u = unwrap(v);
  if (u == null) return null;
  if (typeof u === "object") return null; // {specialValue:"NaN"} etc.
  const n = typeof u === "number" ? u : parseFloat(String(u).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string { const u = unwrap(v); return u == null || typeof u === "object" ? "" : String(u); }

async function atFetch(pat: string, url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function fetchLineItems(pat: string, base: string, source: string, invoiceRecId: string): Promise<SelfBillLine[]> {
  const cfg = SOURCES[source];
  const rec = await atFetch(pat, `https://api.airtable.com/v0/${base}/${cfg.invoiceTable}/${invoiceRecId}?returnFieldsByFieldId=true`);
  const linked = ((rec.fields as Record<string, unknown>)[cfg.lineLink] as string[] | undefined) ?? [];
  if (!linked.length) return [];
  const lines: SelfBillLine[] = [];
  for (let i = 0; i < linked.length; i += 40) {
    const chunk = linked.slice(i, i + 40);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const url = `https://api.airtable.com/v0/${base}/${cfg.lineTable}?returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`;
    const res = await atFetch(pat, url);
    for (const r of (res.records as { fields: Record<string, unknown> }[]) ?? []) {
      const fl = r.fields; const m = cfg.map;
      const qty = num(fl[m.qty]); const rate = num(fl[m.rate]);
      let amount = num(fl[m.amount]);
      if (amount == null && qty != null && rate != null) amount = Math.round(qty * rate * 100) / 100;
      const description = (m.date ? `${str(fl[m.date])} — ${str(fl[m.desc])}` : str(fl[m.desc])) || "Work item";
      lines.push({ description, qty, unit: m.unit, rate, amount: amount ?? 0 });
    }
  }
  return lines;
}

// ── Dropbox (mirror dropbox-save-invoice-file) ───────────────────────────────
async function refreshToken(conn: Record<string, string>, sb: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${Deno.env.get("DROPBOX_APP_KEY")}:${Deno.env.get("DROPBOX_APP_SECRET")}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await sb.from("dropbox_connections").update({ access_token: data.access_token, token_expires_at: expiresAt }).eq("id", conn.id);
    return data.access_token;
  } catch { return null; }
}
async function rootNamespace(token: string): Promise<string | null> {
  const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; return (await r.json())?.root_info?.root_namespace_id ?? null;
}
async function dropboxUpload(token: string, ns: string | null, path: string, bytes: Uint8Array): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true, mute: true }),
      ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
    },
    body: bytes,
  });
  if (!r.ok) return { ok: false, error: `dropbox ${r.status}: ${await r.text()}` };
  return { ok: true, path: (await r.json()).path_display ?? path };
}
function sanitize(s: string): string { return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[/\\:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "supplier"; }

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth: shared cron secret (pg_cron) OR admin JWT. Mirrors payables-sync.
  const cronSecret = Deno.env.get("PAYABLES_CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const isCron = cronSecret.length > 0 && provided.length === cronSecret.length && provided === cronSecret;
  if (!isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await uc.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = Number(body.period_year) || prev.getUTCFullYear();
  const month = Number(body.period_month) || (prev.getUTCMonth() + 1); // 1-12
  const doDry = body.dry_run === true;

  const pat = Deno.env.get("AIRTABLE_PAT");
  const base = Deno.env.get("AIRTABLE_BASE_ID");
  if (!pat || !base) return json({ error: "AIRTABLE_PAT / AIRTABLE_BASE_ID not set" }, 500);

  // Existing self-bills this period (idempotency + numbering).
  const { data: existing } = await sb.from("self_bill_invoices")
    .select("source_table, payee_email, invoice_number").eq("period_year", year).eq("period_month", month);
  const already = new Set((existing ?? []).map((e) => `${e.source_table}|${(e.payee_email || "").toLowerCase()}`));
  let seq = (existing ?? []).length;

  // Dropbox connection (only needed for a real run).
  let dbxToken: string | null = null, dbxNs: string | null = null;
  if (!doDry) {
    const { data: conn } = await sb.from("dropbox_connections").select("id, access_token, refresh_token, token_expires_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn) return json({ error: "no dropbox_connections row" }, 500);
    dbxToken = conn.access_token as string;
    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) dbxToken = await refreshToken(conn as Record<string, string>, sb);
    if (!dbxToken) return json({ error: "dropbox token refresh failed" }, 500);
    dbxNs = await rootNamespace(dbxToken);
  }

  const generated: Record<string, unknown>[] = [];
  const skipped: Record<string, unknown>[] = [];
  const folder = `${DROPBOX_ROOT}/Freelancers_${year}-${String(month).padStart(2, "0")}_${MONTHS[month - 1]}`;

  for (const source of Object.keys(SOURCES)) {
    const { data: rows } = await sb.from("payables_snapshot")
      .select("airtable_record_id, payee_name, payee_email, invoice_total, vat_registered")
      .eq("source_table", source).eq("period_year", year).eq("period_month", month);
    for (const row of rows ?? []) {
      const email = (row.payee_email || "").toLowerCase();
      const name = row.payee_name || email || "unknown";
      if (Number(row.invoice_total) <= 0) { skipped.push({ source, name, reason: "zero total" }); continue; }
      if (already.has(`${source}|${email}`)) { skipped.push({ source, name, reason: "already billed" }); continue; }

      // Match freelancer profile (needs country for VAT + bank for payment).
      const { data: prof } = await sb.from("freelancer_profiles")
        .select("user_id, first_name, last_name, email, country, address, flat_number, house_number, street_name, city, postcode, bank_name, account_number, sort_code, account_holder, rate_currency")
        .ilike("email", email).maybeSingle();
      if (!prof) { skipped.push({ source, name, reason: `no freelancer profile for ${email}` }); continue; }
      if (!prof.country) { skipped.push({ source, name, reason: "profile missing country (VAT undecidable)" }); continue; }

      // Line items from Airtable (fallback to a summary line).
      let lines: SelfBillLine[] = [];
      try { lines = await fetchLineItems(pat, base, source, row.airtable_record_id as string); }
      catch (e) { skipped.push({ source, name, reason: `airtable: ${e instanceof Error ? e.message : e}` }); continue; }

      const street = [prof.flat_number, prof.house_number, prof.street_name].filter(Boolean).join(" ");
      const cityLine = [prof.postcode, prof.city].filter(Boolean).join(" ");
      const addressLines = [street, cityLine].filter(Boolean);
      if (!addressLines.length && prof.address) addressLines.push(...String(prof.address).split("\n").filter(Boolean));

      seq += 1;
      const invoiceNumber = `SB-${year}-${String(month).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;
      const input = {
        invoice_number: invoiceNumber,
        issued_at: new Date(Date.UTC(year, month, 1)).toISOString(), // 1st of the following month
        period_year: year, period_month: month, role_label: roleLabel(source),
        currency: prof.rate_currency || "GBP",
        amount: Number(row.invoice_total),
        line_items: lines,
        freelancer: {
          first_name: prof.first_name || name.split(/[-\s]/)[0] || "",
          last_name: prof.last_name || name.split(/[-\s]/).slice(1).join(" ") || "",
          address_lines: addressLines, country: prof.country,
          vat_registered: !!row.vat_registered, vat_number: null,
          bank_name: prof.bank_name, account_holder: prof.account_holder, sort_code: prof.sort_code, account_number: prof.account_number,
        },
      };
      const net = lines.reduce((s, l) => s + (l.amount || 0), 0) || Number(row.invoice_total);
      const vat = (/\b(uk|united kingdom|gb|england|scotland|wales)\b/i.test(prof.country) && row.vat_registered) ? Math.round(net * 0.2 * 100) / 100 : 0;

      let pdf: Uint8Array;
      try { pdf = generateSelfBillPdf(input); } catch (e) { skipped.push({ source, name, reason: `pdf: ${e instanceof Error ? e.message : e}` }); continue; }

      const filename = `Freelancer_Invoice_${sanitize(`${input.freelancer.first_name}-${input.freelancer.last_name}`)}_${year}-${String(month).padStart(2, "0")}.pdf`;
      const record = { source, name, email, invoiceNumber, lines: lines.length, net, vat, gross: net + vat, filename };

      if (doDry) {
        const dbg = body.return_pdf === true ? { pdf_base64: btoa(String.fromCharCode(...pdf)) } : {};
        generated.push({ ...record, dryRun: true, ...dbg });
        continue;
      }

      const up = await dropboxUpload(dbxToken!, dbxNs, `${folder}/${filename}`, pdf);
      if (!up.ok) { skipped.push({ source, name, reason: up.error }); continue; }
      await sb.from("self_bill_invoices").insert({
        source_table: source, airtable_record_id: row.airtable_record_id, payee_email: email, payee_name: name,
        freelancer_user_id: prof.user_id, period_year: year, period_month: month, invoice_number: invoiceNumber,
        role_label: roleLabel(source), net, vat_amount: vat, gross: net + vat, currency: input.currency,
        line_count: lines.length, dropbox_path: up.path,
      });
      generated.push({ ...record, dropbox_path: up.path });
    }
  }

  return json({ period: `${MONTHS[month - 1]} ${year}`, dryRun: doDry, generated_count: generated.length, skipped_count: skipped.length, generated, skipped });
});
