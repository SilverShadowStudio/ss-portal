// Records a parsed invoice straight into the books, with no review form.
//
// Only ever called for drops that cleared the confidence gate
// (see overheadConfidence.ts). The row lands UNPAID on purpose — filing and
// paying are separate acts, and paying is a deliberate click on the Money Out
// row. Setting `staging_storage_path` with `dropbox_path` still null is what
// fires the overheads_dropbox_pending trigger → dropbox-save-overhead-file,
// which renames the file to the AP convention and files it in Dropbox.
//
// The payload deliberately mirrors OverheadForm.handleSave — same columns,
// same derivations — so an unattended row is indistinguishable from a
// hand-reviewed one.

import { supabase } from "@/integrations/supabase/client";
import { isDuplicateError } from "@/lib/dbErrors";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import type { Overhead } from "@/lib/finance";

export type RecordOutcome =
  | { status: "recorded"; id: string; supplier: string; gross: number }
  | { status: "duplicate"; supplier: string }
  | { status: "failed"; supplier: string; error: string };

export async function recordOverheadUnattended(
  d: Partial<Overhead>,
): Promise<RecordOutcome> {
  const supplier = (d.supplier_name ?? "").trim();
  const net = d.net_amount ?? 0;
  const vat = d.vat_amount ?? 0;
  const gross = d.gross_amount ?? net + vat;

  const { data: userData } = await supabase.auth.getUser();

  const payload: Record<string, unknown> = {
    supplier_name: supplier,
    category_code: d.category_code ?? null,
    description: d.description?.trim() || null,
    // From the document. A EUR invoice recorded as GBP overstates the cost.
    currency: d.currency || "GBP",
    net_amount: net,
    vat_amount: vat,
    gross_amount: gross,
    vat_treatment: d.vat_treatment ?? "standard",
    invoice_number: d.invoice_number?.trim() || null,
    invoice_date: d.invoice_date,
    due_date: d.due_date ?? null,
    // Filed, not paid. The Pay action on the Money Out row settles it.
    payment_date: null,
    payment_status: "unpaid",
    is_reverse_charge: false,
    reverse_charge_vat: 0,
    notes: null,
    created_by: userData.user?.id ?? null,
    source: "dropzone",
    // Whatever the parser read off the supplier's own "remit to" block. Null
    // when the invoice carries no bank details — the Pay action then asks.
    supplier_iban: d.supplier_iban ?? null,
    supplier_account_number: d.supplier_account_number ?? null,
    supplier_sort_code: d.supplier_sort_code ?? null,
    supplier_bic: d.supplier_bic ?? null,
    payment_reference: d.payment_reference ?? null,
  };
  if (d.staging_storage_path) payload.staging_storage_path = d.staging_storage_path;

  const { data: inserted, error } = await supabase
    .from("overheads" as any)
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    // Same supplier + invoice number is already in the books. Not a failure —
    // the drop was simply redundant. The staged file is cleaned by the caller.
    if (isDuplicateError(error.message)) return { status: "duplicate", supplier };
    return { status: "failed", supplier, error: error.message };
  }

  // Reinforce the supplier→category memory, exactly as the review form does,
  // so the mapping stays warm even when Fred never opens the form.
  if (supplier && d.category_code) {
    const key = normalizeSupplier(supplier);
    if (key) {
      void supabase.from("supplier_category_map" as any).upsert({
        supplier_normalized: key,
        category_code: d.category_code,
        updated_by: userData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return {
    status: "recorded",
    id: (inserted as { id: string } | null)?.id ?? "",
    supplier,
    gross,
  };
}
