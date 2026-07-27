// invoicePdfV3.ts
//
// Silvershadow invoice, template v2 — the exacting typographic spec.
// jsPDF (vector text + vector logo, never rasterised), EB Garamond static
// instances with distinct PostScript names, OSF vs tabular-lining figure sets,
// optical right-alignment via per-glyph right side-bearing.
//
// Coordinates follow the brief: millimetres from the BOTTOM-LEFT of an A4 page.
// jsPDF's origin is top-left, so every y is mapped through Y() = 297 - y.
//
// Two deviations from the written brief, per Fred:
//   • Background stays the portal paper #EDE8E0 (not #EFEDE7).
//   • The PAY ONLINE button links to the invoice's existing stripe_checkout_url
//     (no /pay/[reference] short-link route).

import { jsPDF } from "https://esm.sh/jspdf@4.2.1";
import type { InvoicePdfInput, InvoiceLineItem } from "./invoicePdf.ts";
import { getBankAccount } from "./invoicePdf.ts";
import {
  EBG_REGULAR_B64, EBG_MEDIUM_B64, EBG_SEMIBOLD_B64, EBG_TEXTOSF_B64, EBG_MEDIUMOSF_B64,
} from "./fonts/ebGaramond.ts";
import { ADV_EM, RSB_EM, type RsbKey } from "./invoiceRsb.ts";
import { LOGO_BBOX, LOGO_PATHS } from "./invoiceLogo.ts";

// ── Units ────────────────────────────────────────────────────────────────────
const PW = 210, PH = 297;
const PT2MM = 25.4 / 72;
const Y = (v: number) => PH - v;            // brief bottom-origin → jsPDF top-origin
const pt = (v: number) => v * PT2MM;        // points → mm

// ── Part 4: tokens ───────────────────────────────────────────────────────────
const BG = "#EDE8E0";                        // portal paper (Fred's override)
const INK: RGB = hex("#1B1916");
const SECONDARY: RGB = hex("#5A5550");
const MICRO: RGB = hex("#766F65");
const STRUCT: RGB = hex("#A39C90");
const HAIR: RGB = hex("#C4BEB3");
const GOLD: RGB = hex("#C9A96A");            // the portal gold token
const LOGO_INK: RGB = hex("#231f20");        // the asset's own colour — never recoloured

const LEFT = 22, RIGHT = 188;                // margins
const SIZE = {
  invNo: 13, micro: 6.3, body: 9.2, itemTitle: 11.4, itemSub: 8.6,
  total: 20, totalDue: 9.6, btn: 6.8, remit: 8.6, terms: 7.8, footer: 7.4,
};
const TRACK = { micro: 1.35, btn: 1.5, invNo: 0.6 };

type RGB = [number, number, number];
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Fonts ────────────────────────────────────────────────────────────────────
// Five statics, five jsPDF font names → five embedded subsets.
const FONTS: Record<RsbKey, { file: string; b64: string; name: string }> = {
  reg:     { file: "EBGaramondSS-Regular.ttf",   b64: EBG_REGULAR_B64,   name: "EBGSS" },
  med:     { file: "EBGaramondSS-Medium.ttf",    b64: EBG_MEDIUM_B64,    name: "EBGSSMed" },
  semi:    { file: "EBGaramondSS-SemiBold.ttf",  b64: EBG_SEMIBOLD_B64,  name: "EBGSSSemi" },
  textosf: { file: "EBGaramondSS-TextOSF.ttf",   b64: EBG_TEXTOSF_B64,   name: "EBGSSTextOSF" },
  medosf:  { file: "EBGaramondSS-MediumOSF.ttf", b64: EBG_MEDIUMOSF_B64, name: "EBGSSMedOSF" },
};

// ── Supplier (studio) constants ──────────────────────────────────────────────
const SUPPLIER = {
  company: "Silvershadow Studio Limited",
  address: ["332 Ladbroke Grove", "London W10 5AD", "United Kingdom"],
  coNo: "Co. no. 09178937",
  vat: "VAT GB 232 8467 02",
  contactName: "Inès Messad",
  contactTitle: "Finance Coordinator",
  contactEmail: "accounting@silvershadowstudio.com",
  remitAccountName: "Silvershadow Studio Ltd",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function money(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function symbol(c: string): string {
  return c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function sentenceCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase()) {
    const lower = s.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return s;
}

export function generateInvoicePdfV3(invoice: InvoicePdfInput): Uint8Array {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true }) as any;

  // Register the five statics.
  for (const k of Object.keys(FONTS) as RsbKey[]) {
    doc.addFileToVFS(FONTS[k].file, FONTS[k].b64);
    doc.addFont(FONTS[k].file, FONTS[k].name, "normal");
  }

  const currency = invoice.currency || "GBP";
  const paid = invoice.status === "paid";

  // Dates. Tax point == issue (no separate tax_point stored) → two-group column.
  const issueRaw = invoice.issued_at || invoice.created_at;
  const dueObj = new Date(issueRaw); dueObj.setDate(dueObj.getDate() + 14);
  const dueStr = dueObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const issueStr = fmtDate(issueRaw);
  // Optional tax point (no column yet — accepted as an input so the 3-group
  // date layout is ready the moment a tax_point / supply date is stored).
  const taxPointRaw = (invoice as { tax_point?: string | null }).tax_point;
  const taxPointStr = taxPointRaw ? fmtDate(taxPointRaw) : "";

  // Figures.
  const items: NormItem[] = normItems(invoice);
  const net = invoice.subtotal != null ? Number(invoice.subtotal) : items.reduce((s, i) => s + i.amount, 0);
  const gross = Number(invoice.amount) || net;
  const vatAmt = invoice.vat_amount != null ? Number(invoice.vat_amount) : Math.max(0, gross - net);
  const ratePct = (() => {
    const r = invoice.vat_rate;
    if (r == null) return net > 0 ? Math.round((vatAmt / net) * 100) : 0;
    return r > 1 ? Math.round(r) : Math.round(r * 100);
  })();

  // ── Text primitives ────────────────────────────────────────────────────────
  const setFont = (key: RsbKey, size: number, color: RGB) => {
    doc.setFont(FONTS[key].name, "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  // width in mm from the font's OWN advance metrics (jsPDF getTextWidth
  // over-reports these letter-spaced subsets) plus inter-glyph tracking.
  const widthOf = (s: string, key: RsbKey, size: number, track = 0) => {
    const chars = Array.from(s);
    let em = 0;
    for (const ch of chars) {
      const cp = ch.codePointAt(0)!;
      em += ADV_EM[key][cp] != null ? ADV_EM[key][cp] : (ADV_EM[key][0x20] ?? 0.25);
    }
    return em * pt(size) + (chars.length > 1 ? (chars.length - 1) * pt(track) : 0);
  };
  const rsbShift = (s: string, key: RsbKey, size: number) => {
    const cp = s.charCodeAt(s.length - 1);
    const em = (RSB_EM[key] && RSB_EM[key][cp]) || 0;
    return pt(em * size);
  };
  // Left-aligned text at brief (x, yBaseline).
  const left = (s: string, x: number, y: number, key: RsbKey, size: number, color: RGB, track = 0) => {
    setFont(key, size, color); doc.setCharSpace(pt(track));
    doc.text(s, x, Y(y), { align: "left", baseline: "alphabetic" });
    doc.setCharSpace(0);
  };
  // Right-aligned to briefX, optically so the last glyph's INK edge lands on briefX.
  const right = (s: string, briefX: number, y: number, key: RsbKey, size: number, color: RGB, track = 0) => {
    setFont(key, size, color); doc.setCharSpace(pt(track));
    const w = widthOf(s, key, size, track);
    const x = briefX + rsbShift(s, key, size) - w;
    doc.text(s, x, Y(y), { align: "left", baseline: "alphabetic" });
    doc.setCharSpace(0);
  };
  // Optically-centred (used by the button label, with tracking).
  const centre = (s: string, cx: number, y: number, key: RsbKey, size: number, color: RGB, track = 0) => {
    setFont(key, size, color); doc.setCharSpace(pt(track));
    const w = widthOf(s, key, size, track);
    doc.text(s, cx - w / 2, Y(y), { align: "left", baseline: "alphabetic" });
    doc.setCharSpace(0);
  };
  const rule = (x1: number, x2: number, y: number, wPt: number, color: RGB) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(pt(wPt));
    doc.line(x1, Y(y), x2, Y(y));
  };
  const micro = (s: string, x: number, y: number, align: "l" | "r" = "l") =>
    (align === "l" ? left : right)(s.toUpperCase(), x, y, "reg", SIZE.micro, MICRO, TRACK.micro);

  // ── Page furniture (header, logo, column heads) drawn per page ──────────────
  let studioBaseline = 266.23;
  const drawLogo = () => {
    const [minX, minY, maxX] = LOGO_BBOX;
    const scale = 58.32 / (maxX - minX);
    const topY = 275;                          // artwork top edge (brief)
    studioBaseline = topY - (LOGO_BBOX[3] - minY) * scale; // derived STUDIO baseline
    const tx = (sx: number) => 21.75 + (sx - minX) * scale;      // ink left edge at 21.75
    const ty = (sy: number) => Y(topY) + (sy - minY) * scale;    // y-down in both spaces
    doc.setFillColor(LOGO_INK[0], LOGO_INK[1], LOGO_INK[2]);
    for (const path of LOGO_PATHS) {
      for (const sub of path) {
        for (const seg of sub) {
          const t = seg[0] as string;
          if (t === "M") doc.moveTo(tx(seg[1] as number), ty(seg[2] as number));
          else if (t === "L") doc.lineTo(tx(seg[1] as number), ty(seg[2] as number));
          else if (t === "C")
            doc.curveTo(
              tx(seg[1] as number), ty(seg[2] as number),
              tx(seg[3] as number), ty(seg[4] as number),
              tx(seg[5] as number), ty(seg[6] as number),
            );
        }
        doc.close();
      }
      doc.fill();                              // nonzero winding, per <path> (holes preserved)
    }
  };
  const drawHeaderChrome = (continued: boolean) => {
    doc.setFillColor(hex(BG)[0], hex(BG)[1], hex(BG)[2]);
    doc.rect(0, 0, PW, PH, "F");
    drawLogo();
    micro("INVOICE", RIGHT, studioBaseline + 7.4, "r");
    right(invoice.invoice_number || invoice.reference_number || "", RIGHT, studioBaseline, "med", SIZE.invNo, INK, TRACK.invNo);
    rule(LEFT, RIGHT, 257.5, 0.7, STRUCT);
    if (continued) micro("CONTINUED", RIGHT, 30, "r");
  };

  // ── Parties block (page 1 only) ─────────────────────────────────────────────
  const drawParties = () => {
    const S = 4.6, top = 243.4;
    // Col 1 — FROM
    micro("FROM", LEFT, 250);
    const c1 = [
      [SUPPLIER.company, "med", INK], ...SUPPLIER.address.map((a) => [a, "reg", SECONDARY]),
      [SUPPLIER.coNo, "reg", SECONDARY], [SUPPLIER.vat, "reg", SECONDARY],
    ] as [string, RsbKey, RGB][];
    c1.forEach((r, i) => left(r[0], LEFT, top - i * S, r[1], SIZE.body, r[2]));
    // Col 2 — BILLED TO
    micro("BILLED TO", 94, 250);
    const addr = (invoice.client_address || "").split("\n").filter(Boolean);
    const c2 = [
      [invoice.client_company || invoice.client_name || "—", "med", INK],
      ...addr.map((a) => [a, "reg", SECONDARY] as [string, RsbKey, RGB]),
      ...(invoice.client_country ? [[invoice.client_country, "reg", SECONDARY] as [string, RsbKey, RGB]] : []),
      ...(invoice.client_registration ? [[`Co. no. ${invoice.client_registration}`, "reg", SECONDARY] as [string, RsbKey, RGB]] : []),
    ] as [string, RsbKey, RGB][];
    c2.forEach((r, i) => left(r[0], 94, top - i * S, r[1], SIZE.body, r[2]));
    // Col 3 — dates (right axis). Two groups when tax point == issue; three when
    // they differ (Part 7 — a supply date that fell before issue must be stated).
    if (taxPointStr && taxPointStr !== issueStr) {
      micro("ISSUED", RIGHT, 250, "r");
      right(issueStr, RIGHT, 243.4, "medosf", SIZE.body, INK);
      micro("TAX POINT", RIGHT, 229, "r");
      right(taxPointStr, RIGHT, 222.4, "medosf", SIZE.body, INK);
      micro("DUE", RIGHT, 208, "r");
      right(dueStr, RIGHT, 201.4, "medosf", SIZE.body, INK);
    } else {
      micro("ISSUED & TAX POINT", RIGHT, 250, "r");
      right(issueStr, RIGHT, 243.4, "medosf", SIZE.body, INK);
      micro("DUE", RIGHT, 229, "r");
      right(dueStr, RIGHT, 222.4, "medosf", SIZE.body, INK);
    }
    // Contacts row
    micro("CONTACT", LEFT, 208);
    left(SUPPLIER.contactName, LEFT, 201.4, "med", SIZE.body, INK);
    left(SUPPLIER.contactTitle, LEFT, 201.4 - S, "reg", SIZE.body, SECONDARY);
    left(SUPPLIER.contactEmail, LEFT, 201.4 - 2 * S, "reg", SIZE.body, SECONDARY);
    micro("ATTENTION", 94, 208);
    if (invoice.client_name) left(invoice.client_name, 94, 201.4, "med", SIZE.body, INK);
    if (invoice.client_position) left(invoice.client_position, 94, 201.4 - S, "reg", SIZE.body, SECONDARY);
    if (invoice.client_email) left(invoice.client_email, 94, 201.4 - 2 * S, "reg", SIZE.body, SECONDARY);
  };

  const drawItemHeads = (y: number) => {
    micro("DESCRIPTION", LEFT, y);
    micro(`AMOUNT, ${currency}`, RIGHT, y, "r");
    rule(LEFT, RIGHT, y - 4, 0.35, HAIR);
  };

  // ── Layout & pagination ─────────────────────────────────────────────────────
  // Page 1 items start at 160.5; later pages at 243.4. Keep items above the
  // bottom block. Totals follow the last item; if the gross baseline would fall
  // below y=118 the totals + bottom block move to a fresh final page.
  const P1_TOP = 160.5, PN_TOP = 243.4, ITEM_FLOOR = 92;
  type Placed = { it: NormItem; page: number; y: number };
  const placed: Placed[] = [];
  let page = 0, cursor = P1_TOP;
  for (const it of items) {
    const step = it.sub ? 13 : 9;
    if (cursor < ITEM_FLOOR) { page++; cursor = PN_TOP; }
    placed.push({ it, page, y: cursor });
    cursor -= step;
  }
  const lastPageOfItems = placed.length ? placed[placed.length - 1].page : 0;
  const lowest = placed.length
    ? Math.min(...placed.filter((p) => p.page === lastPageOfItems).map((p) => (p.it.sub ? p.y - 5 : p.y)))
    : P1_TOP;
  let netY = lowest - 11.5;
  let totalsPage = lastPageOfItems;
  if (netY - 19.3 < 118) { totalsPage = lastPageOfItems + 1; netY = 200; } // overflow → fresh page
  const totalPages = totalsPage + 1;

  // ── Render pages ─────────────────────────────────────────────────────────────
  for (let pg = 0; pg <= totalsPage; pg++) {
    if (pg > 0) doc.addPage();
    const isFinal = pg === totalsPage;
    drawHeaderChrome(pg < totalsPage);
    if (pg === 0) drawParties();
    // item heads
    if (pg === 0) drawItemHeads(172);
    else if (placed.some((p) => p.page === pg)) drawItemHeads(255);
    // items on this page
    for (const p of placed.filter((x) => x.page === pg)) {
      left(sentenceCase(p.it.title), LEFT, p.y, "reg", SIZE.itemTitle, INK);
      right(money(p.it.amount), RIGHT, p.y, "reg", SIZE.itemTitle, INK);
      if (p.it.sub) left(p.it.sub, LEFT, p.y - 5, "textosf", SIZE.itemSub, SECONDARY);
    }

    if (isFinal) {
      // Totals
      const vatY = netY - 5.6, ruleY = netY - 10.5, dueLabelY = netY - 18.1, grossY = netY - 19.3;
      left("Net total", 163 - widthOf("Net total", "reg", SIZE.body), netY, "reg", SIZE.body, SECONDARY);
      right(money(net), RIGHT, netY, "reg", SIZE.body, SECONDARY);
      const vatLabel = `VAT at ${ratePct}%`;
      left(vatLabel, 163 - widthOf(vatLabel, "reg", SIZE.body), vatY, "reg", SIZE.body, SECONDARY);
      right(money(vatAmt), RIGHT, vatY, "reg", SIZE.body, SECONDARY);
      rule(118, RIGHT, ruleY, 0.7, STRUCT);
      left("Total due", 118, dueLabelY, "med", SIZE.totalDue, INK);
      right(`${symbol(currency)}${money(gross)}`, RIGHT, grossY, "semi", SIZE.total, INK);

      // Payment area
      if (paid) {
        micro("PAID", RIGHT, 110, "r");
        right(fmtDate(invoice.paid_at ?? issueRaw), RIGHT, 103.5, "medosf", SIZE.body, INK);
      } else {
        doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
        doc.setLineWidth(pt(0.6));
        doc.rect(136, Y(113.0), 52, 9.5, "S");            // square corners, no fill
        centre("PAY ONLINE", 162, 107.4, "med", SIZE.btn, GOLD, TRACK.btn);
        if (invoice.stripe_url) doc.link(136, Y(113.0), 52, 9.5, { url: invoice.stripe_url });
      }

      // Bottom block (fixed)
      rule(LEFT, RIGHT, 81.5, 0.35, HAIR);
      micro("REMITTANCE", LEFT, 75);
      micro("TERMS", 104, 75);
      const bank = getBankAccount(invoice.bank_account);
      const remit: [string, string][] = [
        ["Account name", SUPPLIER.remitAccountName],
        ["Bank", bank.bankName],
        ["Sort code", bank.sortCode || "—"],
        ["Account no.", bank.accountNumber || "—"],
        ["IBAN", bank.iban || "—"],
        ["SWIFT/BIC", bank.swiftCode || "—"],
        ["Reference", invoice.invoice_number || invoice.reference_number || "—"],
      ];
      remit.forEach(([k, v], i) => {
        const y = 68.5 - i * 4.5;
        left(k, LEFT, y, "reg", SIZE.remit, SECONDARY);
        left(v, 48, y, "reg", SIZE.remit, INK);
      });
      // Terms — OSF, wrapped to 84mm, first line shares the Account-name baseline.
      const terms = [
        `Payment is due within 14 days of issue, by ${dueStr}.`,
        "Overdue sums carry statutory interest under the Late Payment of Commercial Debts (Interest) Act 1998, currently 8% above the Bank of England base rate, together with fixed compensation and the reasonable costs of recovery.",
        "Sums invoiced must be received in full and without deduction; transfer, intermediary and exchange charges are borne by the Client.",
      ];
      setFont("textosf", SIZE.terms, SECONDARY);
      let ty = 68.5;
      const lh = pt(10.4), pgap = pt(4.2);
      for (const para of terms) {
        const lines: string[] = doc.splitTextToSize(para, 84);
        for (const ln of lines) { left(ln, 104, ty, "textosf", SIZE.terms, SECONDARY); ty -= lh; }
        ty -= pgap;
      }
      // Footer
      rule(LEFT, RIGHT, 24, 0.35, HAIR);
      left("silvershadowstudio.com", LEFT, 18, "reg", SIZE.footer, MICRO);
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

// ── Line-item normalisation ──────────────────────────────────────────────────
type NormItem = { title: string; sub: string; amount: number };
function normItems(invoice: InvoicePdfInput): NormItem[] {
  const raw: InvoiceLineItem[] = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const rows = raw
    .map((it) => ({
      title: (it.description || "").trim(),
      sub: ((it as { reference?: string }).reference || "").trim(),
      amount: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    }))
    .filter((r) => r.title || r.amount);
  if (rows.length === 0) {
    const net = invoice.subtotal != null ? Number(invoice.subtotal) : Number(invoice.amount) || 0;
    rows.push({ title: invoice.description || "Professional services", sub: "", amount: net });
  }
  // Classic single-item-from-quote: derive the "As per quotation" subline.
  if (rows.length === 1 && !rows[0].sub && invoice.reference_number) {
    rows[0].sub = `As per quotation ${invoice.reference_number}`;
  }
  return rows;
}
