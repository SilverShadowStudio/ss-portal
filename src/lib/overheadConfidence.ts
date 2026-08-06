// Decides whether a dropped invoice may land in the books unattended, or needs
// Fred's eyes first.
//
// The drop no longer moves money (paying is a separate, deliberate action on
// the Money Out row), so a misread costs a wrong row — editable, recoverable.
// That doesn't justify gating every invoice. Two things are still expensive to
// get wrong silently:
//   - the gross, because it's what the Pay button will later send;
//   - the invoice date, because both the filename and the month folder are
//     built from it (dropbox-save-overhead-file.buildFolderPath returns null
//     without one, so the file has nowhere to go at all).
//
// In practice this means the FIRST invoice from any supplier gets reviewed and
// every recurring one after it goes straight through — which is where the
// volume is.

import type { Overhead } from "@/lib/finance";

export type ConfidenceFlag =
  | "no_supplier"
  | "no_gross"
  | "does_not_reconcile"
  | "no_invoice_date"
  | "no_invoice_number"
  | "no_category"
  | "new_supplier";

/** Shown in the review form header so it's obvious why this one stopped. */
export const CONFIDENCE_FLAG_LABELS: Record<ConfidenceFlag, string> = {
  no_supplier: "no supplier name",
  no_gross: "no total amount",
  does_not_reconcile: "net plus VAT doesn't equal the total",
  no_invoice_date: "no invoice date",
  no_invoice_number: "no invoice number",
  no_category: "no category",
  new_supplier: "first invoice from this supplier",
};

export interface ConfidenceVerdict {
  /** True == record it and file it without stopping. */
  auto: boolean;
  flags: ConfidenceFlag[];
  /** Put the document itself beside the fields: the numbers are wrong AND
   *  there's no history with this supplier to fall back on. */
  showDocument: boolean;
}

/** Money read off a document is only ever compared to the penny. */
const PENNY = 0.005;

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v.replace(/[£$€,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Do the three figures Claude read agree with each other?
 *
 * This has to run on the RAW extraction, not the mapped defaults:
 * `mapExtractedToOverhead` deliberately forces net = gross − vat whenever it
 * has both, so by the time it's mapped the sum always reconciles and the check
 * would be tautological. Claude's own three numbers agreeing is real evidence
 * it read the right lines off the page; them disagreeing is exactly the case
 * the mapper papers over, and the one worth surfacing.
 *
 * Returns null when there aren't enough numbers to judge.
 */
export function rawFiguresReconcile(raw: Record<string, unknown>): boolean | null {
  const net = n(raw.net_total);
  const vat = n(raw.vat_amount);
  const gross = n(raw.gross_total);
  if (net == null || vat == null || gross == null) return null;
  return Math.abs(net + vat - gross) <= PENNY;
}

export function assessOverhead(
  raw: Record<string, unknown>,
  defaults: Partial<Overhead>,
  opts: {
    /** The category came from Fred's own prior pick for this supplier
     *  (supplier_category_map), not from a fresh guess. */
    categoryFromMemory: boolean;
  },
): ConfidenceVerdict {
  const flags: ConfidenceFlag[] = [];

  if (!defaults.supplier_name?.trim()) flags.push("no_supplier");

  const gross = defaults.gross_amount;
  if (gross == null || !(gross > 0)) {
    flags.push("no_gross");
  } else if (rawFiguresReconcile(raw) === false) {
    flags.push("does_not_reconcile");
  }

  if (!defaults.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(defaults.invoice_date)) {
    flags.push("no_invoice_date");
  }
  // Without an invoice number the filename falls back to NOINV and the
  // duplicate guard (supplier + invoice number) can't stop the same bill
  // being filed twice.
  if (!defaults.invoice_number?.trim()) flags.push("no_invoice_number");

  if (!defaults.category_code) flags.push("no_category");
  else if (!opts.categoryFromMemory) flags.push("new_supplier");

  const numbersWrong =
    flags.includes("no_gross") || flags.includes("does_not_reconcile");

  return {
    auto: flags.length === 0,
    flags,
    showDocument: numbersWrong && !opts.categoryFromMemory,
  };
}

/** "no invoice number and first invoice from this supplier" */
export function describeFlags(flags: ConfidenceFlag[]): string {
  const parts = flags.map((f) => CONFIDENCE_FLAG_LABELS[f]);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
