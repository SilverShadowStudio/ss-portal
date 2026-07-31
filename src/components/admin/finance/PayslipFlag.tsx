import { Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { attachPayslip, viewPayslip } from "@/lib/payslipAttach";
import { MissingDocChip } from "./MissingDocChip";

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

  async function onFile(file: File) {
    try {
      const { figuresUpdated } = await attachPayslip({ payslipId, accountId, employeeName, periodEnd, file });
      toast({ title: "Payslip attached", description: figuresUpdated ? "Figures updated from the payslip and filed to Dropbox." : "Filed to Dropbox — figures kept (couldn't read the PDF)." });
      onDone();
    } catch (e) {
      toast({ title: "Couldn't attach the payslip", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

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
    <MissingDocChip
      label="Payslip missing"
      title="No payslip filed — click or drop this month's payslip"
      onFile={onFile}
    />
  );
}
