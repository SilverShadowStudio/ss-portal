// Attach the original invoice/receipt file to an existing overhead by dropping
// (or picking) it on the "Invoice missing" flag — the overhead equivalent of
// attachPayslip. Unlike a payslip attach, this does NOT re-parse or overwrite
// the overhead's figures: the amounts were already set when the overhead was
// created; the file was simply never filed. It only stages the file, which the
// overheads_dropbox_pending trigger then files to Dropbox.
import { supabase } from "@/integrations/supabase/client";

const STAGING_BUCKET = "overhead-invoices";

/**
 * Upload the dropped file to the staging bucket and point the overhead at it.
 * Setting staging_storage_path (with dropbox_path still null) fires the
 * overheads_dropbox_pending trigger → dropbox-save-overhead-file, which files
 * it to Dropbox and clears staging. Mirrors OverheadUploadFlow's staging step.
 */
export async function attachOverheadInvoice({
  overheadId,
  file,
}: {
  overheadId: string;
  file: File;
}): Promise<void> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const stagingPath = `staging/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(STAGING_BUCKET)
    .upload(stagingPath, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from("overheads")
    .update({ staging_storage_path: stagingPath })
    .eq("id", overheadId);
  if (updErr) throw updErr;
}
