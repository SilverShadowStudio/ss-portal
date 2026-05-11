import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { generateInvoicePdf, type InvoiceForPdf } from "@/lib/invoiceUtils";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";

export interface InvoiceViewerData extends InvoiceForPdf {
  id: string;
  account_id?: string | null;
}

interface Props {
  invoice: InvoiceViewerData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showPay?: boolean;
  paying?: boolean;
  onPay?: (inv: InvoiceViewerData) => void;
}

export function InvoiceViewer({ invoice, open, onOpenChange }: Props) {
  const docRef = useRef<HTMLDivElement | null>(null);
  const [enriched, setEnriched] = useState<InvoiceDocumentData | null>(null);

  useEffect(() => {
    if (!open || !invoice) {
      setEnriched(null);
      return;
    }
    let cancelled = false;
    // Build base data synchronously and show the document immediately so the
    // Download button is available even if the enrichment fetches are slow or
    // fail. Enrichment (company address / contact email) updates in the
    // background.
    const base: InvoiceDocumentData = {
      invoice_number: invoice.invoice_number,
      reference_number: invoice.reference_number,
      status: invoice.status,
      issued_at: invoice.issued_at,
      created_at: invoice.created_at,
      due_date: invoice.due_date,
      currency: invoice.currency || "GBP",
      amount: invoice.amount,
      subtotal: invoice.subtotal ?? null,
      vat_rate: invoice.vat_rate ?? null,
      vat_amount: invoice.vat_amount ?? null,
      notes: invoice.notes ?? null,
      line_items: (invoice.line_items as any) || [],
      bank_account: (invoice as any).bank_account ?? null,
      client_company: invoice.client_company,
      client_name: invoice.client_name ?? null,
      client_address: invoice.client_address ?? null,
    };
    setEnriched(base);

    (async () => {
      const accountId = (invoice as any).account_id as string | undefined;
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
          base.client_address = addrLines.length ? addrLines.join("\n") : base.client_address;
          base.client_country = acc.country || null;
          base.client_registration = acc.registration_number || null;

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
              base.client_position = prof.position || null;
            }

            try {
              const { data: contact } = await supabase.functions.invoke(
                "get-account-contact",
                { body: { accountId } },
              );
              if (contact?.email) base.client_email = contact.email;
            } catch {
              // non-fatal — leave email blank
            }
          }
        }
      }

      if (!cancelled) setEnriched({ ...base });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoice]);

  if (!invoice) return null;

  const number = invoice.invoice_number || invoice.reference_number || "—";
  const safeNumber = String(number).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const fileName = `invoice-${safeNumber}.pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[96vh] p-0 gap-0 flex flex-col bg-black/95 border-0 [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Invoice {number}</DialogTitle>
        <DialogDescription className="sr-only">Preview and download the invoice.</DialogDescription>

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
            className="pointer-events-auto inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium shadow-lg border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </a>
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-10">
          {enriched ? (
            <InvoiceDocument ref={docRef} data={enriched} />
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
