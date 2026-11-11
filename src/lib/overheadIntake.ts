// Read one supplier invoice and stage its original — the first half of
// recording an expense from a dropped file. Shared by every place a file can
// be dropped for the books (the P&L dropzone, and the Overview Dropzone, which
// hands supplier invoices here), so both judge and file them identically.
//
// Nothing is saved. The caller records confident ones unattended
// (recordOverheadUnattended) and opens the review form for the rest.

import { supabase } from "@/integrations/supabase/client";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import { mapExtractedToOverhead } from "@/components/admin/overheads/OverheadUploadFlow";
import { assessOverhead, type ConfidenceVerdict } from "@/lib/overheadConfidence";
import type { ExpenseCategory, Overhead } from "@/lib/finance";

/** A parsed invoice plus the verdict on whether it can land unattended. */
export interface ParsedInvoice {
  defaults: Partial<Overhead>;
  verdict: ConfidenceVerdict;
}

export const OVERHEAD_STAGING_BUCKET = "overhead-invoices";

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const r = reader.result as string; const c = r.indexOf(","); resolve(c >= 0 ? r.slice(c + 1) : r); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function parseOverheadFile(file: File, categories: ExpenseCategory[]): Promise<ParsedInvoice> {
  const activeCats = categories.filter((c) => c.active);
  const activeCodes = new Set(activeCats.map((c) => c.code));
  const base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke("parse-document", {
    body: {
      document_type: "overhead",
      file_data_base64: base64,
      file_mime_type: file.type,
      categories: activeCats.map((c) => ({ code: c.code, name: c.name })),
    },
  });
  if (error) throw new Error((data as { error?: string } | null)?.error || error.message);
  if (!data?.success || !data?.data) throw new Error(data?.error || "Could not read the invoice");

  const raw = data.data as Record<string, unknown>;
  const defaults = mapExtractedToOverhead(raw);

  // Category: drop hallucinated codes; prefer Fred's supplier→category memory.
  // Whether the memory hit is itself the confidence signal — a supplier we've
  // filed before is a supplier whose category Fred already chose by hand.
  if (defaults.category_code && !activeCodes.has(defaults.category_code)) delete defaults.category_code;
  let categoryFromMemory = false;
  if (defaults.supplier_name) {
    const key = normalizeSupplier(defaults.supplier_name);
    if (key) {
      const { data: mapping } = await supabase.from("supplier_category_map" as any)
        .select("category_code").eq("supplier_normalized", key).maybeSingle();
      const cat = (mapping as { category_code?: string } | null)?.category_code;
      if (cat && activeCodes.has(cat)) { defaults.category_code = cat; categoryFromMemory = true; }
    }
  }

  // Stage the original so the save (attended or not) can file it to Dropbox.
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const stagingPath = `staging/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(OVERHEAD_STAGING_BUCKET).upload(stagingPath, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  defaults.staging_storage_path = stagingPath;

  return { defaults, verdict: assessOverhead(raw, defaults, { categoryFromMemory }) };
}
