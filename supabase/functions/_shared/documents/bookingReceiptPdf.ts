// Booking receipt PDF generator. Shares the design tokens + rendering
// primitives + embedded Tinos font with the v3 client agreement and team
// engagement contract so all studio documents look identical. Bundled Tinos
// (SIL OFL) — never Microsoft Georgia.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../brandLogo.ts";
import { paintPageBackground } from "../brand.ts";
import type { DocumentDesignConfig } from "../pdfUtils.ts";
import { STUDIO_PARTY } from "../agreements/common.ts";
import { hexToRgb, PDF_MARGIN, PDF_SIZE } from "./designTokens.ts";
import {
  type PdfContext,
  drawCoverLogo,
  drawGoldHairline,
  drawMutedHairline,
  ensureSpace,
  writeBody,
  writeMetaLabel,
} from "./pdfPrimitives.ts";
import { TINOS_BOLD_B64, TINOS_ITALIC_B64, TINOS_REGULAR_B64 } from "./tinosFonts.ts";

export interface BookingReceiptData {
  receiptNumber: string;
  paidAt?: string | null;
  accountName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  projectName?: string | null;
  sceneName?: string | null;
  lineItems: { roundNumber: number; fee: number }[];
  subtotal: number;
  vat: number;
  gross: number;
  discount: number;
  amountCharged: number;
  amountOutstanding: number;
  paymentOptionLabel: string;
  stripePaymentIntentId?: string | null;
  currency?: string;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

function money(amount: number, currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;
  return `${sym}${(amount || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateBookingReceiptPdf(data: BookingReceiptData, design: DocumentDesignConfig): Uint8Array {
  const currency = data.currency || "GBP";
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  // Register Tinos so the primitives' setFont calls render with full coverage.
  pdf.addFileToVFS("Tinos-Regular.ttf", TINOS_REGULAR_B64);
  pdf.addFont("Tinos-Regular.ttf", "Tinos", "normal");
  pdf.addFileToVFS("Tinos-Bold.ttf", TINOS_BOLD_B64);
  pdf.addFont("Tinos-Bold.ttf", "Tinos", "bold");
  pdf.addFileToVFS("Tinos-Italic.ttf", TINOS_ITALIC_B64);
  pdf.addFont("Tinos-Italic.ttf", "Tinos", "italic");

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ctx: PdfContext = {
    pdf,
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PDF_MARGIN.x * 2,
    ink: hexToRgb(design.warm_black),
    muted: hexToRgb(design.warm_grey),
    gold: hexToRgb(design.gold),
    bodyFont: "Tinos",
    metaFont: "Tinos",
    backgroundColor: design.background_color,
  };
  const rightX = pageWidth - PDF_MARGIN.x;

  // Right-aligned amount on the same line as a left label. Advances the cursor.
  const lineItem = (y: number, label: string, amount: string, opts?: { bold?: boolean; italic?: boolean; rgb?: [number, number, number]; gap?: number }) => {
    const yy = ensureSpace(ctx, y, 6);
    const [r, g, b] = opts?.rgb ?? ctx.ink;
    pdf.setFontSize(PDF_SIZE.body);
    pdf.setFont("Tinos", opts?.bold ? "bold" : opts?.italic ? "italic" : "normal");
    pdf.setTextColor(r, g, b);
    pdf.text(label, PDF_MARGIN.x, yy);
    pdf.text(amount, rightX, yy, { align: "right" });
    return yy + (opts?.gap ?? 6);
  };

  paintPageBackground(pdf, design.background_color);

  let y = PDF_MARGIN.top;
  y = drawCoverLogo(ctx, y, SILVERSHADOW_LOGO_DATA_URL);

  // Studio header.
  y = writeMetaLabel(ctx, y, STUDIO_PARTY.legalName, { afterGap: 4 });
  const studioLines = [
    STUDIO_PARTY.country ? `Registered in ${STUDIO_PARTY.country}` : null,
    STUDIO_PARTY.registrationNumber ? `Company no. ${STUDIO_PARTY.registrationNumber}` : null,
    STUDIO_PARTY.registeredAddress || null,
  ].filter(Boolean) as string[];
  for (const line of studioLines) y = writeBody(ctx, y, line, { size: 9, rgb: ctx.muted, afterGap: 0.5 });

  y += 6;
  drawGoldHairline(ctx, y);
  y += 8;

  // Title + receipt meta.
  pdf.setFontSize(PDF_SIZE.certHeading);
  pdf.setFont("Tinos", "bold");
  pdf.setTextColor(ctx.ink[0], ctx.ink[1], ctx.ink[2]);
  y = ensureSpace(ctx, y, 10);
  pdf.text("BOOKING RECEIPT", PDF_MARGIN.x, y);
  y += 9;
  y = writeBody(ctx, y, `Receipt ${data.receiptNumber}`, { size: 9.5, rgb: ctx.muted, afterGap: 0.5 });
  y = writeBody(ctx, y, `Date paid: ${fmtDate(data.paidAt)}`, { size: 9.5, rgb: ctx.muted, afterGap: 6 });

  // Client + project blocks.
  y = writeMetaLabel(ctx, y, "Billed to", { afterGap: 4 });
  y = writeBody(ctx, y, data.accountName, { afterGap: 0.5 });
  if (data.contactName) y = writeBody(ctx, y, data.contactName, { size: 9.5, rgb: ctx.muted, afterGap: 0.5 });
  if (data.contactEmail) y = writeBody(ctx, y, data.contactEmail, { size: 9.5, rgb: ctx.muted, afterGap: 6 });

  if (data.projectName || data.sceneName) {
    y = writeMetaLabel(ctx, y, "Production", { afterGap: 4 });
    y = writeBody(ctx, y, [data.projectName, data.sceneName].filter(Boolean).join(" — "), { afterGap: 6 });
  }

  // Line items.
  drawMutedHairline(ctx, y);
  y += 6;
  for (const li of data.lineItems) {
    const sceneSuffix = data.sceneName ? ` — ${data.sceneName}` : "";
    y = lineItem(y, `Round ${String(li.roundNumber).padStart(2, "0")}${sceneSuffix}`, money(li.fee, currency));
  }
  y += 1;
  drawMutedHairline(ctx, y);
  y += 6;

  // Totals.
  y = lineItem(y, "Subtotal (net)", money(data.subtotal, currency), { rgb: ctx.muted });
  y = lineItem(y, "VAT (20%)", money(data.vat, currency), { rgb: ctx.muted });
  y = lineItem(y, "Gross total", money(data.gross, currency), { bold: true });
  if (data.discount > 0) {
    y = lineItem(y, "Full-payment discount (3%)", `− ${money(data.discount, currency)}`, { italic: true, rgb: ctx.muted });
  }
  y += 2;
  drawGoldHairline(ctx, y);
  y += 7;
  y = lineItem(y, "Amount paid (card via Stripe)", money(data.amountCharged, currency), { bold: true, rgb: ctx.gold });
  if (data.amountOutstanding > 0) {
    y = lineItem(y, "Outstanding (50% on delivery, net 15)", money(data.amountOutstanding, currency), { rgb: ctx.muted });
  }
  y += 4;

  // Payment meta + footer.
  y = writeBody(ctx, y, `Payment option: ${data.paymentOptionLabel}`, { size: 9, rgb: ctx.muted, afterGap: 0.5 });
  if (data.stripePaymentIntentId) {
    y = writeBody(ctx, y, `Stripe payment reference: ${data.stripePaymentIntentId}`, { size: 8.5, rgb: ctx.muted, afterGap: 6 });
  }
  drawMutedHairline(ctx, y);
  y += 7;
  y = writeBody(ctx, y, "Thank you for your booking. Production will commence as scheduled.", { rgb: ctx.muted, italic: true });

  return new Uint8Array(pdf.output("arraybuffer"));
}
