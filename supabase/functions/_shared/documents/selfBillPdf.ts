// selfBillPdf.ts
//
// Self-billed invoice: a supplier (freelancer) invoice RAISED BY Silvershadow
// Studio Ltd on the supplier's behalf under a self-billing agreement (HMRC VAT
// Notice 700/62). Same EB Garamond visual language as the outgoing invoice
// (invoicePdfV3). Itemised per-line (model / day / session) with pagination.
//
// Country-driven VAT (the supplier's country + VAT registration decide it):
//   • UK + VAT-registered → 20% VAT, "output tax due to HMRC".
//   • UK + not registered → no VAT.
//   • Outside the UK      → outside the scope of UK VAT; Studio accounts for
//                           the reverse charge where applicable.

import { jsPDF } from "https://esm.sh/jspdf@4.2.1";
import {
  EBG_REGULAR_B64, EBG_MEDIUM_B64, EBG_SEMIBOLD_B64, EBG_TEXTOSF_B64, EBG_MEDIUMOSF_B64,
} from "./fonts/ebGaramond.ts";
import { ADV_EM, RSB_EM, type RsbKey } from "./invoiceRsb.ts";

const PW = 210, PH = 297;
const PT2MM = 25.4 / 72;
const Y = (v: number) => PH - v;
const pt = (v: number) => v * PT2MM;

const BG = "#EDE8E0";
type RGB = [number, number, number];
function hex(h: string): RGB { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const INK = hex("#1B1916"), SECONDARY = hex("#5A5550"), MICRO = hex("#766F65");
const STRUCT = hex("#A39C90"), HAIR = hex("#C4BEB3");

const LEFT = 22, RIGHT = 188;
const SIZE = { name: 20, micro: 6.3, body: 9.2, itemTitle: 11.4, itemSub: 8.6, total: 20, totalDue: 9.6, remit: 8.6, note: 7.8, footer: 7.4 };
const TRACK = { micro: 1.35, name: 0.4 };

const FONTS: Record<RsbKey, { file: string; b64: string; name: string }> = {
  reg:     { file: "EBGaramondSS-Regular.ttf",   b64: EBG_REGULAR_B64,   name: "EBGSS" },
  med:     { file: "EBGaramondSS-Medium.ttf",    b64: EBG_MEDIUM_B64,    name: "EBGSSMed" },
  semi:    { file: "EBGaramondSS-SemiBold.ttf",  b64: EBG_SEMIBOLD_B64,  name: "EBGSSSemi" },
  textosf: { file: "EBGaramondSS-TextOSF.ttf",   b64: EBG_TEXTOSF_B64,   name: "EBGSSTextOSF" },
  medosf:  { file: "EBGaramondSS-MediumOSF.ttf", b64: EBG_MEDIUMOSF_B64, name: "EBGSSMedOSF" },
};

const STUDIO = {
  company: "Silvershadow Studio Limited",
  address: ["332 Ladbroke Grove", "London W10 5AD", "United Kingdom"],
  coNo: "Co. no. 09178937",
  vat: "VAT GB 232 8467 02",
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export interface SelfBillLine {
  description: string;
  qty?: number | null;
  unit?: string | null;   // "hrs" | "days"
  rate?: number | null;
  amount: number;
}
export interface SelfBillFreelancer {
  first_name: string; last_name: string;
  address_lines: string[]; country: string;
  vat_registered: boolean; vat_number?: string | null;
  bank_name?: string | null; account_holder?: string | null;
  sort_code?: string | null; account_number?: string | null;
  iban?: string | null; swift?: string | null;
}
export interface SelfBillInput {
  invoice_number: string;
  issued_at: string;          // ISO
  period_year: number;
  period_month: number;       // 1-12
  role_label: string;
  currency: string;
  line_items: SelfBillLine[];
  amount?: number;            // fallback net if no line items
  freelancer: SelfBillFreelancer;
}

function money(n: number): string { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function symbol(c: string): string { return c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `; }
function fmtDate(v: string): string { return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
const UK = /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland|gb)\b/i;

export function generateSelfBillPdf(input: SelfBillInput): Uint8Array {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true }) as any;
  for (const k of Object.keys(FONTS) as RsbKey[]) { doc.addFileToVFS(FONTS[k].file, FONTS[k].b64); doc.addFont(FONTS[k].file, FONTS[k].name, "normal"); }

  const f = input.freelancer;
  const currency = input.currency || "GBP";
  const vatApplies = UK.test(f.country || "") && f.vat_registered;
  const fullName = [f.first_name, f.last_name].filter(Boolean).join(" ");
  const periodLabel = `${MONTHS[input.period_month - 1]} ${input.period_year}`;

  const rawLines = (input.line_items && input.line_items.length)
    ? input.line_items
    : [{ description: `${input.role_label} — ${periodLabel}`, amount: input.amount ?? 0 } as SelfBillLine];
  const net = rawLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const vatAmt = vatApplies ? Math.round(net * 0.2 * 100) / 100 : 0;
  const gross = net + vatAmt;

  // ── Primitives (shared with invoicePdfV3) ───────────────────────────────────
  const setFont = (key: RsbKey, size: number, color: RGB) => { doc.setFont(FONTS[key].name, "normal"); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]); };
  const widthOf = (s: string, key: RsbKey, size: number, track = 0) => {
    const cs = Array.from(s); let em = 0;
    for (const ch of cs) { const cp = ch.codePointAt(0)!; em += ADV_EM[key][cp] != null ? ADV_EM[key][cp] : (ADV_EM[key][0x20] ?? 0.25); }
    return em * pt(size) + (cs.length > 1 ? (cs.length - 1) * pt(track) : 0);
  };
  const rsbShift = (s: string, key: RsbKey, size: number) => { const cp = s.charCodeAt(s.length - 1); return pt(((RSB_EM[key] && RSB_EM[key][cp]) || 0) * size); };
  const left = (s: string, x: number, y: number, key: RsbKey, size: number, color: RGB, track = 0) => { setFont(key, size, color); doc.setCharSpace(pt(track)); doc.text(s, x, Y(y), { align: "left", baseline: "alphabetic" }); doc.setCharSpace(0); };
  const right = (s: string, briefX: number, y: number, key: RsbKey, size: number, color: RGB, track = 0) => { setFont(key, size, color); doc.setCharSpace(pt(track)); const w = widthOf(s, key, size, track); doc.text(s, briefX + rsbShift(s, key, size) - w, Y(y), { align: "left", baseline: "alphabetic" }); doc.setCharSpace(0); };
  const rule = (x1: number, x2: number, y: number, wPt: number, color: RGB) => { doc.setDrawColor(color[0], color[1], color[2]); doc.setLineWidth(pt(wPt)); doc.line(x1, Y(y), x2, Y(y)); };
  const micro = (s: string, x: number, y: number, align: "l" | "r" = "l") => (align === "l" ? left : right)(s.toUpperCase(), x, y, "reg", SIZE.micro, MICRO, TRACK.micro);
  // Truncate a description to fit left of the amount column.
  const fit = (s: string, key: RsbKey, size: number, maxW: number) => {
    if (widthOf(s, key, size) <= maxW) return s;
    let t = s;
    while (t.length > 4 && widthOf(t + "…", key, size) > maxW) t = t.slice(0, -1);
    return t + "…";
  };

  // Line-item columns: Description | Qty | Rate | Amount (each on its own axis).
  const QTY_X = 116, RATE_X = 150, DESC_W = QTY_X - LEFT - 10;
  const firstUnit = (rawLines.find((l) => l.unit)?.unit || "").toLowerCase();
  const unitHeader = firstUnit.startsWith("day") ? "DAYS" : firstUnit ? "HOURS" : "QTY";
  const qtyStr = (q: number) => (+q).toLocaleString("en-GB");

  // ── Per-page chrome ─────────────────────────────────────────────────────────
  const drawHeader = (continued: boolean) => {
    doc.setFillColor(hex(BG)[0], hex(BG)[1], hex(BG)[2]); doc.rect(0, 0, PW, PH, "F");
    left(fullName, LEFT, 266.23, "semi", SIZE.name, INK, TRACK.name);
    micro("SELF-BILLED INVOICE", RIGHT, 273.6, "r");
    right(input.invoice_number, RIGHT, 266.23, "med", 13, INK, 0.6);
    left("Raised by Silvershadow Studio Limited on the supplier's behalf under a self-billing agreement.", LEFT, 260, "textosf", 7.8, SECONDARY);
    rule(LEFT, RIGHT, 255, 0.7, STRUCT);
    if (continued) micro("CONTINUED", RIGHT, 30, "r");
  };
  const drawParties = () => {
    const S = 4.6, top = 240;
    micro("SUPPLIER", LEFT, 247);
    const supplier: [string, RsbKey, RGB][] = [
      [fullName, "med", INK],
      ...f.address_lines.filter(Boolean).map((a) => [a, "reg", SECONDARY] as [string, RsbKey, RGB]),
      ...(f.country ? [[f.country, "reg", SECONDARY] as [string, RsbKey, RGB]] : []),
      ...(vatApplies && f.vat_number ? [[`VAT ${f.vat_number}`, "reg", SECONDARY] as [string, RsbKey, RGB]] : []),
    ];
    supplier.forEach((r, i) => left(r[0], LEFT, top - i * S, r[1], SIZE.body, r[2]));
    micro("CUSTOMER", 94, 247);
    const customer: [string, RsbKey, RGB][] = [[STUDIO.company, "med", INK], ...STUDIO.address.map((a) => [a, "reg", SECONDARY] as [string, RsbKey, RGB]), [STUDIO.coNo, "reg", SECONDARY], [STUDIO.vat, "reg", SECONDARY]];
    customer.forEach((r, i) => left(r[0], 94, top - i * S, r[1], SIZE.body, r[2]));
    micro("ISSUED", RIGHT, 247, "r"); right(fmtDate(input.issued_at), RIGHT, 240.4, "medosf", SIZE.body, INK);
    micro("PERIOD", RIGHT, 226, "r"); right(periodLabel, RIGHT, 219.4, "medosf", SIZE.body, INK);
  };
  const drawItemHeads = (y: number) => {
    micro("DESCRIPTION", LEFT, y);
    micro(unitHeader, QTY_X, y, "r");
    micro("RATE", RATE_X, y, "r");
    micro(`AMOUNT, ${currency}`, RIGHT, y, "r");
    rule(LEFT, RIGHT, y - 4, 0.35, HAIR);
  };

  // ── Item layout + pagination (mirrors invoicePdfV3) ─────────────────────────
  const P1_TOP = 178.5, PN_TOP = 236.5, ITEM_FLOOR = 92;
  type Placed = { l: SelfBillLine; page: number; y: number };
  const placed: Placed[] = [];
  let page = 0, cursor = P1_TOP;
  for (const l of rawLines) {
    if (cursor < ITEM_FLOOR) { page++; cursor = PN_TOP; }
    placed.push({ l, page, y: cursor }); cursor -= 9;   // single-line rows now
  }
  const lastItemsPage = placed.length ? placed[placed.length - 1].page : 0;
  const lowest = placed.length
    ? Math.min(...placed.filter((p) => p.page === lastItemsPage).map((p) => p.y))
    : P1_TOP;
  let netY = lowest - 11.5;
  let totalsPage = lastItemsPage;
  if (netY - 19.3 < 118) { totalsPage = lastItemsPage + 1; netY = 200; }

  for (let pg = 0; pg <= totalsPage; pg++) {
    if (pg > 0) doc.addPage();
    drawHeader(pg < totalsPage);
    if (pg === 0) { drawParties(); drawItemHeads(190); }
    else if (placed.some((p) => p.page === pg)) drawItemHeads(248); // clear below the header rule (255)
    for (const p of placed.filter((x) => x.page === pg)) {
      const l = p.l;
      left(fit(l.description, "reg", SIZE.itemTitle, DESC_W), LEFT, p.y, "reg", SIZE.itemTitle, INK);
      if (l.qty != null) right(qtyStr(l.qty), QTY_X, p.y, "reg", SIZE.body, SECONDARY);
      if (l.rate != null) right(`${symbol(currency)}${money(l.rate)}`, RATE_X, p.y, "reg", SIZE.body, SECONDARY);
      right(money(l.amount), RIGHT, p.y, "reg", SIZE.itemTitle, INK);
    }

    if (pg === totalsPage) {
      const vatY = netY - 5.6;
      left("Net total", 163 - widthOf("Net total", "reg", SIZE.body), netY, "reg", SIZE.body, SECONDARY);
      right(money(net), RIGHT, netY, "reg", SIZE.body, SECONDARY);
      const vatLabel = vatApplies ? "VAT at 20%" : "VAT";
      left(vatLabel, 163 - widthOf(vatLabel, "reg", SIZE.body), vatY, "reg", SIZE.body, SECONDARY);
      right(vatApplies ? money(vatAmt) : "—", RIGHT, vatY, "reg", SIZE.body, SECONDARY);
      rule(118, RIGHT, netY - 10.5, 0.7, STRUCT);
      left("Total due", 118, netY - 18.1, "med", SIZE.totalDue, INK);
      right(`${symbol(currency)}${money(gross)}`, RIGHT, netY - 19.3, "semi", SIZE.total, INK);

      // Bottom block (final page)
      rule(LEFT, RIGHT, 81.5, 0.35, HAIR);
      micro("PAYMENT TO", LEFT, 75); micro("SELF-BILLING", 104, 75);
      const remit: [string, string][] = [
        ["Account name", f.account_holder || fullName],
        ["Bank", f.bank_name || "—"],
        ...(f.sort_code ? [["Sort code", f.sort_code] as [string, string]] : []),
        ...(f.account_number ? [["Account no.", f.account_number] as [string, string]] : []),
        ...(f.iban ? [["IBAN", f.iban] as [string, string]] : []),
        ...(f.swift ? [["SWIFT/BIC", f.swift] as [string, string]] : []),
        ["Reference", input.invoice_number],
      ];
      remit.forEach(([k, v], i) => { const y = 68.5 - i * 4.5; left(k, LEFT, y, "reg", SIZE.remit, SECONDARY); left(v, 48, y, "reg", SIZE.remit, INK); });
      const vatStatement = vatApplies
        ? "The VAT shown above is your output tax due to HMRC."
        : UK.test(f.country || "")
          ? "The supplier is not VAT registered; no VAT is chargeable on this supply."
          : "Outside the scope of UK VAT. Silvershadow Studio Limited accounts for VAT under the reverse charge where applicable.";
      const notes = [
        "This is a self-billed invoice. You must not raise a separate VAT invoice for these supplies.",
        vatStatement,
        "Silvershadow Studio Limited will notify you if it ceases to be VAT registered, transfers its business, or the self-billing agreement ends.",
      ];
      setFont("textosf", SIZE.note, SECONDARY);
      let ty = 68.5; const lh = pt(10.4), pgap = pt(4.2);
      for (const para of notes) { for (const ln of doc.splitTextToSize(para, 84) as string[]) { left(ln, 104, ty, "textosf", SIZE.note, SECONDARY); ty -= lh; } ty -= pgap; }
      rule(LEFT, RIGHT, 24, 0.35, HAIR);
      left("silvershadowstudio.com", LEFT, 18, "reg", SIZE.footer, MICRO);
      right("Self-billed invoice · Silvershadow Studio Limited", RIGHT, 18, "reg", SIZE.footer, MICRO);
    }
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

/** payables_snapshot source_table → human role label. */
export function roleLabel(sourceTable: string): string {
  switch (sourceTable) {
    case "modeller_invoices": return "3D modelling";
    case "scene_manager_invoice": return "Scene management";
    case "photographer_invoice": return "Photography";
    default: return "Production services";
  }
}
