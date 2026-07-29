import { useRef, useState } from "react";
import { Paperclip, Upload, AlertTriangle } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { useToast } from "@/hooks/use-toast";
import { attachPayslip, viewPayslip } from "@/lib/payslipAttach";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/**
 * Per-line payslip flag. When the month has no filed payslip it shows a gentle
 * amber "Payslip missing" affordance; clicking it uploads that month's PDF,
 * which parses → corrects the figures → files to Dropbox and clears the flag.
 * When a PDF is present it shows a paperclip that opens it.
 */
export function PayslipFlag({
  payslipId, accountId, employeeName, periodEnd, documentPath, filed, onDone,
}: {
  payslipId: string;
  accountId: string;
  employeeName: string;
  periodEnd: string | null;
  documentPath: string | null; // in-portal stored copy (viewable)
  filed: boolean;              // has a PDF anywhere (storage or Dropbox)
  onDone: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const { figuresUpdated } = await attachPayslip({ payslipId, accountId, employeeName, periodEnd, file });
      toast({ title: "Payslip attached", description: figuresUpdated ? "Figures updated from the payslip and filed to Dropbox." : "Filed to Dropbox — figures kept (couldn't read the PDF)." });
      onDone();
    } catch (e) {
      toast({ title: "Couldn't attach the payslip", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (busy) return <BrandLoader size="sm" className="h-3.5 w-3.5 inline-block" />;

  if (filed) {
    return documentPath ? (
      <button
        type="button"
        onClick={() => viewPayslip(documentPath)}
        className="text-white/45 hover:text-gold transition-colors"
        title="View payslip"
      >
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    ) : (
      <span className="text-gold/60" title="Filed to Dropbox"><Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} /></span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group inline-flex items-center gap-1.5 rounded-full border border-[#c98a6a]/35 bg-[#c98a6a]/[0.07] px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-[#d8a184] transition-colors hover:border-[#C9A96A]/60 hover:bg-[#C9A96A]/[0.1] hover:text-[#ecd39c]"
        title="No payslip filed — click to upload this month's payslip"
      >
        <AlertTriangle className="h-3 w-3 group-hover:hidden" strokeWidth={1.6} />
        <Upload className="hidden h-3 w-3 group-hover:inline" strokeWidth={1.6} />
        Payslip missing
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
}
