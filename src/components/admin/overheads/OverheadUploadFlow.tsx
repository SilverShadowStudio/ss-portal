import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentAutofillDropzone } from "@/components/admin/DocumentAutofillDropzone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import type { ExpenseCategory, Overhead, VatTreatment } from "@/lib/finance";
import { useMemo } from "react";

const STAGING_BUCKET = "overhead-invoices";

interface Props {
  onExtracted: (defaults: Partial<Overhead>) => void;
  /** Passed through to parse-document so Claude can auto-pick the best-fit
   *  category from Fred's real chart of accounts. Also used to defensively
   *  drop any bogus code Claude might return. */
  categories: ExpenseCategory[];
}

/**
 * Text CTA + dropzone dialog for uploading an expense invoice. Flow:
 *  1. Drop → Claude extracts fields via parse-document.
 *  2. Original file uploaded to the `overhead-invoices` bucket at
 *     `staging/{uuid}.{ext}` so it survives the review gate (tab close,
 *     browser crash, etc.).
 *  3. Defaults + staging_storage_path handed to the parent, which opens
 *     OverheadForm pre-filled. Parent is responsible for cleanup on cancel.
 */
export function OverheadUploadFlow({ onExtracted, categories }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [staging, setStaging] = useState(false);
  const { toast } = useToast();

  // Memoised so the DocumentAutofillDropzone doesn't see a fresh reference
  // on every render (its handleFile depends on extraBody). Only the active
  // codes are shipped to Claude — no need to offer soft-hidden categories.
  const extraBody = useMemo(
    () => ({
      categories: categories
        .filter((c) => c.active)
        .map((c) => ({ code: c.code, name: c.name })),
    }),
    [categories],
  );

  async function handleExtracted(data: Record<string, unknown>, file: File) {
    // Upload the original file to Storage BEFORE handing to the review form,
    // so the file survives the review gate even if Fred closes the tab.
    setStaging(true);
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const stagingPath = `staging/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(STAGING_BUCKET)
      .upload(stagingPath, file, {
        contentType: file.type,
        upsert: false,
      });
    setStaging(false);

    if (upErr) {
      toast({
        title: "Couldn't save the file — please try again",
        description: upErr.message,
        variant: "destructive",
      });
      return; // dialog stays open for retry; no cleanup needed (nothing uploaded)
    }

    const defaults = mapExtractedToOverhead(data);
    defaults.staging_storage_path = stagingPath;

    // Category precedence, weakest → strongest:
    //   (a) AI's pick from mapExtractedToOverhead — used as-is only if it
    //       matches a real code in the active chart of accounts (defense
    //       against hallucinated codes).
    //   (b) Supplier→category memory — Fred's prior manual pick wins over
    //       AI. Same-supplier consistency matters more than fresh guessing.
    const activeCodes = new Set(categories.filter((c) => c.active).map((c) => c.code));
    if (defaults.category_code && !activeCodes.has(defaults.category_code)) {
      delete defaults.category_code;
    }
    if (defaults.supplier_name) {
      const key = normalizeSupplier(defaults.supplier_name);
      if (key) {
        const { data: mapping } = await supabase
          .from("supplier_category_map" as any)
          .select("category_code")
          .eq("supplier_normalized", key)
          .maybeSingle();
        const cat = (mapping as { category_code?: string } | null)?.category_code;
        if (cat && activeCodes.has(cat)) defaults.category_code = cat;
      }
    }

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
              extraBody={extraBody}
              disabled={staging}
            />
            {staging ? (
              <p className="mt-3 font-sans text-[11px] text-gold/70 animate-pulse">
                Saving your invoice&hellip;
              </p>
            ) : (
              <p className="mt-3 font-sans text-[11px] text-foreground/40">
                PDF, JPEG, or PNG. We&rsquo;ll pre-fill the expense form so you
                can review before saving.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy || staging}
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
 * Guess VAT treatment from the enforced net (gross − vat) and vat_amount.
 * Ratios reflect the studio's actual charge structure:
 *   - vat = 0                 → zero
 *   - vat/net ≈ 20% (standard)→ standard
 *   - vat/net ≈ 5% (reduced)  → reduced
 *   - otherwise, vat > 0      → mixed (partial-VAT invoice — e.g. food
 *     delivery with zero-rated food + standard-rated service fee)
 * "Mixed" tells the form's auto-compute effect to leave the extracted
 * vat_amount alone rather than overwriting with net × rate.
 */
function guessTreatment(net: number | undefined, vat: number | undefined): VatTreatment | undefined {
  if (net == null || net <= 0) return undefined;
  if (vat == null || vat < 0) return undefined;
  if (vat === 0) return "zero";
  const ratePct = (vat / net) * 100;
  if (ratePct >= 19 && ratePct <= 21) return "standard";
  if (ratePct >= 4.5 && ratePct <= 5.5) return "reduced";
  return "mixed";
}

export function mapExtractedToOverhead(data: Record<string, unknown>): Partial<Overhead> {
  const rawNet = num(data.net_total);
  const vat = num(data.vat_amount);
  const gross = num(data.gross_total);
  const explicitPaymentDate = isoDate(data.payment_date);
  const invoiceDate = isoDate(data.invoice_date);
  const dueDate = isoDate(data.due_date);

  // Enforce net = gross − vat when we have both. The prompt tells Claude to
  // compute it this way, but this is the safety net if the returned net
  // doesn't reconcile (mixed-VAT invoices like Deliveroo where only part
  // is standard-rated).
  let net = rawNet;
  if (gross != null && vat != null) {
    net = Math.round((gross - vat) * 100) / 100;
  }
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
  // AI's category pick — validated against active codes in handleExtracted.
  const aiCategory = str(data.category_code);
  if (aiCategory) out.category_code = aiCategory;

  // Supplier bank details, for the Pay action on the Money Out row. Carried
  // verbatim and never inferred — the parse prompt is explicit that a missing
  // bank block means nulls. Normalised only for whitespace/case so the same
  // account read off two invoice layouts compares equal.
  const iban = str(data.supplier_iban);
  if (iban) out.supplier_iban = iban.replace(/\s+/g, "").toUpperCase();
  const acct = str(data.supplier_account_number);
  if (acct) out.supplier_account_number = acct.replace(/\s+/g, "");
  const sort = str(data.supplier_sort_code);
  if (sort) out.supplier_sort_code = sort.replace(/[\s-]+/g, "");
  const bic = str(data.supplier_bic);
  if (bic) out.supplier_bic = bic.replace(/\s+/g, "").toUpperCase();
  const payRef = str(data.payment_reference);
  if (payRef) out.payment_reference = payRef;

  return out;
}
