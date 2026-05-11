import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface InvoiceForPdf {
  invoice_number: string | null;
  reference_number: string | null;
  amount: number;
  currency?: string | null;
  status: string;
  due_date: string | null;
  issued_at?: string | null;
  created_at: string;
  notes?: string | null;
  line_items: InvoiceLineItem[];
  client_company?: string | null;
  client_name?: string | null;
  client_address?: string | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
}

export function formatCurrency(amount: number, currency = "EUR"): string {
  try {
    const locale = currency === "GBP" ? "en-GB" : currency === "EUR" ? "en-IE" : "en-US";
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function statusLabel(status: string) {
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

export function statusBadgeClasses(status: string) {
  switch (status) {
    case "paid":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "sent":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "overdue":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "draft":
      return "bg-muted text-muted-foreground";
    case "cancelled":
      return "bg-muted text-muted-foreground line-through";
    default:
      return "bg-[#181613] text-gold-muted";
  }
}

export function lineItemsTotal(items: InvoiceLineItem[]) {
  return items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
}

export async function generateInvoicePdf(sourceElement: HTMLElement, fileName?: string) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const previousHeight = sourceElement.style.height;
  const previousOverflow = sourceElement.style.overflow;
  sourceElement.style.height = "1123px";
  sourceElement.style.overflow = "hidden";

  const canvas = await html2canvas(sourceElement, {
    scale: 3,
    useCORS: true,
    backgroundColor: "#D9D3C4",
    width: sourceElement.scrollWidth,
    height: 1123,
  });

  sourceElement.style.height = previousHeight;
  sourceElement.style.overflow = previousOverflow;

  const doc = new jsPDF({ orientation: "portrait", format: "a4", unit: "pt" });
  const imageData = canvas.toDataURL("image/jpeg", 1.0);
  doc.addImage(imageData, "JPEG", 0, 0, 595.28, 841.89);

  doc.save(fileName || "invoice.pdf");

  return {
    blob: null,
    blobUrl: null,
    fileName: fileName || "invoice.pdf",
    openInNewTab: () => undefined,
  };
}

export async function downloadInvoicePdfFromBackend(invoiceId: string) {
  console.log("[invoice-download] opening diagnostic tab");
  const popup = window.open("", "_blank", "noopener,noreferrer");

  if (popup) {
    try {
      popup.document.title = "Preparing invoice PDF…";
    } catch {
      console.warn("[invoice-download] could not update popup title before navigation");
    }
  } else {
    console.warn("[invoice-download] popup was blocked before route call");
  }

  console.log("[invoice-download] invoking download-invoice-pdf", { invoiceId });
  const { data, error } = await supabase.functions.invoke("download-invoice-pdf", {
    body: { invoice_id: invoiceId },
  });

  if (error) {
    console.error("[invoice-download] route call failed", error);
    popup?.close();
    throw error;
  }

  console.log("[invoice-download] route response received", data);
  const openUrl = data?.downloadUrl || data?.url;
  if (!openUrl) {
    console.error("[invoice-download] route returned no URL", data);
    popup?.close();
    throw new Error(data?.error || "No download URL returned");
  }

  console.log("[invoice-download] opening PDF URL in popup", { openUrl });
  if (popup) {
    popup.location.href = openUrl;
  } else {
    const fallbackPopup = window.open(openUrl, "_blank", "noopener,noreferrer");
    if (!fallbackPopup) {
      console.error("[invoice-download] popup blocked when opening final PDF URL", { openUrl });
      throw new Error("Popup blocked while opening the PDF");
    }
  }

  return {
    fileName: data.fileName as string | undefined,
    url: openUrl as string,
  };
}
