// Attach a real payslip PDF to an existing payslip row (a specific person +
// month). Used by the "payslip missing" flag across Salaries, Taxes and the
// P&L money-out ledger: parse the PDF for the real figures, store it, correct
// the row, and file it to Dropbox next to the person's agreement.
//
// The PDF is authoritative — parsed figures overwrite the tracker/forecast
// values, but the row's month (period_end / period_label) is kept as clicked.
import { supabase } from "@/integrations/supabase/client";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const r = reader.result as string; const c = r.indexOf(","); resolve(c >= 0 ? r.slice(c + 1) : r); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const numOrUndef = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export interface AttachPayslipInput {
  payslipId: string;
  accountId: string;
  employeeName: string;
  periodEnd: string | null; // for the Dropbox filename (YYYY-MM)
  file: File;
}

/**
 * Attach + reconcile. Parsing is best-effort: if it fails we still file the PDF
 * and mark the month as documented, so the flag always clears on a valid upload.
 * Returns whether the figures were updated from the parse.
 */
export async function attachPayslip({ payslipId, accountId, employeeName, periodEnd, file }: AttachPayslipInput): Promise<{ figuresUpdated: boolean }> {
  const b64 = await fileToBase64(file);

  // 1. Parse for the real figures (best-effort).
  const figures: Record<string, number | null> = {};
  let figuresUpdated = false;
  try {
    const { data, error } = await supabase.functions.invoke("parse-document", {
      body: { document_type: "payslip", file_data_base64: b64, file_mime_type: file.type },
    });
    if (!error && data?.success && data?.data) {
      const p = data.data as Record<string, unknown>;
      const gross = numOrUndef(p.gross);
      const employerNi = numOrUndef(p.employer_ni);
      const employerPension = numOrUndef(p.employer_pension);
      const set = (k: string, v: number | undefined) => { if (v !== undefined) { figures[k] = v; figuresUpdated = true; } };
      set("gross", gross);
      set("net", numOrUndef(p.net));
      set("income_tax", numOrUndef(p.income_tax));
      set("employee_ni", numOrUndef(p.employee_ni));
      set("student_loan", numOrUndef(p.student_loan));
      set("employer_ni", employerNi);
      set("employer_pension", employerPension);
      if (gross !== undefined) figures.employer_cost = gross + (employerNi ?? 0) + (employerPension ?? 0);
    }
  } catch { /* keep the tracker figures */ }

  // 2. Store the PDF (Supabase Storage) for in-portal viewing.
  const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".pdf";
  const documentPath = `${accountId}/${payslipId}${ext}`;
  const { error: upErr } = await supabase.storage.from("payslips").upload(documentPath, file, { contentType: file.type, upsert: true });
  if (upErr) throw upErr;

  // 3. Reconcile the row — corrected figures + the stored document.
  const { error: updErr } = await supabase.from("payslips").update({ ...figures, document_path: documentPath }).eq("id", payslipId);
  if (updErr) throw updErr;

  // 4. File to Dropbox next to the person's agreement (non-fatal).
  await supabase.functions.invoke("dropbox-save-payslip", {
    body: { pdf_base64: b64, mime: file.type, employee_name: employeeName, period_end: periodEnd ?? "", payslip_id: payslipId },
  }).then(() => {}, () => {});

  return { figuresUpdated };
}

/** Open a stored payslip PDF (signed URL) in a new tab. */
export async function viewPayslip(documentPath: string): Promise<void> {
  const { data } = await supabase.storage.from("payslips").createSignedUrl(documentPath, 120);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
