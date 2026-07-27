// Server-side invoice PDF generator (V2). Native jsPDF text (selectable, not
// rasterised). Apple-on-cream design matching the signed-off template:
// centred wordmark, neutral sans (Helvetica), 3-column meta, Description block,
// Item/Amount table, Net/VAT/Total-due, Revolut payment block + Stripe button,
// and a centred studio-registration footer.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../brandLogo.ts";
import { paintPageBackground } from "../brand.ts";

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
  bank_details?: BankAccountDetails | null;
  total_due_note?: string | null;
  // Apple-design fields.
  project_name?: string | null;
  description?: string | null;
  stripe_url?: string | null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function currencySymbol(currency: string): string {
  switch (currency) {
    case "GBP": return "£"; // £
    case "EUR": return "€"; // €
    case "USD": return "$";
    default: return `${currency} `;
  }
}

function formatCurrencyPdf(amount: number, currency = "GBP"): string {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${currencySymbol(currency)}${n}`;
}

function lineItemsTotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
}

export function generateInvoicePdfV2(invoice: InvoicePdfInput): Uint8Array {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const margin = 20;
  const rightX = pageWidth - margin; // 190
  const contentW = pageWidth - margin * 2; // 170
  const currency = invoice.currency || "GBP";

  // Apple-on-cream palette.
  const ink: [number, number, number] = [29, 29, 31]; // #1D1D1F
  const muted: [number, number, number] = [134, 134, 139]; // #86868B
  const line: [number, number, number] = [216, 206, 186]; // #D8CEBA warm hairline
  const blue: [number, number, number] = [0, 113, 227]; // #0071E3
  const bgCream = "#EDE8E0";

  paintPageBackground(pdf, bgCream);

  const setT = (size: number, rgb: [number, number, number], weight: "normal" | "bold" = "normal") => {
    pdf.setFont("helvetica", weight);
    pdf.setFontSize(size);
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  };
  const hair = (y: number, x1 = margin, x2 = rightX) => {
    pdf.setDrawColor(line[0], line[1], line[2]);
    pdf.setLineWidth(0.3);
    pdf.line(x1, y, x2, y);
  };
  const deDash = (s: string) => s.replace(/\s[—–]\s/g, ", ").replace(/[—–]/g, "-");

  // ---- Logo ----
  const logoW = 58, logoH = logoW * (91 / 600);
  try {
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", (pageWidth - logoW) / 2, 30, logoW, logoH);
  } catch {
    setT(20, ink, "bold");
    pdf.text("Silvershadow Studio", pageWidth / 2, 38, { align: "center" });
  }
  hair(52);

  // ---- Meta row (Invoice | Billed to | Contact + Project) ----
  const metaY = 66;
  const c1 = margin, c2 = margin + 60, c3 = margin + 118;
  const cap = (t: string, x: number, y: number) => { setT(8, muted); pdf.text(t, x, y); };
  const kv = (label: string, value: string, x: number, y: number) => {
    setT(9, muted); pdf.text(label, x, y);
    setT(9, ink); pdf.text(value, x + 13, y);
  };

  cap("Invoice", c1, metaY);
  kv("No.", invoice.invoice_number || invoice.reference_number || "-", c1, metaY + 6.5);
  kv("Issued", formatDate(invoice.issued_at || invoice.created_at), c1, metaY + 11.5);
  kv("Due", invoice.due_date ? formatDate(invoice.due_date) : "On receipt", c1, metaY + 16.5);

  cap("Billed to", c2, metaY);
  const company = invoice.client_company || invoice.client_name || "-";
  setT(10, ink); pdf.text(deDash(company), c2, metaY + 6.5);
  setT(9, muted);
  let by = metaY + 11.5;
  const billLines: string[] = [];
  if (invoice.client_address) invoice.client_address.split("\n").forEach((l) => l && billLines.push(l));
  if (invoice.client_country) billLines.push(invoice.client_country);
  if (invoice.client_registration) billLines.push(`Reg. No. ${invoice.client_registration}`);
  billLines.forEach((l) => { pdf.text(deDash(l), c2, by); by += 4.4; });

  let cy = metaY;
  if (invoice.client_name) {
    cap("Contact", c3, cy); cy += 6.5;
    setT(10, ink); pdf.text(deDash(invoice.client_name), c3, cy); cy += 4.4;
    if (invoice.client_position) { setT(9, muted); pdf.text(deDash(invoice.client_position), c3, cy); cy += 4.4; }
    cy += 4;
  }
  if (invoice.project_name) {
    cap("Project", c3, cy); cy += 6.5;
    setT(10, ink); pdf.text(deDash(invoice.project_name), c3, cy); cy += 4.4;
  }

  let y = Math.max(by, cy, metaY + 30) + 10;

  // ---- Description ----
  if (invoice.description) {
    cap("Description", margin, y); y += 5.6;
    setT(9.5, ink);
    const lines: string[] = pdf.splitTextToSize(deDash(invoice.description), contentW);
    pdf.text(lines, margin, y, { lineHeightFactor: 1.35 });
    y += lines.length * 4.6 + 8;
  }

  // ---- Items ----
  const items = invoice.line_items.length > 0
    ? invoice.line_items
    : [{ description: "Services", quantity: 1, unit_price: invoice.amount }];
  const safeBottom = pageHeight - 40;

  const drawItemsHeader = (yy: number): number => {
    setT(8, muted); pdf.text("Item", margin, yy);
    pdf.text("Amount", rightX, yy, { align: "right" });
    hair(yy + 3);
    return yy + 3;
  };

  y = drawItemsHeader(y + 2);
  const descW = contentW - 42;
  for (const it of items) {
    const qty = Number(it.quantity) || 0, unit = Number(it.unit_price) || 0;
    const total = qty * unit;
    setT(8, ink); // item lines
    const dl: string[] = pdf.splitTextToSize(deDash(it.description || "-"), descW);
    const rowH = Math.max(9, dl.length * 3.8 + 5);
    if (y + rowH > safeBottom) { pdf.addPage(); paintPageBackground(pdf, bgCream); y = drawItemsHeader(24); }
    const textY = y + 5.3;
    setT(8, ink); pdf.text(dl, margin, textY, { lineHeightFactor: 1.2 });
    if (total === 0) {
      setT(7.2, muted); pdf.text("Included", rightX, textY, { align: "right" });
    } else {
      setT(8, ink); pdf.text(formatCurrencyPdf(total, currency), rightX, textY, { align: "right" });
    }
    y += rowH;
    hair(y);
  }

  // ---- Totals ----
  const subtotal = Number(invoice.subtotal ?? lineItemsTotal(items));
  const vatRate = Number(invoice.vat_rate ?? 0);
  const vatAmount = Number(invoice.vat_amount ?? (subtotal * vatRate) / 100);
  const grand = Number(invoice.amount ?? subtotal + vatAmount);

  if (y + 40 > safeBottom) { pdf.addPage(); paintPageBackground(pdf, bgCream); y = 24; }
  y += 10;
  const tLabelX = rightX - 44, tValX = rightX;
  setT(9.5, muted); pdf.text("Net total", tLabelX, y, { align: "right" });
  setT(9.5, ink); pdf.text(formatCurrencyPdf(subtotal, currency), tValX, y, { align: "right" });
  y += 6;
  setT(9.5, muted); pdf.text(`VAT @ ${vatRate}%`, tLabelX, y, { align: "right" });
  setT(9.5, ink); pdf.text(formatCurrencyPdf(vatAmount, currency), tValX, y, { align: "right" });
  y += 4;
  hair(y, tLabelX - 14, tValX);
  y += 7;
  setT(11, muted); pdf.text("Total due", tLabelX, y, { align: "right" });
  setT(14, ink, "bold"); pdf.text(formatCurrencyPdf(grand, currency), tValX, y, { align: "right" });
  if (invoice.total_due_note) {
    y += 5; setT(8.5, muted); pdf.text(deDash(invoice.total_due_note), tValX, y, { align: "right" });
  }

  // ---- Payment details + Stripe (left) · Terms (right) ----
  {
    const bank = invoice.bank_details || getBankAccount(invoice.bank_account);
    if (y + 52 > safeBottom) { pdf.addPage(); paintPageBackground(pdf, bgCream); y = 24; }
    y += 16;
    hair(y);
    y += 9;
    const leftX = margin, rgtX = margin + 100;
    cap("Payment details", leftX, y);
    cap("Terms", rgtX, y);
    let py = y + 6;
    const field = (label: string, value: string) => {
      setT(8.5, muted); pdf.text(label, leftX, py);
      setT(9, ink); pdf.text(value, leftX + 28, py);
      py += 5.2;
    };
    if (bank.bankName) field("Bank", bank.bankName);
    if (bank.sortCode) field("Sort code", bank.sortCode);
    if (bank.accountNumber) field("Account", bank.accountNumber);
    if (bank.swiftCode) field("SWIFT", bank.swiftCode);
    if (bank.iban) field("IBAN", bank.iban);
    field("Ref", invoice.invoice_number || invoice.reference_number || "-");

    setT(9, muted);
    const terms = pdf.splitTextToSize(
      "Payment due within 14 days. Late payment may be subject to interest under the Late Payment of Commercial Debts Act 1998.",
      contentW - 100,
    );
    pdf.text(terms, rgtX, y + 6, { lineHeightFactor: 1.35 });

    if (invoice.stripe_url) {
      const bw = 54, bh = 9, bx = leftX, byy = py + 3;
      pdf.setFillColor(blue[0], blue[1], blue[2]);
      pdf.roundedRect(bx, byy, bw, bh, 4.5, 4.5, "F");
      setT(9, [255, 255, 255], "bold");
      pdf.text("Pay online by card", bx + bw / 2, byy + bh / 2 + 1.1, { align: "center" });
      pdf.link(bx, byy, bw, bh, { url: invoice.stripe_url });
    }
  }

  // ---- Footer (every page) ----
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    hair(pageHeight - 30);
    setT(7.5, muted);
    pdf.text("Silvershadow Studio Ltd   ·   332 Ladbroke Grove, London, W10 5AD, United Kingdom", pageWidth / 2, pageHeight - 24, { align: "center" });
    pdf.text("Registered in England & Wales 9178937   ·   VAT GB 232 8467 02", pageWidth / 2, pageHeight - 19.5, { align: "center" });
    pdf.text("silvershadowstudio.com", pageWidth / 2, pageHeight - 15, { align: "center" });
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
