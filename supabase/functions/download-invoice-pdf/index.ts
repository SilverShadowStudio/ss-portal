import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../_shared/brandLogo.ts";

type BankAccountDetails = {
  id: string;
  label: string;
  bankName: string;
  sortCode?: string;
  accountNumber?: string;
  swiftCode?: string;
  iban?: string;
};

const BANK_ACCOUNTS: Record<string, BankAccountDetails> = {
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

function getBankAccount(id?: string | null): BankAccountDetails {
  return BANK_ACCOUNTS[id || "revolut_business"] || BANK_ACCOUNTS.revolut_business;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvoiceLineItem = {
  description?: string;
  quantity?: number;
  unit_price?: number;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(status: string) {
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

function currencySymbolAscii(currency: string) {
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

function formatCurrencyPdf(amount: number, currency = "GBP") {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencySymbolAscii(currency)}${n}`;
}

function lineItemsTotal(items: InvoiceLineItem[]) {
  return items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
}

function generateInvoicePdf(invoice: {
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
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 80; // luxury letterhead margin
  const currency = invoice.currency || "GBP";

  // Color palette
  const charcoal: [number, number, number] = [38, 38, 40]; // deep charcoal, not pure black
  const muted: [number, number, number] = [120, 118, 112]; // greige muted text
  const hairline: [number, number, number] = [224, 224, 224]; // #E0E0E0 separators
  const bgCream: [number, number, number] = [247, 247, 245]; // #F7F7F5 background
  const terracotta: [number, number, number] = [176, 92, 74]; // muted coral / deep terracotta accent

  // Page background — warm off-white / greige letterhead
  doc.setFillColor(bgCream[0], bgCream[1], bgCream[2]);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // ---- Header: 'INVOICE' eyebrow + Studio wordmark ----
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setCharSpace(2.4); // simulate 0.2em wide tracking
  doc.text("INVOICE", margin, margin);
  doc.setCharSpace(0);

  // Studio brand logo — 600×91 px source, rendered ~45mm wide
  {
    const logoWidthPt = 127.6;
    const logoHeightPt = logoWidthPt * (91 / 600);
    try {
      doc.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", margin, margin + 30 - logoHeightPt, logoWidthPt, logoHeightPt);
    } catch (e) {
      console.error("[brandLogo] addImage failed:", e);
      // Fallback to text if image fails
      doc.setFont("times", "normal");
      doc.setFontSize(28);
      doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
      doc.text("Silvershadow Studio", margin, margin + 30);
    }
  }

  // ---- Meta strip (Invoice No. / Date Issued / Status) ----
  const number = invoice.invoice_number || invoice.reference_number || "—";
  const metaY = margin + 60;
  const colWidth = (pageWidth - margin * 2) / 3;

  const metaLabel = (label: string, x: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text(label.toUpperCase(), x, metaY);
    doc.setCharSpace(0);
  };
  const metaValue = (value: string, x: number, color: [number, number, number] = charcoal) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(value, x, metaY + 16);
  };

  metaLabel("Invoice No.", margin);
  metaValue(String(number), margin);

  metaLabel("Date Issued", margin + colWidth);
  metaValue(formatDate(invoice.issued_at || invoice.created_at), margin + colWidth);

  metaLabel("Status", margin + colWidth * 2);
  const isAccent = ["overdue", "draft"].includes(invoice.status);
  metaValue(statusLabel(invoice.status), margin + colWidth * 2, isAccent ? terracotta : charcoal);

  // ---- From (Silvershadow) + Billed To (Client) two-column block ----
  const billY = metaY + 60;
  const colRightX = margin + (pageWidth - margin * 2) / 2 + 10;

  const sectionLabel = (text: string, x: number, y: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text(text, x, y);
    doc.setCharSpace(0);
  };

  // FROM — Silvershadow
  sectionLabel("FROM", margin, billY);
  let fy = billY + 22;
  doc.setFont("times", "normal");
  doc.setFontSize(14);
  doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
  doc.text("Silvershadow Studio Limited", margin, fy);
  fy += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  const fromLines = [
    "332 Ladbroke Grove",
    "London, W10 5AD",
    "England, United Kingdom",
    "Company No. 09178937",
    "silvershadowstudio.com",
  ];
  fromLines.forEach((line) => {
    doc.text(line, margin, fy);
    fy += 12;
  });

  // BILLED TO — Client
  sectionLabel("BILLED TO", colRightX, billY);
  let by = billY + 22;
  const heroName = invoice.client_company || invoice.client_name;
  if (heroName) {
    doc.setFont("times", "normal");
    doc.setFontSize(14);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text(heroName, colRightX, by);
    by += 16;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(muted[0], muted[1], muted[2]);
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
    doc.text(line, colRightX, by);
    by += 12;
  });

  // Due date below the two-column block, right-aligned
  const blockBottom = Math.max(fy, by);
  if (invoice.due_date) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text("DUE", pageWidth - margin, blockBottom + 14, { align: "right" });
    doc.setCharSpace(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text(formatDate(invoice.due_date), pageWidth - margin, blockBottom + 30, { align: "right" });
  }
  // Override `by` so the table positioning calc downstream uses the lower of the two columns.
  by = blockBottom;

  // ---- Items table (paginated) ----
  const items =
    invoice.line_items.length > 0
      ? invoice.line_items
      : [{ description: "Services", quantity: 1, unit_price: invoice.amount }];

  // Geometry helpers
  // Footer hairline sits at (pageHeight - margin + 10 - 30) = pageHeight - margin - 20.
  // Allow content right up to a small visual gap above the hairline.
  const footerHairlineY = pageHeight - margin - 20;
  const safeBottom = footerHairlineY - 8;

  // Pre-measure each row so we can paginate without re-flowing.
  const rowMinHeight = 64;
  const descLineHeight = 15;
  const subLineHeight = 14;

  const measuredRows = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;
    const lineTotal = qty * unit;
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    const descLines = doc.splitTextToSize(it.description || "—", pageWidth - margin * 2 - 200);
    const hasSub = qty !== 0 || unit !== 0;
    const blockHeight = descLines.length * descLineHeight + (hasSub ? subLineHeight : 0);
    // Pad so the row keeps its luxury rhythm even for short content.
    const height = Math.max(rowMinHeight, blockHeight + 32);
    return { qty, unit, lineTotal, descLines, hasSub, height };
  });

  // Totals block measured height (so we can keep it together with the last row).
  // Breakdown: 28 gap above + 18 (subtotal→VAT) + 18 (VAT→hairline) + 14 (hairline→TOTAL DUE label) + 30 (label→grand total baseline)
  const TOTALS_HEIGHT = 28 + 18 + 18 + 14 + 30;
  const NOTES_TOP_GAP = 36;

  // Continuation-page header: minimal "INVOICE / Silvershadow Studio · No."
  const drawContinuationHeader = (): number => {
    doc.setFillColor(bgCream[0], bgCream[1], bgCream[2]);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(2.4);
    doc.text("INVOICE", margin, margin);
    doc.setCharSpace(0);

    // Continuation header — smaller logo (~30mm wide).
    {
      const logoWidthPt = 85;
      const logoHeightPt = logoWidthPt * (91 / 600);
      try {
        doc.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", margin, margin + 18 - logoHeightPt, logoWidthPt, logoHeightPt);
      } catch (e) {
        console.error("[brandLogo] addImage failed:", e);
      }
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(`No. ${number}  ·  continued`, pageWidth - margin, margin + 18, { align: "right" });

    return margin + 60; // y where the table header should be drawn next
  };

  // Draw table column header at the given y; returns y for first row top.
  const drawTableHeader = (y: number): number => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text("DESCRIPTION", margin, y);
    doc.text("AMOUNT", pageWidth - margin, y, { align: "right" });
    doc.setCharSpace(0);
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 10, pageWidth - margin, y + 10);
    return y + 10;
  };

  // Initial table position
  let tableHeaderY = Math.max(by, billY + 80) + 40;
  let rowTop = drawTableHeader(tableHeaderY);

  // Render rows with pagination
  for (let i = 0; i < measuredRows.length; i++) {
    const row = measuredRows[i];
    const isLast = i === measuredRows.length - 1;
    // Keep totals together with the last row.
    const requiredSpace = row.height + (isLast ? TOTALS_HEIGHT : 0);

    if (rowTop + requiredSpace > safeBottom) {
      doc.addPage();
      const headerY = drawContinuationHeader();
      rowTop = drawTableHeader(headerY);
    }

    // Row content
    const blockHeight = row.descLines.length * descLineHeight + (row.hasSub ? subLineHeight : 0);
    const blockTop = rowTop + (row.height - blockHeight) / 2 + descLineHeight - 4;

    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text(row.descLines, margin, blockTop, { lineHeightFactor: 1.15 });

    if (row.hasSub) {
      const subY = blockTop + (row.descLines.length - 1) * descLineHeight + subLineHeight;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text(`${row.qty} x ${formatCurrencyPdf(row.unit, currency)}`, margin, subY);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text(formatCurrencyPdf(row.lineTotal, currency), pageWidth - margin, rowTop + row.height / 2 + 4, {
      align: "right",
    });

    rowTop += row.height;

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, rowTop, pageWidth - margin, rowTop);
  }

  // ---- Totals block (right-aligned) ----
  const subtotal = Number(invoice.subtotal ?? lineItemsTotal(items));
  const vatRate = Number(invoice.vat_rate ?? 0);
  const vatAmount = Number(invoice.vat_amount ?? (subtotal * vatRate) / 100);
  const grand = Number(invoice.amount ?? subtotal + vatAmount);

  // Defensive: if totals still wouldn't fit (e.g. rows were exactly on the edge), push them to a new page.
  if (rowTop + TOTALS_HEIGHT > safeBottom) {
    doc.addPage();
    drawContinuationHeader();
    rowTop = margin + 60;
  }

  let ty = rowTop + 28;
  const labelX = pageWidth - margin - 140;
  const valueX = pageWidth - margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text("Subtotal", labelX, ty, { align: "right" });
  doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
  doc.text(formatCurrencyPdf(subtotal, currency), valueX, ty, { align: "right" });

  ty += 18;
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`VAT (${vatRate}%)`, labelX, ty, { align: "right" });
  doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
  doc.text(formatCurrencyPdf(vatAmount, currency), valueX, ty, { align: "right" });

  ty += 14;
  doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
  doc.setLineWidth(0.5);
  doc.line(labelX - 40, ty, valueX, ty);

  ty += 26;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setCharSpace(1.6);
  doc.text("TOTAL DUE", labelX, ty, { align: "right" });
  doc.setCharSpace(0);

  ty += 30;
  doc.setFont("times", "normal");
  doc.setFontSize(24);
  doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
  doc.text(formatCurrencyPdf(grand, currency), valueX, ty, { align: "right" });

  // ---- Notes (may also flow to a new page) ----
  if (invoice.notes) {
    const notesLines = doc.splitTextToSize(invoice.notes, pageWidth - margin * 2);
    const notesHeight = NOTES_TOP_GAP + notesLines.length * 13 + 16;

    if (ty + notesHeight > safeBottom) {
      doc.addPage();
      drawContinuationHeader();
      ty = margin + 60;
    } else {
      ty += NOTES_TOP_GAP;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text("NOTES", margin, ty);
    doc.setCharSpace(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text(notesLines, margin, ty + 16);
    ty += 16 + notesLines.length * 13;
  }

  // ---- Payment Details (two-column) ----
  {
    const bank = getBankAccount(invoice.bank_account);
    const PAYMENT_HEIGHT = 40 + 12 + 40 + 6 * 32; // hairline + label + gap + ~6 rows
    if (ty + PAYMENT_HEIGHT > safeBottom) {
      doc.addPage();
      drawContinuationHeader();
      ty = margin + 60;
    } else {
      ty += 40;
    }

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, ty, pageWidth - margin, ty);
    ty += 40;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.6);
    doc.text("PAYMENT DETAILS", margin, ty);
    doc.setCharSpace(0);
    ty += 24;

    const colLeftX = margin;
    const colRightX2 = margin + (pageWidth - margin * 2) / 2 + 10;

    const drawField = (label: string, value: string, x: number, y: number) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.setCharSpace(1.6);
      doc.text(label.toUpperCase(), x, y);
      doc.setCharSpace(0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
      doc.text(value, x, y + 14);
    };

    let leftY = ty;
    if (bank.bankName) { drawField("Bank Name", bank.bankName, colLeftX, leftY); leftY += 32; }
    if (bank.sortCode) { drawField("Sort Code", bank.sortCode, colLeftX, leftY); leftY += 32; }
    if (bank.accountNumber) { drawField("Account Number", bank.accountNumber, colLeftX, leftY); leftY += 32; }

    let rightY = ty;
    if (bank.swiftCode) { drawField("Swift Code", bank.swiftCode, colRightX2, rightY); rightY += 32; }
    if (bank.iban) { drawField("IBAN", bank.iban, colRightX2, rightY); rightY += 32; }

    ty = Math.max(leftY, rightY);
  }

  // ---- Footer on every page (centered, light sans + page numbers) ----
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerY = pageHeight - margin + 10;

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, footerY - 30, pageWidth - margin, footerY - 30);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(charcoal[0], charcoal[1], charcoal[2]);
    doc.text("Thank you.", pageWidth / 2, footerY - 10, { align: "center" });

    doc.setFontSize(8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setCharSpace(1.2);
    doc.text("SILVERSHADOWSTUDIO.COM", pageWidth / 2, footerY + 6, { align: "center" });
    doc.setCharSpace(0);

    if (totalPages > 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text(`${p} / ${totalPages}`, pageWidth - margin, footerY + 6, { align: "right" });
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const invoiceId = body?.invoice_id;
    if (!invoiceId || typeof invoiceId !== "string") {
      return new Response(JSON.stringify({ error: "invoice_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invoice, error: invoiceError } = await userClient
      .from("invoices")
      .select(
        "id, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, updated_at, notes, line_items, subtotal, vat_rate, vat_amount, account_id, bank_account",
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let clientCompany: string | null = null;
    let clientAddress: string | null = null;
    let clientCountry: string | null = null;
    let clientRegistration: string | null = null;
    let clientName: string | null = null;
    let clientPosition: string | null = null;
    let clientEmail: string | null = null;

    if (invoice.account_id) {
      const { data: account } = await admin
        .from("accounts")
        .select(
          "company_name, registration_number, street_name, building_number, city, postcode, country, owner_user_id",
        )
        .eq("id", invoice.account_id)
        .maybeSingle();
      if (account) {
        clientCompany = account.company_name ?? null;
        clientRegistration = account.registration_number ?? null;
        clientCountry = account.country ?? null;
        const street = [account.building_number, account.street_name].filter(Boolean).join(" ");
        const cityLine = [account.postcode, account.city].filter(Boolean).join(" ");
        clientAddress = [street, cityLine].filter(Boolean).join("\n") || null;

        if (account.owner_user_id) {
          const { data: profile } = await admin
            .from("profiles")
            .select("first_name, last_name, full_name, position")
            .eq("user_id", account.owner_user_id)
            .maybeSingle();
          if (profile) {
            clientName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.full_name || null;
            clientPosition = profile.position ?? null;
          }
          const { data: authUser } = await admin.auth.admin.getUserById(account.owner_user_id);
          clientEmail = authUser?.user?.email ?? null;
        }
      }
    }

    const items = Array.isArray(invoice.line_items) ? (invoice.line_items as InvoiceLineItem[]) : [];
    const safeNumber = String(invoice.invoice_number || invoice.reference_number || invoice.id).replace(
      /[^a-zA-Z0-9._-]+/g,
      "-",
    );
    const fileName = `invoice-${safeNumber}.pdf`;
    const storagePath = `invoice-pdfs/${invoice.id}/latest.pdf`;
    const fingerprintPath = `invoice-pdfs/${invoice.id}/fingerprint.txt`;

    // Cache check — only regenerate if the invoice has changed since last generation.
    // Fingerprint is: updated_at (or created_at) + amount + status concatenated.
    const invoiceFingerprint = `${(invoice as any).updated_at ?? invoice.created_at}|${invoice.amount}|${invoice.status}|${(invoice as any).bank_account ?? ""}`;
    let needsRegeneration = true;

    try {
      const { data: fpData } = await admin.storage.from("agreements").download(fingerprintPath);
      if (fpData) {
        const storedFingerprint = await fpData.text();
        if (storedFingerprint.trim() === invoiceFingerprint) {
          needsRegeneration = false;
          console.info("[invoice-pdf] Cache hit — serving existing PDF", { invoiceId });
        } else {
          console.info("[invoice-pdf] Cache miss — fingerprint changed, regenerating", { invoiceId });
        }
      }
    } catch {
      console.info("[invoice-pdf] No cached PDF — generating for the first time", { invoiceId });
    }

    if (needsRegeneration) {
      const pdfBytes = generateInvoicePdf({
        invoice_number: invoice.invoice_number,
        reference_number: invoice.reference_number,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        due_date: invoice.due_date,
        issued_at: invoice.issued_at,
        created_at: invoice.created_at,
        notes: invoice.notes,
        line_items: items,
        client_company: clientCompany,
        client_name: clientName,
        client_address: clientAddress,
        client_country: clientCountry,
        client_registration: clientRegistration,
        client_email: clientEmail,
        client_position: clientPosition,
        subtotal: invoice.subtotal,
        vat_rate: invoice.vat_rate,
        vat_amount: invoice.vat_amount,
        bank_account: (invoice as any).bank_account,
      });

      const { error: uploadError } = await admin.storage.from("agreements").upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

      if (uploadError) {
        return new Response(JSON.stringify({ error: uploadError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store the new fingerprint
      await admin.storage
        .from("agreements")
        .upload(fingerprintPath, new TextEncoder().encode(invoiceFingerprint), {
          contentType: "text/plain",
          upsert: true,
        });
    }

    const { data: previewSigned, error: previewError } = await admin.storage
      .from("agreements")
      .createSignedUrl(storagePath, 60);

    if (previewError || !previewSigned?.signedUrl) {
      return new Response(JSON.stringify({ error: previewError?.message || "Could not sign preview URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: downloadSigned, error: downloadError } = await admin.storage
      .from("agreements")
      .createSignedUrl(storagePath, 60, { download: fileName });

    if (downloadError || !downloadSigned?.signedUrl) {
      return new Response(JSON.stringify({ error: downloadError?.message || "Could not sign download URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ url: previewSigned.signedUrl, downloadUrl: downloadSigned.signedUrl, fileName }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
