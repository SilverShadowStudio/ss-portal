// freelancer-self-bill-run/index.ts
//
// Generates self-billed invoices for freelancers for a given month, files each
// to Dropbox, records it in public.self_bill_invoices, emails each freelancer
// their self-bill (unless body.email === false or a dry run), and emails the
// studio admin a run summary. dry_run generates + reports only (no side effects).
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
import { constantTimeEqual } from "../_shared/cronAuth.ts";

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
// SelfBillLine plus a transient key used only to order the days before render.
type DatedLine = SelfBillLine & { sortKey?: string };
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

async function fetchLineItems(pat: string, base: string, source: string, invoiceRecId: string): Promise<DatedLine[]> {
  const cfg = SOURCES[source];
  const rec = await atFetch(pat, `https://api.airtable.com/v0/${base}/${cfg.invoiceTable}/${invoiceRecId}?returnFieldsByFieldId=true`);
  const linked = ((rec.fields as Record<string, unknown>)[cfg.lineLink] as string[] | undefined) ?? [];
  if (!linked.length) return [];
  const lines: DatedLine[] = [];
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
      // Date and project are separate columns on the invoice — the date spelled
      // out in full ("13 July 2026"), the project aligned in its own column.
      const rawDate = m.date ? str(fl[m.date]).slice(0, 10) : "";
      const project = str(fl[m.desc]);
      const description = rawDate ? longDate(rawDate) : (project || "Work item");
      lines.push({
        description,
        project: rawDate ? (project || null) : null, // no date → the project IS the description
        sortKey: rawDate,
        qty, unit: m.unit, rate, amount: amount ?? 0,
      });
    }
  }
  // Earliest day at the top, latest at the bottom.
  lines.sort((a, b) => String(a.sortKey ?? "").localeCompare(String(b.sortKey ?? "")));
  return lines;
}

/** "2026-07-13" → "13 July 2026". Falls back to the raw value if unparseable. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
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

// ── Email (Resend) ────────────────────────────────────────────────────────────
const FROM_ADDRESS = "Silver Shadow Studio <portal@silvershadowstudio.com>";
const ADMIN_EMAIL = "fred@silvershadowstudio.com";

function toBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
async function sendEmail(to: string, subject: string, html: string, attachment?: { filename: string; content: string }): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const payload: Record<string, unknown> = { from: FROM_ADDRESS, to: [to], subject, html };
  if (attachment) payload.attachments = [attachment];
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.ok ? { ok: true } : { ok: false, error: `resend ${r.status}: ${await r.text()}` };
}
function freelancerEmailHtml(firstName: string, periodLabel: string, invoiceNumber: string): string {
  return `<div style="font-family:Georgia,serif;color:#1b1916;max-width:520px;margin:0 auto;padding:24px;background:#EDE8E0">
    <p style="font-size:15px">Hi ${firstName || "there"},</p>
    <p style="font-size:14px;line-height:1.6">Please find attached your self-billed invoice for <strong>${periodLabel}</strong> (ref ${invoiceNumber}), raised by Silvershadow Studio Limited on your behalf under our self-billing agreement.</p>
    <p style="font-size:14px;line-height:1.6">You do not need to raise your own invoice for this work — payment will be made to the bank details on your profile. If anything looks incorrect, just reply to this email.</p>
    <p style="font-size:14px;line-height:1.6">Thank you for your work this month.</p>
    <p style="font-size:13px;color:#766f65;margin-top:24px">Silvershadow Studio Limited · silvershadowstudio.com</p>
  </div>`;
}
function summaryEmailHtml(periodLabel: string, generated: Record<string, unknown>[], skipped: Record<string, unknown>[]): string {
  const money = (n: unknown) => `£${(Number(n) || 0).toFixed(2)}`;
  const gRows = generated.length
    ? generated.map((g) => `<tr><td style="padding:4px 12px 4px 0">${g.name}</td><td style="padding:4px 12px 4px 0">${g.invoiceNumber}${g.emailed ? " ✉" : ""}</td><td style="padding:4px 0;text-align:right">${money(g.gross)}</td></tr>`).join("")
    : `<tr><td style="padding:4px 0;color:#766f65">None</td></tr>`;
  const sRows = skipped.length
    ? skipped.map((s) => `<tr><td style="padding:4px 12px 4px 0">${s.name}</td><td style="padding:4px 0;color:#766f65">${s.reason}</td></tr>`).join("")
    : `<tr><td style="padding:4px 0;color:#766f65">None</td></tr>`;
  return `<div style="font-family:Georgia,serif;color:#1b1916;max-width:560px;margin:0 auto;padding:24px;background:#EDE8E0">
    <p style="font-size:15px"><strong>Self-bill run — ${periodLabel}</strong></p>
    <p style="font-size:13px;color:#766f65">${generated.length} billed &amp; filed · ${skipped.length} skipped</p>
    <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#766f65;margin-top:20px">Billed (✉ = emailed)</p>
    <table style="font-size:13px;border-collapse:collapse;width:100%">${gRows}</table>
    <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#766f65;margin-top:20px">Skipped</p>
    <table style="font-size:13px;border-collapse:collapse;width:100%">${sRows}</table>
    <p style="font-size:12px;color:#766f65;margin-top:24px">Skips are usually freelancers without a completed portal profile (no address/bank/country to bill against). They are picked up automatically once onboarded.</p>
  </div>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth: shared cron secret (pg_cron) OR admin JWT. Mirrors payables-sync.
  const cronSecret = Deno.env.get("PAYABLES_CRON_SECRET") ?? "";
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

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = Number(body.period_year) || prev.getUTCFullYear();
  const month = Number(body.period_month) || (prev.getUTCMonth() + 1); // 1-12
  const doDry = body.dry_run === true;
  // Real runs email each freelancer their self-bill unless explicitly disabled.
  const doEmail = !doDry && body.email !== false;
  let emailed = 0;

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
      // `ignore_existing` is dry-run only: it lets an already-issued month be
      // re-rendered for preview. A real run always respects the skip, so an
      // invoice can never be issued twice.
      if (already.has(`${source}|${email}`) && !(doDry && body.ignore_existing === true)) {
        skipped.push({ source, name, reason: "already billed" }); continue;
      }

      // Match freelancer profile (needs country for VAT + bank for payment).
      const { data: prof } = await sb.from("freelancer_profiles")
        .select("user_id, first_name, last_name, email, country, address, flat_number, house_number, street_name, city, postcode, bank_name, account_number, sort_code, account_holder, rate_currency")
        .ilike("email", email).maybeSingle();
      if (!prof) { skipped.push({ source, name, reason: `no freelancer profile for ${email}` }); continue; }
      if (!prof.country) { skipped.push({ source, name, reason: "profile missing country (VAT undecidable)" }); continue; }

      // Line items from Airtable (fallback to a summary line).
      let lines: DatedLine[] = [];
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

      // Date first, then the person: sorts chronologically wherever it lands —
      // Dropbox, Finder, an accountant's flat batch, or an email attachment
      // where there's no folder context at all.
      //   Freelancer_Invoice_2026-07_Maycon-Santos.pdf
      const filename = `Freelancer_Invoice_${year}-${String(month).padStart(2, "0")}_${sanitize(`${input.freelancer.first_name}-${input.freelancer.last_name}`)}.pdf`;
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

      // Email the freelancer their self-bill (filing already succeeded above).
      let didEmail = false, emailError: string | undefined;
      const to = prof.email || email;
      if (doEmail && to) {
        const res = await sendEmail(
          to, `Your self-billed invoice — ${MONTHS[month - 1]} ${year}`,
          freelancerEmailHtml(input.freelancer.first_name, `${MONTHS[month - 1]} ${year}`, invoiceNumber),
          { filename, content: toBase64(pdf) },
        );
        if (res.ok) {
          didEmail = true; emailed += 1;
          await sb.from("self_bill_invoices").update({ emailed_at: new Date().toISOString() })
            .eq("source_table", source).eq("payee_email", email).eq("period_year", year).eq("period_month", month);
        } else emailError = res.error;
      }
      generated.push({ ...record, dropbox_path: up.path, emailed: didEmail, ...(emailError ? { emailError } : {}) });
    }
  }

  // Summary to the studio admin on every real run (even if nothing was billed).
  if (!doDry) {
    const periodLabel = `${MONTHS[month - 1]} ${year}`;
    await sendEmail(ADMIN_EMAIL, `Self-bill run — ${periodLabel}: ${generated.length} billed, ${skipped.length} skipped`, summaryEmailHtml(periodLabel, generated, skipped))
      .catch(() => {});
  }

  return json({ period: `${MONTHS[month - 1]} ${year}`, dryRun: doDry, generated_count: generated.length, emailed_count: emailed, skipped_count: skipped.length, generated, skipped });
});
