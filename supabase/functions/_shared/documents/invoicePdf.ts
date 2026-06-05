// Server-side invoice PDF generator (V2). Native jsPDF text (selectable, not
// rasterised) with continuation-aware pagination, sharing the Silvershadow PDF
// infrastructure with quotationPdf.ts / agreementPdfV3.ts (./designTokens.ts,
// ./pdfPrimitives.ts) and the embedded Tinos font (./tinosFonts.ts) for full
// Unicode coverage of UK/EU client names and addresses.
//
// Intentionally a different visual language from the quotation: this preserves
// the approved Pass-1/Pass-2 invoice visuals — warm greige ground, top-right
// architectural illustration, centred INVOICE eyebrow + wordmark, status colour
// pill, gold display TOTAL DUE, INCLUDED treatment for zero-amount lines,
// "Thank you." + confidentiality footer, and the minimal continuation header.
// Only the engine (mm units, Tinos, shared primitives) is shared.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../brandLogo.ts";
import { pngBytesToDataUrl } from "../imageUtils.ts";
import { paintPageBackground } from "../brand.ts";
import { PDF_MARGIN } from "./designTokens.ts";
import { drawHairline, type PdfContext } from "./pdfPrimitives.ts";
import { TINOS_BOLD_B64, TINOS_ITALIC_B64, TINOS_REGULAR_B64 } from "./tinosFonts.ts";

// Architectural illustration (cornice detail) shared with the invitation email
// and agreement documents — the consistent brand thread across documents.
const ILLUSTRATION_URL =
  "https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/portal-invite-illustration.png";

export async function fetchIllustrationDataUrl(): Promise<string | undefined> {
  try {
    const res = await fetch(ILLUSTRATION_URL);
    if (!res.ok) return undefined;
    return pngBytesToDataUrl(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    console.error("[illustration] fetch failed:", e);
    return undefined;
  }
}

export type BankAccountDetails = {
  id?: string;
  label?: string;
  bankName: string;
  sortCode?: string;
  accountNumber?: string;
  swiftCode?: string;
  iban?: string;
};

export const BANK_ACCOUNTS: Record<string, BankAccountDetails> = {
  revolut_business: {
    id: "revolut_business",
    label: "Revolut Business",
    bankName: "Revolut",
    sortCode: "04-00-75",
    accountNumber: "75 91 35 42",
    swiftCode: "REVOGB21",
    iban: "GB91 REVO 0099 6974 0692 71",
  },
};

export function getBankAccount(id?: string | null): BankAccountDetails {
  return BANK_ACCOUNTS[id || "revolut_business"] || BANK_ACCOUNTS.revolut_business;
}

export interface InvoiceLineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
}

export interface InvoicePdfInput {
  invoice_number: string | null;
  reference_number: string | null;
  amount: number;
  currency: string | null;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  created_at: string;
  notes: string | null;
  line_items: InvoiceLineItem[];
  client_company?: string | null;
  client_name?: string | null;
  client_address?: string | null;
  client_registration?: string | null;
  client_country?: string | null;
  client_email?: string | null;
  client_position?: string | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  bank_account?: string | null;
  // Explicit bank details (Generator one-offs); falls back to bank_account key.
  bank_details?: BankAccountDetails | null;
  // Small muted sub-line under TOTAL DUE (e.g. downpayment / balance). TOTAL DUE
  // itself always reflects the gross total.
  total_due_note?: string | null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    sent: "Sent",
    paid: "Paid",
    overdue: "Overdue",
    pending: "Pending",
    cancelled: "Cancelled",
  };
  return map[status] || status;
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

function formatCurrencyPdf(amount: number, currency = "GBP"): string {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${currencySymbolAscii(currency)}${n}`;
}

function lineItemsTotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
}

// pt → mm for char-spacing values (jsPDF char space is in the current unit).
const cs = (pt: number): number => pt * 0.352778;

export function generateInvoicePdfV2(invoice: InvoicePdfInput, illustrationDataUrl?: string): Uint8Array {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  // Register Tinos (normal/bold/italic) for Unicode-capable client names.
  pdf.addFileToVFS("Tinos-Regular.ttf", TINOS_REGULAR_B64);
  pdf.addFont("Tinos-Regular.ttf", "Tinos", "normal");
  pdf.addFileToVFS("Tinos-Bold.ttf", TINOS_BOLD_B64);
  pdf.addFont("Tinos-Bold.ttf", "Tinos", "bold");
  pdf.addFileToVFS("Tinos-Italic.ttf", TINOS_ITALIC_B64);
  pdf.addFont("Tinos-Italic.ttf", "Tinos", "italic");

  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const margin = PDF_MARGIN.x; // 28
  const contentWidth = pageWidth - margin * 2; // 154
  const currency = invoice.currency || "GBP";

  // Palette — aligned to the Silvershadow document design system.
  const charcoal: [number, number, number] = [26, 24, 20]; // #1A1814 body dark
  const muted: [number, number, number] = [120, 118, 112]; // greige muted
  const hairline: [number, number, number] = [224, 224, 224]; // #E0E0E0 separators
  const bgCream = "#EDE8E0"; // warm greige ground
  const gold: [number, number, number] = [184, 154, 106]; // #B89A6A brand gold
  const goldMuted: [number, number, number] = [138, 128, 112]; // #8A8070 muted gold
  const burntSienna: [number, number, number] = [138, 74, 42]; // #8A4A2A overdue

  // Status accent colour — Draft (muted gold), Issued/Sent (body dark),
  // Paid (full gold), Overdue (burnt sienna); pending/cancelled mapped within
  // the same palette.
  const statusColor = (status: string): [number, number, number] => {
    switch (status) {
      case "draft":
        return goldMuted;
      case "sent":
        return charcoal;
      case "paid":
        return gold;
      case "overdue":
        return burntSienna;
      case "pending":
        return goldMuted;
      case "cancelled":
        return muted;
      default:
        return charcoal;
    }
  };

  // ensureSpace (shared) cuts content off at ctx.pageHeight - PDF_MARGIN.bottom;
  // reserving 6mm keeps body content clear of the registered footer below.
  const ctx: PdfContext = {
    pdf,
    pageWidth,
    pageHeight: pageHeight - 6,
    contentWidth,
    ink: charcoal,
    muted,
    gold,
    bodyFont: "Tinos",
    metaFont: "Tinos",
    backgroundColor: bgCream,
  };

  const setT = (size: number, rgb: [number, number, number], weight: "normal" | "bold" = "normal") => {
    pdf.setFont("Tinos", weight);
    pdf.setFontSize(size);
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  };

  paintPageBackground(pdf, bgCream);

  // ---- Architectural illustration — top-right corner, page 1 only ----
  if (illustrationDataUrl) {
    const illoSize = 38;
    try {
      pdf.addImage(illustrationDataUrl, "PNG", pageWidth - 12 - illoSize, 10, illoSize, illoSize);
    } catch (e) {
      console.error("[illustration] addImage failed:", e);
    }
  }

  // ---- Header: centred INVOICE eyebrow above the centred wordmark ----
  setT(8, muted);
  pdf.setCharSpace(cs(2.4));
  pdf.text("INVOICE", pageWidth / 2, 24, { align: "center" });
  pdf.setCharSpace(0);

  {
    const logoW = 50;
    const logoH = logoW * (91 / 600);
    try {
      pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", (pageWidth - logoW) / 2, 28, logoW, logoH);
    } catch (e) {
      console.error("[brandLogo] addImage failed:", e);
      setT(24, charcoal);
      pdf.text("Silvershadow Studio", pageWidth / 2, 36, { align: "center" });
    }
  }

  // ---- Meta strip (Invoice No. / Date Issued / Status) ----
  const number = invoice.invoice_number || invoice.reference_number || "—";
  const metaY = 62;
  const colW = contentWidth / 3;

  const metaLabel = (label: string, x: number) => {
    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text(label.toUpperCase(), x, metaY);
    pdf.setCharSpace(0);
  };
  const metaValue = (value: string, x: number, rgb: [number, number, number] = charcoal) => {
    setT(11, rgb);
    pdf.text(value, x, metaY + 5.6);
  };

  metaLabel("Invoice No.", margin);
  metaValue(String(number), margin);
  metaLabel("Date Issued", margin + colW);
  metaValue(formatDate(invoice.issued_at || invoice.created_at), margin + colW);
  metaLabel("Status", margin + colW * 2);
  metaValue(statusLabel(invoice.status), margin + colW * 2, statusColor(invoice.status));

  // ---- From (Silvershadow) + Billed To (Client) two-column block ----
  const billY = metaY + 21;
  const colRightX = margin + contentWidth / 2 + 4;

  const sectionLabel = (text: string, x: number, y: number) => {
    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text(text, x, y);
    pdf.setCharSpace(0);
  };

  // FROM — Silvershadow
  sectionLabel("FROM", margin, billY);
  let fy = billY + 7.8;
  setT(14, charcoal);
  pdf.text("Silvershadow Studio Limited", margin, fy);
  fy += 5.6;
  setT(9.5, muted);
  ["332 Ladbroke Grove", "London, W10 5AD", "England, United Kingdom", "Company No. 09178937", "silvershadowstudio.com"]
    .forEach((line) => {
      pdf.text(line, margin, fy);
      fy += 4.2;
    });

  // BILLED TO — Client (client contact / attention folded in)
  sectionLabel("BILLED TO", colRightX, billY);
  let by = billY + 7.8;
  const heroName = invoice.client_company || invoice.client_name;
  if (heroName) {
    setT(14, charcoal);
    pdf.text(heroName, colRightX, by);
    by += 5.6;
  }
  setT(9.5, muted);
  const clientLines: string[] = [];
  if (invoice.client_address) {
    invoice.client_address.split("\n").forEach((l) => l && clientLines.push(l));
  }
  if (invoice.client_country) clientLines.push(invoice.client_country);
  if (invoice.client_registration) clientLines.push(`Reg. No. ${invoice.client_registration}`);
  if (invoice.client_company && invoice.client_name) {
    clientLines.push("");
    clientLines.push(
      invoice.client_position ? `${invoice.client_name} — ${invoice.client_position}` : invoice.client_name,
    );
  }
  if (invoice.client_email) clientLines.push(invoice.client_email);
  clientLines.forEach((line) => {
    pdf.text(line, colRightX, by);
    by += 4.2;
  });

  // Due date below the two-column block, right-aligned
  const blockBottom = Math.max(fy, by);
  if (invoice.due_date) {
    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text("DUE", pageWidth - margin, blockBottom + 5, { align: "right" });
    pdf.setCharSpace(0);
    setT(11, charcoal);
    pdf.text(formatDate(invoice.due_date), pageWidth - margin, blockBottom + 10.6, { align: "right" });
  }
  by = blockBottom;

  // ---- Items table (paginated) ----
  const items =
    invoice.line_items.length > 0
      ? invoice.line_items
      : [{ description: "Services", quantity: 1, unit_price: invoice.amount }];

  const safeBottom = ctx.pageHeight - PDF_MARGIN.bottom; // 261
  const rowMinHeight = 22;
  const descLineHeight = 5.3;
  const subLineHeight = 4.9;
  const descW = contentWidth - 60; // reserve right column for amount

  const measuredRows = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;
    const lineTotal = qty * unit;
    setT(12, charcoal);
    const descLines: string[] = pdf.splitTextToSize(it.description || "—", descW);
    const included = lineTotal === 0;
    const hasSub = !included && (qty !== 0 || unit !== 0);
    const blockHeight = descLines.length * descLineHeight + (hasSub ? subLineHeight : 0);
    const height = Math.max(rowMinHeight, blockHeight + 11);
    return { qty, unit, lineTotal, descLines, hasSub, included, height };
  });

  const TOTALS_HEIGHT = 48;
  const NOTES_TOP_GAP = 12.7;

  // Continuation-page header: minimal INVOICE eyebrow + small logo + "No. … continued".
  const drawContinuationHeader = (): number => {
    paintPageBackground(pdf, bgCream);
    setT(8, muted);
    pdf.setCharSpace(cs(2.4));
    pdf.text("INVOICE", margin, 14);
    pdf.setCharSpace(0);
    {
      const logoW = 30;
      const logoH = logoW * (91 / 600);
      try {
        pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", margin, 16, logoW, logoH);
      } catch (e) {
        console.error("[brandLogo] addImage failed:", e);
      }
    }
    setT(9, muted);
    pdf.text(`No. ${number}  ·  continued`, pageWidth - margin, 14, { align: "right" });
    return 30;
  };

  const drawTableHeader = (y: number): number => {
    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text("DESCRIPTION", margin, y);
    pdf.text("AMOUNT", pageWidth - margin, y, { align: "right" });
    pdf.setCharSpace(0);
    drawHairline(ctx, y + 3.5, hairline, 0.18);
    return y + 3.5;
  };

  let tableHeaderY = Math.max(by, billY + 28) + 14;
  let rowTop = drawTableHeader(tableHeaderY);

  for (let i = 0; i < measuredRows.length; i++) {
    const row = measuredRows[i];
    const isLast = i === measuredRows.length - 1;
    const requiredSpace = row.height + (isLast ? TOTALS_HEIGHT : 0);

    if (rowTop + requiredSpace > safeBottom) {
      pdf.addPage();
      rowTop = drawTableHeader(drawContinuationHeader());
    }

    const blockHeight = row.descLines.length * descLineHeight + (row.hasSub ? subLineHeight : 0);
    const blockTop = rowTop + (row.height - blockHeight) / 2 + descLineHeight - 1.4;

    setT(12, charcoal);
    pdf.text(row.descLines, margin, blockTop, { lineHeightFactor: 1.15 });

    if (row.hasSub) {
      const subY = blockTop + (row.descLines.length - 1) * descLineHeight + subLineHeight;
      setT(9, muted);
      pdf.text(`${row.qty} x ${formatCurrencyPdf(row.unit, currency)}`, margin, subY);
    }

    if (row.included) {
      setT(8, muted);
      pdf.setCharSpace(cs(1.6));
      pdf.text("INCLUDED", pageWidth - margin, rowTop + row.height / 2 + 1.4, { align: "right" });
      pdf.setCharSpace(0);
    } else {
      setT(12, charcoal);
      pdf.text(formatCurrencyPdf(row.lineTotal, currency), pageWidth - margin, rowTop + row.height / 2 + 1.4, {
        align: "right",
      });
    }

    rowTop += row.height;
    drawHairline(ctx, rowTop, hairline, 0.18);
  }

  // ---- Totals block (right-aligned) ----
  const subtotal = Number(invoice.subtotal ?? lineItemsTotal(items));
  const vatRate = Number(invoice.vat_rate ?? 0);
  const vatAmount = Number(invoice.vat_amount ?? (subtotal * vatRate) / 100);
  const grand = Number(invoice.amount ?? subtotal + vatAmount);

  if (rowTop + TOTALS_HEIGHT > safeBottom) {
    pdf.addPage();
    drawContinuationHeader();
    rowTop = 30;
  }

  let ty = rowTop + 10;
  const labelX = pageWidth - margin - 50;
  const valueX = pageWidth - margin;

  setT(10, muted);
  pdf.text("Subtotal", labelX, ty, { align: "right" });
  setT(10, charcoal);
  pdf.text(formatCurrencyPdf(subtotal, currency), valueX, ty, { align: "right" });

  ty += 6.3;
  setT(10, muted);
  pdf.text(`VAT (${vatRate}%)`, labelX, ty, { align: "right" });
  setT(10, charcoal);
  pdf.text(formatCurrencyPdf(vatAmount, currency), valueX, ty, { align: "right" });

  ty += 5;
  // Gold accent rule beneath the breakdown — draws the eye to the total due.
  pdf.setDrawColor(gold[0], gold[1], gold[2]);
  pdf.setLineWidth(0.22);
  pdf.line(labelX - 14, ty, valueX, ty);

  ty += 9;
  setT(7.5, muted);
  pdf.setCharSpace(cs(1.6));
  pdf.text("TOTAL DUE", labelX, ty, { align: "right" });
  pdf.setCharSpace(0);

  ty += 10.6;
  setT(28, gold);
  pdf.text(formatCurrencyPdf(grand, currency), valueX, ty, { align: "right" });

  // Optional sub-line under the gross total (downpayment / balance).
  if (invoice.total_due_note) {
    ty += 5;
    setT(8.5, muted);
    pdf.text(invoice.total_due_note, valueX, ty, { align: "right" });
  }

  // ---- Notes (may also flow to a new page) ----
  if (invoice.notes) {
    const notesLines: string[] = pdf.splitTextToSize(invoice.notes, contentWidth);
    const notesHeight = NOTES_TOP_GAP + notesLines.length * 4.6 + 5.6;

    if (ty + notesHeight > safeBottom) {
      pdf.addPage();
      drawContinuationHeader();
      ty = 30;
    } else {
      ty += NOTES_TOP_GAP;
    }

    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text("NOTES", margin, ty);
    pdf.setCharSpace(0);
    setT(10, charcoal);
    pdf.text(notesLines, margin, ty + 5.6);
    ty += 5.6 + notesLines.length * 4.6;
  }

  // ---- Payment Details (two-column) ----
  {
    const bank = invoice.bank_details || getBankAccount(invoice.bank_account);
    const PAYMENT_HEIGHT = 60;
    if (ty + PAYMENT_HEIGHT > safeBottom) {
      pdf.addPage();
      drawContinuationHeader();
      ty = 30;
    } else {
      ty += 14;
    }

    drawHairline(ctx, ty, hairline, 0.18);
    ty += 14;

    setT(7.5, muted);
    pdf.setCharSpace(cs(1.6));
    pdf.text("PAYMENT DETAILS", margin, ty);
    pdf.setCharSpace(0);
    ty += 8.5;

    const colLeftX = margin;
    const colRightX2 = margin + contentWidth / 2 + 4;

    const drawField = (label: string, value: string, x: number, y: number) => {
      setT(7.5, muted);
      pdf.setCharSpace(cs(1.6));
      pdf.text(label.toUpperCase(), x, y);
      pdf.setCharSpace(0);
      setT(10, charcoal);
      pdf.text(value, x, y + 4.9);
    };

    let leftY = ty;
    if (bank.bankName) {
      drawField("Bank Name", bank.bankName, colLeftX, leftY);
      leftY += 11.3;
    }
    if (bank.sortCode) {
      drawField("Sort Code", bank.sortCode, colLeftX, leftY);
      leftY += 11.3;
    }
    if (bank.accountNumber) {
      drawField("Account Number", bank.accountNumber, colLeftX, leftY);
      leftY += 11.3;
    }

    let rightY = ty;
    if (bank.swiftCode) {
      drawField("Swift Code", bank.swiftCode, colRightX2, rightY);
      rightY += 11.3;
    }
    if (bank.iban) {
      drawField("IBAN", bank.iban, colRightX2, rightY);
      rightY += 11.3;
    }

    ty = Math.max(leftY, rightY);
  }

  // ---- Footer on every page (centred, Tinos + page numbers) ----
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);

    drawHairline(ctx, 262, hairline, 0.18);

    setT(9, charcoal);
    pdf.text("Thank you.", pageWidth / 2, 268, { align: "center" });

    setT(6.5, muted);
    pdf.setCharSpace(cs(0.8));
    pdf.text(
      "Confidential — intended solely for the named recipient.   ·   Silvershadow Studio Limited   ·   silvershadowstudio.com",
      pageWidth / 2,
      272,
      { align: "center" },
    );
    pdf.setCharSpace(0);

    if (totalPages > 1) {
      setT(8, muted);
      pdf.text(`${p} / ${totalPages}`, pageWidth - margin, 268, { align: "right" });
    }
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
