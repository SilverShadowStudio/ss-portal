import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentAutofillDropzone } from "@/components/admin/DocumentAutofillDropzone";
import type { Overhead, VatTreatment } from "@/lib/finance";

interface Props {
  onExtracted: (defaults: Partial<Overhead>) => void;
}

/**
 * Text CTA + dropzone dialog for uploading an expense invoice. On successful
 * extraction, closes the dialog and hands mapped defaults to the parent,
 * which then opens the existing OverheadForm with those values pre-filled.
 * No file persistence — extraction only.
 */
export function OverheadUploadFlow({ onExtracted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function handleExtracted(data: Record<string, unknown>) {
    const defaults = mapExtractedToOverhead(data);
    setOpen(false);
    onExtracted(defaults);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-gold hover:underline underline-offset-4"
      >
        Upload invoice
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-lg rounded-sm border-divider bg-background"
          hideClose
        >
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
              New expense
            </p>
            <DialogTitle className="font-serif font-normal text-2xl">
              Upload invoice
            </DialogTitle>
          </DialogHeader>

          <div className="py-2">
            <DocumentAutofillDropzone
              documentType="overhead"
              onExtracted={handleExtracted}
              onLoadingChange={setBusy}
            />
            <p className="mt-3 font-sans text-[11px] text-foreground/40">
              PDF, JPEG, or PNG. We&rsquo;ll pre-fill the expense form so you
              can review before saving.
            </p>
          </div>

          <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-sm text-recessive hover:text-standard transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Extraction → OverheadForm defaults mapping ─────────────────────────────
// Claude returns the OVERHEAD_SCHEMA shape from supabase/functions/parse-document.
// Coerce defensively — nulls, strings-in-place-of-numbers, etc. all possible.

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[£$€,\s]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isoDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/**
 * Guess VAT treatment from extracted net + VAT so the form's auto-compute
 * effect doesn't clobber a zero-VAT receipt with net×20%.
 * Standard is left implicit (form default).
 */
function guessTreatment(net: number | undefined, vat: number | undefined): VatTreatment | undefined {
  if (net == null || net <= 0) return undefined;
  if (vat === 0) return "zero";
  if (vat != null && vat > 0) {
    const rate = (vat / net) * 100;
    if (rate < 2) return "zero";
    if (rate >= 3 && rate <= 7) return "reduced";
  }
  return undefined;
}

export function mapExtractedToOverhead(data: Record<string, unknown>): Partial<Overhead> {
  const net = num(data.net_total);
  const vat = num(data.vat_amount);
  const gross = num(data.gross_total);
  const explicitPaymentDate = isoDate(data.payment_date);
  const invoiceDate = isoDate(data.invoice_date);
  const dueDate = isoDate(data.due_date);
  const treatment = guessTreatment(net, vat);

  // Paid-vs-to-pay default: most overheads arrive already paid (Adobe subs,
  // Uber, receipts). Only invoices on terms (rent, workspace, utility bills)
  // are unpaid on arrival. Fred confirms on every save regardless.
  // - Explicit payment_date from the doc wins.
  // - Future due_date (dueDate > invoiceDate) → to-pay: leave blank.
  // - Otherwise → paid on the invoice date.
  let prefillPaymentDate: string | undefined;
  if (explicitPaymentDate) {
    prefillPaymentDate = explicitPaymentDate;
  } else if (invoiceDate && !(dueDate && dueDate > invoiceDate)) {
    prefillPaymentDate = invoiceDate;
  }

  const out: Partial<Overhead> = {};
  const supplier = str(data.supplier_name);
  if (supplier) out.supplier_name = supplier;
  const invNum = str(data.invoice_number);
  if (invNum) out.invoice_number = invNum;
  if (invoiceDate) out.invoice_date = invoiceDate;
  if (dueDate) out.due_date = dueDate;
  const description = str(data.description);
  if (description) out.description = description;
  if (net != null) out.net_amount = net;
  if (vat != null) out.vat_amount = vat;
  if (gross != null) out.gross_amount = gross;
  if (treatment) out.vat_treatment = treatment;
  if (prefillPaymentDate) out.payment_date = prefillPaymentDate;
  return out;
}
