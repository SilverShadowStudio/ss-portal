// weekly-finance-summary
//
// One consolidated financial-position email, written in the register of an
// external advisor (Deloitte-style): current position, aged analysis,
// historic tracking, and a forward forecast. Replaces the per-overhead
// send-overhead-reminder blast (which fired ~100 separate emails/day).
//
// Callers:
//   - pg_cron 'finance-summary-weekly' (Mondays 07:00 UTC = 08:00 UK BST),
//     sends the email.
//   - Admin from the portal, or a manual test, with { preview: true } to get
//     the rendered HTML + computed figures back WITHOUT sending.
//
// Recipient + on/off live in app_settings.finance_summary_config.
// All amounts are converted to GBP via the fx_rates cache (ECB reference).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const GBP = "GBP";
const FROM = "Silver Shadow Studio <portal@silvershadowstudio.com>";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── FX: EUR/USD → GBP via the fx_rates cache (nearest rate on/before a date) ──
type FxSeries = { dates: string[]; rates: number[]; latest: number };
type FxData = Record<string, FxSeries>;

// deno-lint-ignore no-explicit-any
async function loadFx(sb: any): Promise<FxData> {
  const { data } = await sb.from("fx_rates").select("base, rate_date, rate")
    .in("base", ["EUR", "USD"]).order("rate_date", { ascending: true });
  const out: FxData = {};
  for (const r of (data ?? []) as { base: string; rate_date: string; rate: number }[]) {
    const s = out[r.base] ?? (out[r.base] = { dates: [], rates: [], latest: 0 });
    s.dates.push(r.rate_date); s.rates.push(Number(r.rate));
  }
  for (const k of Object.keys(out)) out[k].latest = out[k].rates[out[k].rates.length - 1] ?? 1;
  return out;
}

function toGbp(fx: FxData, amount: number, currency: string, dateISO: string | null): number {
  if (!amount) return 0;
  if (currency === GBP) return amount;
  const s = fx[currency];
  if (!s || s.rates.length === 0) return amount; // no rate — pass through, better than dropping
  if (!dateISO) return amount * s.latest;
  let lo = 0, hi = s.dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.dates[m] <= dateISO) { ans = m; lo = m + 1; } else hi = m - 1; }
  return amount * (ans >= 0 ? s.rates[ans] : s.rates[0]);
}

const gbp = (n: number) =>
  "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const gbp2 = (n: number) =>
  "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Row { currency: string; gross_amount: number; vat_amount: number; due_date: string | null; invoice_date: string | null;
  payment_status: string; payment_date: string | null; supplier_name: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrAdmin(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const sb = createClient(supabaseUrl, serviceKey);

  let preview = false;
  try { const b = await req.json(); preview = !!b?.preview; } catch { /* no body */ }

  // Config (recipient + enabled).
  const { data: cfgRow } = await sb.from("app_settings").select("value").eq("key", "finance_summary_config").maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as { enabled?: boolean; recipient?: string };
  const recipient = cfg.recipient || "fred@silvershadowstudio.com";
  if (!preview && cfg.enabled === false) return json({ skipped: "disabled" });

  const fx = await loadFx(sb);
  const nowISO = new Date().toISOString().slice(0, 10);

  // ── Gather ────────────────────────────────────────────────────────────────
  const { data: ovRaw } = await sb.from("overheads")
    .select("currency, gross_amount, vat_amount, due_date, invoice_date, payment_status, payment_date, supplier_name");
  const overheads = (ovRaw ?? []) as Row[];

  const { data: payRaw } = await sb.from("payables_snapshot")
    .select("payee_name, balance_remaining").gt("balance_remaining", 0);
  const freelancerOutstanding = (payRaw ?? []).reduce((s, r: { balance_remaining: number }) => s + Number(r.balance_remaining || 0), 0);

  const { data: invRaw } = await sb.from("invoices")
    .select("amount, currency, status, due_date")
    .not("status", "in", "(paid,void,cancelled,draft)");
  const receivables = (invRaw ?? []).reduce((s, r: { amount: number; currency: string; due_date: string | null }) =>
    s + toGbp(fx, Number(r.amount || 0), r.currency || GBP, r.due_date), 0);

  const { data: taxRaw } = await sb.from("taxes")
    .select("amount, currency, due_date, tax_type").eq("payment_status", "unpaid");
  const taxesDue = (taxRaw ?? []).reduce((s, r: { amount: number; currency: string; due_date: string | null }) =>
    s + toGbp(fx, Number(r.amount || 0), r.currency || GBP, r.due_date), 0);

  const { data: recRaw } = await sb.from("recurring_overheads")
    .select("currency, gross_amount, frequency").eq("active", true);

  // ── Analyse: current payables position (all → GBP) ─────────────────────────
  const unpaid = overheads.filter((o) => o.payment_status === "unpaid");
  const ovGbp = (o: Row) => toGbp(fx, Number(o.gross_amount || 0), o.currency || GBP, o.due_date);
  const overheadsUnpaid = unpaid.reduce((s, o) => s + ovGbp(o), 0);

  const day = 86_400_000;
  const t0 = Date.now();
  const aging = { overdue: 0, due7: 0, due30: 0, later: 0 };
  for (const o of unpaid) {
    const v = ovGbp(o);
    const due = o.due_date ? new Date(o.due_date).getTime() : t0;
    if (due < t0) aging.overdue += v;
    else if (due < t0 + 7 * day) aging.due7 += v;
    else if (due < t0 + 30 * day) aging.due30 += v;
    else aging.later += v;
  }

  const totalOwed = overheadsUnpaid + freelancerOutstanding + taxesDue;
  const netPosition = receivables - totalOwed;

  // Currency exposure of unpaid overheads (GBP-value of each original currency).
  const ccyMap = new Map<string, number>();
  for (const o of unpaid) ccyMap.set(o.currency || GBP, (ccyMap.get(o.currency || GBP) ?? 0) + ovGbp(o));
  const currencyMix = [...ccyMap.entries()].map(([ccy, gbpv]) => ({ ccy, gbpv }))
    .sort((a, b) => b.gbpv - a.gbpv);
  const foreignShare = overheadsUnpaid > 0
    ? (currencyMix.filter((c) => c.ccy !== GBP).reduce((s, c) => s + c.gbpv, 0) / overheadsUnpaid) * 100 : 0;

  // Supplier concentration — top exposures among unpaid overheads.
  const supMap = new Map<string, number>();
  for (const o of unpaid) supMap.set(o.supplier_name || "—", (supMap.get(o.supplier_name || "—") ?? 0) + ovGbp(o));
  const topSuppliers = [...supMap.entries()].map(([name, gbpv]) => ({ name, gbpv }))
    .sort((a, b) => b.gbpv - a.gbpv).slice(0, 5);
  const topSupplierShare = overheadsUnpaid > 0 && topSuppliers.length ? (topSuppliers[0].gbpv / overheadsUnpaid) * 100 : 0;

  // Reclaimable input VAT sitting in unpaid overheads (recovered on settlement).
  const reclaimableVat = unpaid.reduce((s, o) => s + toGbp(fx, Number(o.vat_amount || 0), o.currency || GBP, o.due_date), 0);

  // ── Historic: last 6 months of overhead spend (by invoice month) ───────────
  const byMonth = new Map<string, number>();
  for (const o of overheads) {
    if (!o.invoice_date) continue;
    const m = o.invoice_date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + toGbp(fx, Number(o.gross_amount || 0), o.currency || GBP, o.invoice_date));
  }
  const months: string[] = [];
  { const d = new Date(); for (let i = 5; i >= 0; i--) { const dd = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(dd.toISOString().slice(0, 7)); } }
  const history = months.map((m) => ({ month: m, spend: byMonth.get(m) ?? 0 }));
  const recent3 = history.slice(-3).reduce((s, h) => s + h.spend, 0) / 3;
  const prior3 = history.slice(0, 3).reduce((s, h) => s + h.spend, 0) / 3;
  const trendPct = prior3 > 0 ? ((recent3 - prior3) / prior3) * 100 : 0;

  // ── Forecast: amortised monthly recurring run-rate (→ GBP) ─────────────────
  const perMonth: Record<string, number> = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, weekly: 52 / 12 };
  let runRate = 0;
  for (const r of (recRaw ?? []) as { currency: string; gross_amount: number; frequency: string }[]) {
    const g = toGbp(fx, Number(r.gross_amount || 0), r.currency || GBP, null);
    runRate += g * (perMonth[r.frequency] ?? 1);
  }
  const forecast90 = runRate * 3; // committed recurring outflow over the next quarter

  const html = renderEmail({
    nowISO, totalOwed, overheadsUnpaid, freelancerOutstanding, taxesDue, receivables, netPosition,
    aging, unpaidCount: unpaid.length, history, recent3, prior3, trendPct, runRate, forecast90,
    currencyMix, foreignShare, topSuppliers, topSupplierShare, reclaimableVat,
  });
  const subject = `Financial position — week of ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`;

  if (preview) return json({ preview: true, subject, recipient, figures: {
    totalOwed, overheadsUnpaid, freelancerOutstanding, taxesDue, receivables, netPosition, aging, runRate, forecast90,
    trendPct, foreignShare, topSupplierShare, reclaimableVat, currencyMix, topSuppliers }, html });

  if (!resendKey) return json({ error: "RESEND_API_KEY not set" }, 500);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: recipient, subject, html }),
  });
  if (!resp.ok) return json({ error: `Resend ${resp.status}: ${(await resp.text()).slice(0, 300)}` }, 502);
  return json({ sent: true, recipient, subject });
});

// ── Deloitte-register HTML ────────────────────────────────────────────────────
function renderEmail(d: {
  nowISO: string; totalOwed: number; overheadsUnpaid: number; freelancerOutstanding: number;
  taxesDue: number; receivables: number; netPosition: number;
  aging: { overdue: number; due7: number; due30: number; later: number };
  unpaidCount: number; history: { month: string; spend: number }[];
  recent3: number; prior3: number; trendPct: number; runRate: number; forecast90: number;
  currencyMix: { ccy: string; gbpv: number }[]; foreignShare: number;
  topSuppliers: { name: string; gbpv: number }[]; topSupplierShare: number; reclaimableVat: number;
}): string {
  const trendWord = d.trendPct > 5 ? "rising" : d.trendPct < -5 ? "easing" : "broadly stable";
  const overdueShare = d.overheadsUnpaid > 0 ? (d.aging.overdue / d.overheadsUnpaid) * 100 : 0;
  const monthName = (m: string) => new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const maxSpend = Math.max(1, ...d.history.map((h) => h.spend));

  const commentary: string[] = [];
  commentary.push(`The studio carries <strong>${gbp(d.totalOwed)}</strong> in near-term obligations against ${d.receivables > 0 ? `<strong>${gbp(d.receivables)}</strong> of receivables` : "no invoiced receivables currently outstanding"}, a net working position of <strong>${gbp(d.netPosition)}</strong>.`);
  if (overdueShare > 40) commentary.push(`Attention: <strong>${overdueShare.toFixed(0)}%</strong> of unpaid overheads (${gbp(d.aging.overdue)}) are already past their due date. Clearing the overdue tranche should be the week's first cash-management action.`);
  else if (d.aging.overdue > 0) commentary.push(`${gbp(d.aging.overdue)} of overheads sit past due — manageable, but worth settling before it ages further.`);
  commentary.push(`Overhead spend is <strong>${trendWord}</strong> (${d.trendPct >= 0 ? "+" : ""}${d.trendPct.toFixed(0)}% on the trailing quarter, ${gbp(d.recent3)}/mo vs ${gbp(d.prior3)}/mo).`);
  commentary.push(`Committed recurring outflow runs at approximately <strong>${gbp(d.runRate)}/month</strong> (${gbp(d.forecast90)} over the coming quarter) before any discretionary or project spend.`);

  // Adviser's recommendations — prioritised, data-driven. Only surface what the
  // numbers actually warrant (specialist commentary, not boilerplate).
  const advice: { p: string; text: string }[] = [];
  if (d.aging.overdue > 0) advice.push({ p: overdueShare > 40 ? "Priority" : "This week",
    text: `Settle or renegotiate the <strong>${gbp(d.aging.overdue)}</strong> overdue balance first — it is the cheapest liquidity risk to remove and protects supplier terms. Prioritise the largest single exposures below.` });
  if (d.aging.due7 > 0) advice.push({ p: "Next 7 days",
    text: `Ensure cash cover for <strong>${gbp(d.aging.due7)}</strong> falling due within the week.` });
  if (d.reclaimableVat > 500) advice.push({ p: "VAT",
    text: `Approximately <strong>${gbp(d.reclaimableVat)}</strong> of input VAT is embedded in the unpaid overheads and becomes recoverable on settlement — a real offset against your next VAT liability; factor it into the net cash cost of clearing these.` });
  if (d.foreignShare > 15) advice.push({ p: "FX exposure",
    text: `<strong>${d.foreignShare.toFixed(0)}%</strong> of unpaid overheads are denominated in EUR/USD. Converted values move with the rate until paid; consider settling the foreign-currency items while sterling is favourable, or holding currency to fix the cost.` });
  if (d.topSupplierShare > 25) advice.push({ p: "Concentration",
    text: `A single supplier represents <strong>${d.topSupplierShare.toFixed(0)}%</strong> of outstanding overheads. Concentration that high is worth a payment-terms conversation and a continuity check.` });
  if (d.trendPct > 15) advice.push({ p: "Cost trend",
    text: `Overhead run-rate is up <strong>${d.trendPct.toFixed(0)}%</strong> on the prior quarter. If this is not project-driven, it warrants a line-by-line review before it compounds.` });
  advice.push({ p: "Set-aside", text: `Against a ${gbp(d.runRate)}/month committed run-rate, maintaining roughly one quarter of cover (<strong>${gbp(d.forecast90)}</strong>) as a floor would keep the studio comfortably ahead of its fixed obligations.` });

  const bar = (v: number) => `<div style="background:#d3b47c;height:10px;width:${Math.round((v / maxSpend) * 100)}%;border-radius:2px"></div>`;

  // Segmented horizontal bar for the aging profile (email-safe: table cells).
  const agingSeg = (() => {
    const segs = [
      { v: d.aging.overdue, c: "#a23b3b" }, { v: d.aging.due7, c: "#c9862f" },
      { v: d.aging.due30, c: "#d3b47c" }, { v: d.aging.later, c: "#cfc6b4" },
    ].filter((s) => s.v > 0);
    const tot = segs.reduce((s, x) => s + x.v, 0) || 1;
    return `<table role="presentation" style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:6px"><tr>${
      segs.map((s) => `<td style="height:14px;background:${s.c};width:${((s.v / tot) * 100).toFixed(1)}%;border-radius:2px"></td>`).join("<td style=\"width:2px\"></td>")}</tr></table>`;
  })();

  const maxSup = Math.max(1, ...d.topSuppliers.map((s) => s.gbpv));
  const maxCcy = Math.max(1, ...d.currencyMix.map((c) => c.gbpv));
  const sec = (label: string) => `<div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8a7a55;margin-bottom:10px">${label}</div>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Georgia,'Times New Roman',serif;color:#1b1b1b">
  <div style="max-width:640px;margin:0 auto;padding:32px 28px">
    <div style="border-bottom:2px solid #1b1b1b;padding-bottom:14px;margin-bottom:22px">
      <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#8a7a55">Silver Shadow Studio — Office of Finance</div>
      <div style="font-size:22px;margin-top:6px">Weekly Financial Position &amp; Outlook</div>
      <div style="font-size:12px;color:#6b6b6b;margin-top:4px">Prepared ${new Date(d.nowISO).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · figures in GBP (FX at ECB reference rates)</div>
    </div>

    <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8a7a55;margin-bottom:8px">Executive summary</div>
    <div style="font-size:14px;line-height:1.65;margin-bottom:24px">${commentary.map((c) => `<p style="margin:0 0 10px">${c}</p>`).join("")}</div>

    <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8a7a55;margin-bottom:10px">Position at a glance</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2ddd3">Overheads outstanding (${d.unpaidCount} invoices)</td><td style="padding:8px 0;border-bottom:1px solid #e2ddd3;text-align:right">${gbp2(d.overheadsUnpaid)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2ddd3">Freelancer payables outstanding</td><td style="padding:8px 0;border-bottom:1px solid #e2ddd3;text-align:right">${gbp2(d.freelancerOutstanding)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2ddd3">Taxes due</td><td style="padding:8px 0;border-bottom:1px solid #e2ddd3;text-align:right">${gbp2(d.taxesDue)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:bold;border-bottom:2px solid #1b1b1b">Total obligations</td><td style="padding:10px 0;font-weight:bold;text-align:right;border-bottom:2px solid #1b1b1b">${gbp2(d.totalOwed)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2ddd3">Receivables (invoiced, unpaid)</td><td style="padding:8px 0;border-bottom:1px solid #e2ddd3;text-align:right">${gbp2(d.receivables)}</td></tr>
      <tr><td style="padding:10px 0;font-weight:bold">Net working position</td><td style="padding:10px 0;font-weight:bold;text-align:right;color:${d.netPosition < 0 ? "#a23b3b" : "#2e6b3e"}">${gbp2(d.netPosition)}</td></tr>
    </table>

    ${sec("Aged analysis — overheads")}
    ${agingSeg}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <tr><td style="padding:5px 0"><span style="color:#a23b3b">■</span> Overdue</td><td style="padding:5px 0;text-align:right;color:#a23b3b">${gbp2(d.aging.overdue)}</td></tr>
      <tr><td style="padding:5px 0"><span style="color:#c9862f">■</span> Due within 7 days</td><td style="padding:5px 0;text-align:right">${gbp2(d.aging.due7)}</td></tr>
      <tr><td style="padding:5px 0"><span style="color:#d3b47c">■</span> Due 8–30 days</td><td style="padding:5px 0;text-align:right">${gbp2(d.aging.due30)}</td></tr>
      <tr><td style="padding:5px 0"><span style="color:#cfc6b4">■</span> Due beyond 30 days</td><td style="padding:5px 0;text-align:right">${gbp2(d.aging.later)}</td></tr>
    </table>

    ${d.currencyMix.length > 1 ? `${sec("Currency exposure — unpaid overheads (GBP-equivalent)")}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      ${d.currencyMix.map((c) => `<tr><td style="padding:5px 0;width:48px;color:#6b6b6b">${c.ccy}</td><td style="padding:5px 8px;width:52%"><div style="background:#b9a888;height:10px;width:${Math.round((c.gbpv / maxCcy) * 100)}%;border-radius:2px"></div></td><td style="padding:5px 0;text-align:right">${gbp(c.gbpv)}</td><td style="padding:5px 0;text-align:right;width:44px;color:#6b6b6b">${((c.gbpv / (d.overheadsUnpaid || 1)) * 100).toFixed(0)}%</td></tr>`).join("")}
    </table>` : ""}

    ${d.topSuppliers.length ? `${sec("Supplier concentration — largest exposures")}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      ${d.topSuppliers.map((s) => `<tr><td style="padding:5px 0;width:38%;color:#3a3a3a;overflow:hidden">${s.name.slice(0, 26)}</td><td style="padding:5px 8px;width:40%"><div style="background:#d3b47c;height:10px;width:${Math.round((s.gbpv / maxSup) * 100)}%;border-radius:2px"></div></td><td style="padding:5px 0;text-align:right">${gbp(s.gbpv)}</td></tr>`).join("")}
    </table>` : ""}

    <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8a7a55;margin-bottom:10px">Historic tracking — overhead spend, trailing 6 months</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      ${d.history.map((h) => `<tr><td style="padding:5px 0;width:64px;color:#6b6b6b">${monthName(h.month)}</td><td style="padding:5px 8px;width:55%">${bar(h.spend)}</td><td style="padding:5px 0;text-align:right">${gbp(h.spend)}</td></tr>`).join("")}
    </table>

    <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8a7a55;margin-bottom:10px">Forecast — committed recurring outflow</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2ddd3">Recurring run-rate (amortised)</td><td style="padding:8px 0;border-bottom:1px solid #e2ddd3;text-align:right">${gbp2(d.runRate)} / month</td></tr>
      <tr><td style="padding:8px 0">Committed over next quarter</td><td style="padding:8px 0;text-align:right">${gbp2(d.forecast90)}</td></tr>
    </table>
    <p style="font-size:12px;color:#6b6b6b;line-height:1.6">Recurring figure amortises annual and quarterly commitments to a monthly basis and excludes one-off, project-driven, and discretionary spend. Receivables reflect invoiced amounts only; contracted-but-uninvoiced work is not included. This statement is generated from the portal's finance records and is indicative, not a substitute for management accounts.</p>

    <div style="background:#efe9dd;border-left:3px solid #d3b47c;padding:16px 18px;margin:26px 0 8px">
      ${sec("Adviser's commentary &amp; recommended actions")}
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.55">
        ${advice.map((a) => `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;white-space:nowrap;color:#8a7a55;font-size:11px;letter-spacing:0.06em;text-transform:uppercase">${a.p}</td><td style="padding:6px 0;vertical-align:top">${a.text}</td></tr>`).join("")}
      </table>
    </div>

    <div style="border-top:1px solid #e2ddd3;margin-top:22px;padding-top:14px;font-size:11px;color:#9a9a9a;letter-spacing:0.04em">Silver Shadow Studio · automated weekly finance summary · replaces the former per-invoice reminder emails</div>
  </div></body></html>`;
}
