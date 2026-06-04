// Server-side quotation PDF generator. Native jsPDF text (selectable, not
// rasterised) with real ensureSpace() pagination, mirroring the on-screen
// QuotationDocument.tsx field-for-field. Replaces the client-side
// html2canvas rasteriser (generateInvoicePdf) which produced a single,
// content-clipped, image-based page.
//
// Visual tokens + rendering primitives are shared with agreementPdfV3.ts /
// teamContractPdf.ts (./designTokens.ts, ./pdfPrimitives.ts). The embedded
// Tinos font (./tinosFonts.ts) gives Unicode coverage for UK/EU client names
// and addresses. This file only assembles the quotation-specific blocks.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../brandLogo.ts";
import { paintPageBackground } from "../brand.ts";
import { hexToRgb, PDF_MARGIN, PDF_SIZE, trackedUpper } from "./designTokens.ts";
import {
  type PdfContext,
  drawCoverLogo,
  drawHairline,
  ensureSpace,
  writeBody,
  writeMetaLabel,
} from "./pdfPrimitives.ts";
import { TINOS_BOLD_B64, TINOS_ITALIC_B64, TINOS_REGULAR_B64 } from "./tinosFonts.ts";

// On-screen palette (QuotationDocument.tsx): ink #1A1814, muted #6B6358,
// ruleLight #C8C0B0, page background #FAF8F4, gold accent #B89A6A.
const INK = "#1A1814";
const MUTED = "#6B6358";
const RULE_LIGHT = "#C8C0B0";
const GOLD = "#B89A6A";
const PAGE_BG = "#FAF8F4";

const FOOTER_LINE =
  "Silvershadow Studio Limited   |   Registered in England & Wales: 9178937   |   VAT NUMBER: GB 232 8467 02   |   332 LADBROKE GROVE, LONDON W10 5AD   |   +44(0)203 876 5980   |   SILVERSHADOWSTUDIO.COM";

export interface QuotationLineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
}

export interface QuotationPdfInput {
  quotation_number: string;
  reference_number?: string | null;
  project_name?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  currency?: string | null;
  client_company?: string | null;
  client_address?: string | null;
  client_country?: string | null;
  client_registration?: string | null;
  client_name?: string | null;
  client_position?: string | null;
  line_items?: QuotationLineItem[] | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  amount?: number | null;
  notes?: string | null;
}

function currencySymbolAscii(currency: string): string {
  switch (currency) {
    case "GBP":
      return "GBP ";
    case "EUR":
      return "EUR ";
    case "USD":
      return "$";
    default:
      return `${currency} `;
  }
}

function fmtMoney(amount: number, currency = "GBP"): string {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${currencySymbolAscii(currency)}${n}`;
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function generateQuotationPdf(input: QuotationPdfInput): Uint8Array {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  // Register Tinos (normal/bold/italic) so setFont("Tinos", ..) resolves to a
  // Unicode-capable family for client names/addresses.
  pdf.addFileToVFS("Tinos-Regular.ttf", TINOS_REGULAR_B64);
  pdf.addFont("Tinos-Regular.ttf", "Tinos", "normal");
  pdf.addFileToVFS("Tinos-Bold.ttf", TINOS_BOLD_B64);
  pdf.addFont("Tinos-Bold.ttf", "Tinos", "bold");
  pdf.addFileToVFS("Tinos-Italic.ttf", TINOS_ITALIC_B64);
  pdf.addFont("Tinos-Italic.ttf", "Tinos", "italic");

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PDF_MARGIN.x * 2;

  const ink = hexToRgb(INK);
  const muted = hexToRgb(MUTED);
  const gold = hexToRgb(GOLD);
  const ruleLight = hexToRgb(RULE_LIGHT);

  const ctx: PdfContext = {
    pdf,
    pageWidth,
    // Reserve extra space at the foot of every page so body content never
    // crowds the registered-details footer (ensureSpace cuts off content at
    // ctx.pageHeight - PDF_MARGIN.bottom; the footer below uses the real height).
    pageHeight: pageHeight - 6,
    contentWidth,
    ink,
    muted,
    gold,
    bodyFont: "Tinos",
    metaFont: "Tinos",
    backgroundColor: PAGE_BG,
  };

  paintPageBackground(pdf, PAGE_BG);
  let y = PDF_MARGIN.top;

  // ── Local helpers (quotation-specific) ────────────────────────────────────

  // Large serif display line (project name, gross total). Returns advanced y.
  const writeDisplay = (cursor: number, text: string, size: number): number => {
    cursor = ensureSpace(ctx, cursor, size * 0.5);
    pdf.setFont("Tinos", "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(text, PDF_MARGIN.x, cursor);
    return cursor + size * 0.42 + 2;
  };

  // Bold inline subsection label (e.g. "Payment Terms", "Round 01 …").
  const writeSubLabel = (cursor: number, text: string): number => {
    cursor = ensureSpace(ctx, cursor, 7);
    pdf.setFont("Tinos", "bold");
    pdf.setFontSize(PDF_SIZE.body);
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(text, PDF_MARGIN.x, cursor);
    return cursor + 5.4;
  };

  const writeBullets = (cursor: number, items: string[]): number => {
    for (const it of items) {
      cursor = writeBody(ctx, cursor, `·   ${it}`, { indent: 4, lineGap: 5.8, afterGap: 1.8 });
    }
    return cursor + 1.5;
  };

  const writeNumbered = (cursor: number, items: string[]): number => {
    items.forEach((it, i) => {
      cursor = writeBody(ctx, cursor, `${i + 1}.   ${it}`, { indent: 4, lineGap: 5.8, afterGap: 1.8 });
    });
    return cursor + 1.5;
  };

  const mutedRule = (cursor: number): number => {
    cursor = ensureSpace(ctx, cursor, 4);
    drawHairline(ctx, cursor, ruleLight, 0.2);
    return cursor + 5;
  };

  const currency = input.currency || "GBP";
  const items: QuotationLineItem[] =
    input.line_items && input.line_items.length > 0
      ? input.line_items
      : [{ description: "CGI Still Visuals", quantity: 1, unit_price: Number(input.amount) || 0 }];

  const computedSubtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  );
  const subtotal = Number(input.subtotal ?? computedSubtotal);
  const vatRate = Number(input.vat_rate ?? 20);
  const vatAmount = Number(input.vat_amount ?? (subtotal * vatRate) / 100);
  const grand = Number(input.amount ?? subtotal + vatAmount);
  const number = input.quotation_number || input.reference_number || "—";

  // ── 1. Logo (centred) ─────────────────────────────────────────────────────
  y = drawCoverLogo(ctx, y, SILVERSHADOW_LOGO_DATA_URL);
  y = mutedRule(y);
  y += 3;

  // ── 2. Project block (omit UUIDs / short codes, per on-screen showProject) ─
  const projectName = input.project_name?.trim() || null;
  const showProject = !!projectName &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(projectName) &&
    !/^[A-Z0-9_-]{2,10}$/i.test(projectName);
  if (showProject) {
    y = writeMetaLabel(ctx, y, "Project", { afterGap: 9 });
    y = writeDisplay(y, projectName as string, 22);
    y += 4;
  }

  // ── 3. Quotation # + Date (two columns) ───────────────────────────────────
  const colR = PDF_MARGIN.x + contentWidth / 2;
  const labelRow = y;
  pdf.setFont("Tinos", "normal");
  pdf.setFontSize(PDF_SIZE.metaLabel);
  pdf.setTextColor(muted[0], muted[1], muted[2]);
  pdf.text(trackedUpper("Quotation"), PDF_MARGIN.x, labelRow);
  pdf.text(trackedUpper("Date"), colR, labelRow);
  const valRow = labelRow + 6;
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.setFontSize(showProject ? 13 : 20);
  pdf.text(String(number), PDF_MARGIN.x, valRow + (showProject ? 0 : 2));
  pdf.setFontSize(13);
  pdf.text(fmtDate(input.issued_at || input.created_at), colR, valRow);
  y = valRow + (showProject ? 6 : 10);

  // ── 4. The Client ─────────────────────────────────────────────────────────
  y += 4;
  y = writeMetaLabel(ctx, y, "The Client", { afterGap: 4 });
  const addressParts = (input.client_address || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const country = input.client_country || "United Kingdom";
  const billed = addressParts.length
    ? (addressParts.some((l) => l.toLowerCase() === country.toLowerCase())
        ? addressParts
        : [...addressParts, country])
    : ["—"];
  const clientLines = [input.client_company || "—", ...billed];
  if (input.client_registration) clientLines.push(`Co. No. ${input.client_registration}`);
  for (const line of clientLines) {
    y = writeBody(ctx, y, line, { size: 10, lineGap: 5.4, afterGap: 0 });
  }
  y += 4;

  // ── 5. Brief ──────────────────────────────────────────────────────────────
  y = mutedRule(y);
  y = writeMetaLabel(ctx, y, "Brief", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "The Client hereby commissions the production of the deliverables listed below. These will be produced to Silver Shadow Studio's signature standard, suitable for premium presentations and distribution.",
    { afterGap: 4 },
  );

  // ── 6. Fee table ──────────────────────────────────────────────────────────
  y += 2;
  y = writeMetaLabel(ctx, y, "Fee", { afterGap: 4 });
  const colTotalR = PDF_MARGIN.x + contentWidth;
  const colUnitR = colTotalR - 34;
  const colQtyR = colUnitR - 28;
  const descW = colQtyR - 14 - PDF_MARGIN.x;

  // Header row
  y = ensureSpace(ctx, y, 8);
  pdf.setFont("Tinos", "normal");
  pdf.setFontSize(6.5);
  pdf.setTextColor(muted[0], muted[1], muted[2]);
  pdf.text(trackedUpper("Description"), PDF_MARGIN.x, y);
  pdf.text(trackedUpper("Qty"), colQtyR, y, { align: "right" });
  pdf.text(trackedUpper("Unit"), colUnitR, y, { align: "right" });
  pdf.text(trackedUpper("Total"), colTotalR, y, { align: "right" });
  y += 2;
  drawHairline(ctx, y, ink, 0.3);
  y += 5;

  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;
    const total = qty * unit;
    pdf.setFont("Tinos", "normal");
    pdf.setFontSize(PDF_SIZE.body);
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const descLines: string[] = pdf.splitTextToSize(it.description || "—", descW);
    const rowH = Math.max(descLines.length, 1) * 5.4;
    y = ensureSpace(ctx, y, rowH + 8);
    descLines.forEach((line, i) => {
      pdf.text(line, PDF_MARGIN.x, y + i * 5.4);
    });
    pdf.text(String(qty), colQtyR, y, { align: "right" });
    pdf.text(fmtMoney(unit, currency), colUnitR, y, { align: "right" });
    pdf.text(fmtMoney(total, currency), colTotalR, y, { align: "right" });
    y += rowH + 3;
    drawHairline(ctx, y, ruleLight, 0.15);
    y += 5;
  }

  // ── 7. Totals ─────────────────────────────────────────────────────────────
  // One page-break guard up front so Net Total + VAT + divider + the large
  // Gross Total never split across a page boundary (per-row ensureSpace used to
  // let the block fracture mid-way).
  y += 3;
  y = ensureSpace(ctx, y, 42);
  const totalRow = (cursor: number, label: string, value: string, small: boolean): number => {
    pdf.setFont("Tinos", "normal");
    pdf.setFontSize(small ? 9 : PDF_SIZE.body);
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(label, PDF_MARGIN.x, cursor);
    pdf.text(value, colTotalR, cursor, { align: "right" });
    return cursor + 5.4;
  };
  y = totalRow(y, "Net Total", fmtMoney(subtotal, currency), true);
  y = totalRow(y, `VAT ${vatRate}%`, fmtMoney(vatAmount, currency), true);
  y += 2;
  drawHairline(ctx, y, ink, 0.3);
  y += 8;
  // Gross Total — large display (covered by the block guard above; no
  // per-element ensureSpace so it stays with Net + VAT). The 8mm gap below the
  // divider clears the 24pt ascent so the value never crosses the rule.
  pdf.setFont("Tinos", "normal");
  pdf.setFontSize(PDF_SIZE.metaLabel);
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.text(trackedUpper("Gross Total"), PDF_MARGIN.x, y);
  pdf.setFontSize(24);
  pdf.text(fmtMoney(grand, currency), colTotalR, y, { align: "right" });
  y += 5;
  drawHairline(ctx, y, ink, 0.3);
  y += 8;

  // ── 8. Required Documentation (plain paragraphs) ──────────────────────────
  y = writeMetaLabel(ctx, y, "Required Documentation", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "The following comprehensive architectural and decorative documentation must be provided:",
    { afterGap: 3 },
  );
  y = writeBody(ctx, y, "Architectural Plans — DWG floor plans, elevations, and ceiling plans.", { afterGap: 2 });
  y = writeBody(
    ctx,
    y,
    "Design and Finishes — Detailed finishes schedule (walls, windows, fabrics, etc.), FF&E layout plan, lighting and atmosphere mood board.",
    { afterGap: 2 },
  );
  y = writeBody(ctx, y, "Reference Material — Site photography, existing 3D models.", { afterGap: 4 });

  // ── 9. Scope of Services & Workflow ───────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Scope of Services & Workflow", { afterGap: 5 });
  y = writeSubLabel(y, "1. Round 01 — Design Realisation Round");
  y = writeBullets(y, [
    "Room Modelling — Creation of accurate 3D volumes for each space based on approved architectural drawings.",
    "Furniture & Accessory Integration — Bespoke modelling and placement of furniture, fixtures, and decorative elements as per the Client's specifications.",
    "Lighting & Material Development — Application of materials, textures, and lighting to define the atmosphere and visual realism of each scene.",
  ]);
  y = writeSubLabel(y, "2. Round 02 — Finalisation Round");
  y = writeBullets(y, [
    "Virtual Photoshoot — Upon receipt of the Client's feedback on Round 01, a meeting with our Director of Photography determines optimal camera angles and framing aligned with the design intent.",
    "Finalisation — Incorporates the Client's feedback from Round 01, limited to corrections required to align with the initial design brief: refinements to positions, dimensions, finishes, lighting, and overall visual composition.",
    "Post-Production — Final adjustments to colour, balance, and contrast applied to achieve Silver Shadow Studio's signature standard of realism and photographic quality.",
    "No new design concepts or modelling changes are permitted at this stage. Any new direction or major modification will require an additional Redesign Round.",
  ]);
  y = writeBody(
    ctx,
    y,
    "Each image undergoes this structured process to ensure both aesthetic quality and technical accuracy, with the Client fully involved at each feedback stage. This outline represents Silver Shadow Studio's standard process and can be adapted to specific client requirements by mutual agreement.",
    { afterGap: 4 },
  );

  // ── 10. Production Schedule ────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Production Schedule", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "A detailed production schedule will be shared with the Client. To secure the current production slot, the Client must, within 5 calendar days prior to the agreed start date:",
    { afterGap: 3 },
  );
  y = writeNumbered(y, [
    "Return this signed quotation.",
    "Provide all Required Documentation.",
    "Proceed with the downpayment.",
  ]);
  y = writeBody(
    ctx,
    y,
    "Failure to do so will result in the timeline being pushed back by one week, in line with our weekly production schedule, and then again accordingly until all conditions have been met.",
    { afterGap: 4 },
  );

  // ── 11. Production Guidelines ──────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Production Guidelines", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "We believe open communication and precise planning are key to achieving visual excellence. To maintain quality and ensure an efficient, transparent process:",
    { afterGap: 3 },
  );
  y = writeNumbered(y, [
    "Work on any round will commence only once all required reference information has been provided.",
    "Each round requires a minimum of one calendar week for completion, counted from the latest receipt of instructions.",
    "Once a round is in progress, no new instructions or design changes may be introduced. Any additional input will be considered in the next scheduled round.",
  ]);

  // ── 12. Additional Work ────────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Additional Work", { afterGap: 5 });
  y = writeSubLabel(y, "Initial Rounds");
  y = writeBody(
    ctx,
    y,
    "The initial cost includes bespoke architecture, interior design, and furniture modelling services, limited to one design concept: Round 01 — Design Realisation; Round 02 — Finalisation Round.",
    { afterGap: 3 },
  );
  y = writeSubLabel(y, "Redesign Rounds");
  y = writeBody(
    ctx,
    y,
    "Redesign Rounds are additional Design Realisation Rounds, required if new design instructions are provided. Available at £1,000+VAT per scene, per round. Each new instruction is confirmed through a Revision Control Notice before production continues, and related charges appear on the final balance invoice.",
    { afterGap: 3 },
  );
  y = writeSubLabel(y, "Working Hours");
  y = writeBody(
    ctx,
    y,
    "Work during weekends and public holidays is not included in the scope of this contract.",
    { afterGap: 4 },
  );

  // ── 13. Delivery Format ────────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Delivery Format", { afterGap: 5 });
  y = writeBody(ctx, y, "Stills — Delivered at 5,000 pixels on the longest edge, ~A3 at 300 DPI.", { afterGap: 2 });
  y = writeBody(ctx, y, "Virtual Tours — Delivered at 15,000 × 10,000 pixels.", { afterGap: 2 });
  y = writeBody(ctx, y, "Films — Delivered in 1920 × 1080 (Full HD) at 30 fps.", { afterGap: 2 });
  y = writeBody(
    ctx,
    y,
    "Larger Formats — Available on request and may incur additional fees. Confirm any higher-resolution requirements at the start of the project.",
    { afterGap: 4 },
  );

  // ── 14. Commercial Terms ───────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Commercial Terms", { afterGap: 5 });
  y = writeSubLabel(y, "Payment Terms");
  y = writeBullets(y, [
    "A 40% deposit is required to initiate production.",
    "The remaining 60% is due within 30 calendar days of delivery.",
    `Bank transfer and currency exchange fees are to be borne by the Client. Prices in ${currency}.`,
  ]);
  y = writeSubLabel(y, "Non-Payment and Delivery Clause");
  y = writeBody(
    ctx,
    y,
    "Delivery of any visuals or scenes is contingent upon receipt of payments as scheduled. If any instalment is not paid by its due date, Silver Shadow Studio reserves the right to withhold delivery of any pending visuals until such payments are fully received.",
    { afterGap: 3 },
  );
  y = writeSubLabel(y, "Late Payment Policy");
  y = writeBody(
    ctx,
    y,
    "A late payment fee of 5% of the outstanding balance will be added every 10 days from the due date until payment is received. This fee covers administrative costs associated with managing late payments and encourages timely settlement.",
    { afterGap: 4 },
  );

  // ── 15. Project Inactivity ─────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Project Inactivity", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "If the Client provides no feedback or communication for more than 30 calendar days, Silver Shadow Studio reserves the right to terminate the project. In such cases, the Studio will issue an invoice covering the pro-rata value of the work completed to date, along with any confirmed external or recoverable production costs incurred during that period. Reactivation of a suspended or terminated project will require a new quotation, revised timeline, and written confirmation of reactivation.",
    { afterGap: 4 },
  );

  // ── 16. Intellectual Property ──────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Intellectual Property", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "All work remains the property of Silver Shadow Studio until full payment has been received. Upon full payment, the copyright and intellectual property rights for the completed work shall transfer to the Client. Silver Shadow Studio may, at its discretion, feature the commissioned visuals within its professional portfolio and in award submissions. The Studio must be credited as the creator of the visual content in any publications or media exposure.",
    { afterGap: 4 },
  );

  // ── 17. Confidentiality ────────────────────────────────────────────────────
  y = writeMetaLabel(ctx, y, "Confidentiality", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "All data and information provided by the Client will be treated with the utmost confidentiality and securely destroyed upon project completion. All employees are bound by our internal Non-Disclosure Agreement (NDA), which applies to all company materials. All renderings are processed offline using our in-house render farm at our London studio, ensuring maximum security and data protection.",
    { afterGap: 4 },
  );

  // ── (Notes — conditional) ──────────────────────────────────────────────────
  if (input.notes && input.notes.trim()) {
    y = writeMetaLabel(ctx, y, "Notes", { afterGap: 5 });
    y = writeBody(ctx, y, input.notes.trim(), { afterGap: 4 });
  }

  // ── 18. Signature ──────────────────────────────────────────────────────────
  y = ensureSpace(ctx, y, 50);
  y += 6;
  y = writeMetaLabel(ctx, y, "Signature", { afterGap: 5 });
  y = writeBody(
    ctx,
    y,
    "By signing below, I affirm that I have read, understood, and agreed to the terms outlined in this quotation document. A photocopy or scan of this document is as valid as the original.",
    { afterGap: 8 },
  );

  const fieldW = contentWidth / 2 - 8;
  // Manual two-column field underlines (drawHairline is full-width, so draw lines explicitly).
  const sigRow1 = ensureSpace(ctx, y, 30);
  const drawSigField = (x: number, yy: number, heading: string, value: string) => {
    pdf.setFont("Tinos", "normal");
    pdf.setFontSize(PDF_SIZE.metaLabel);
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(trackedUpper(heading), x, yy);
    pdf.setFontSize(PDF_SIZE.body);
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    if (value) pdf.text(value, x, yy + 7);
    pdf.setDrawColor(ruleLight[0], ruleLight[1], ruleLight[2]);
    pdf.setLineWidth(0.15);
    pdf.line(x, yy + 9, x + fieldW, yy + 9);
  };
  drawSigField(PDF_MARGIN.x, sigRow1, "Name", input.client_name || "");
  drawSigField(colR, sigRow1, "Position", input.client_position || "");
  const sigRow2 = sigRow1 + 18;
  drawSigField(PDF_MARGIN.x, sigRow2, "Date", "");
  drawSigField(colR, sigRow2, "Signature", "");

  // ── Footer + page numbers on every page (post-pass) ───────────────────────
  const totalPages = pdf.getNumberOfPages();
  const footerLines: string[] = pdf.splitTextToSize(FOOTER_LINE, contentWidth);
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setFont("Tinos", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    let fy = pageHeight - 12 - (footerLines.length - 1) * 3.2;
    for (const line of footerLines) {
      pdf.text(line, pageWidth / 2, fy, { align: "center" });
      fy += 3.2;
    }
    pdf.setFontSize(6.5);
    pdf.text(`Page ${p} of ${totalPages}`, pageWidth - PDF_MARGIN.x, pageHeight - 6, { align: "right" });
  }

  const out = pdf.output("arraybuffer");
  return new Uint8Array(out);
}
