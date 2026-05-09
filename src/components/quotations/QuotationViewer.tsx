import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { generateInvoicePdf } from "@/lib/invoiceUtils";
import { QuotationDocument, type QuotationDocumentData } from "./QuotationDocument";

export interface QuotationViewerData extends QuotationDocumentData {
  id: string;
  account_id?: string | null;
  project_id?: string | null;
}

interface Props {
  quotation: QuotationViewerData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuotationViewer({ quotation, open, onOpenChange }: Props) {
  const docRef = useRef<HTMLDivElement | null>(null);
  const [enriched, setEnriched] = useState<QuotationDocumentData | null>(null);

  useEffect(() => {
    if (!open || !quotation) {
      setEnriched(null);
      return;
    }
    let cancelled = false;
    const base: QuotationDocumentData = { ...quotation };
    setEnriched(base);

    (async () => {
      const accountId = quotation.account_id;
      if (accountId) {
        const { data: acc } = await supabase
          .from("accounts")
          .select(
            "company_name, country, registration_number, street_name, building_number, city, postcode, owner_user_id",
          )
          .eq("id", accountId)
          .maybeSingle();
        if (acc) {
          const addrLines = [
            [acc.building_number, acc.street_name].filter(Boolean).join(" "),
            [acc.postcode, acc.city].filter(Boolean).join(" "),
          ].filter((s) => s && s.trim().length > 0);
          base.client_company = base.client_company || acc.company_name || null;
          base.client_address = base.client_address || (addrLines.length ? addrLines.join("\n") : null);
          base.client_country = base.client_country || acc.country || null;
          base.client_registration = base.client_registration || acc.registration_number || null;

          if (acc.owner_user_id) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("first_name, last_name, full_name, position")
              .eq("user_id", acc.owner_user_id)
              .maybeSingle();
            if (prof) {
              const fullName =
                [prof.first_name, prof.last_name].filter(Boolean).join(" ").trim() ||
                prof.full_name ||
                "";
              base.client_name = base.client_name || fullName || null;
              base.client_position = base.client_position || prof.position || null;
            }
          }
        }
      }
      if (quotation.project_id && !base.project_name) {
        const { data: p } = await supabase
          .from("projects")
          .select("name")
          .eq("id", quotation.project_id)
          .maybeSingle();
        if (p) base.project_name = p.name;
      }
      if (!cancelled) setEnriched({ ...base });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, quotation]);

  if (!quotation) return null;

  const number = quotation.quotation_number || quotation.reference_number || "—";
  const safeNumber = String(number).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const fileName = `quotation-${safeNumber}.pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[96vh] p-0 gap-0 flex flex-col bg-black/95 border-0 [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Quotation {number}</DialogTitle>
        <DialogDescription className="sr-only">Preview and download the quotation.</DialogDescription>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="pointer-events-auto h-9 w-9 text-white hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>

          <a
            href="#"
            download={fileName}
            onClick={(e) => {
              e.preventDefault();
              if (!docRef.current) return;
              void generateInvoicePdf(docRef.current, fileName);
            }}
            className="pointer-events-auto inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium shadow-lg bg-[#BCA88E] hover:bg-[#a8957c] text-black"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </a>
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-10">
          {enriched ? (
            <QuotationDocument ref={docRef} data={enriched} />
          ) : (
            <div className="flex items-center justify-center text-white/70 h-full">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}