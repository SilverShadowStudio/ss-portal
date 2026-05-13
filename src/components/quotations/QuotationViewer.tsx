import { useEffect, useRef, useState } from "react";
import { Download, Loader2, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { generateInvoicePdf } from "@/lib/invoiceUtils";
import { useToast } from "@/hooks/use-toast";
import { QuotationDocument, type QuotationDocumentData } from "./QuotationDocument";

export interface QuotationViewerData extends QuotationDocumentData {
  id: string;
  status?: string | null;
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
  const [status, setStatus] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  const [signPosition, setSignPosition] = useState("");
  const [signing, setSigning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !quotation) {
      setEnriched(null);
      setStatus(null);
      setSignName("");
      setSignPosition("");
      return;
    }
    setStatus(quotation.status ?? null);
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

  const handleSign = async () => {
    if (!signName.trim()) return;
    setSigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("sign-quotation", {
        body: { quotation_id: quotation.id, signed_by_name: signName.trim(), signed_by_position: signPosition.trim() || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStatus("signed");
      setSignOpen(false);
      toast({ title: "Quotation signed", description: "A deposit invoice has been created." });
    } catch (err: any) {
      toast({ title: "Failed to sign", description: err?.message || "Unexpected error", variant: "destructive" });
    } finally {
      setSigning(false);
    }
  };

  return (
    <>
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

          <div className="pointer-events-auto flex items-center gap-3">
            {status === "sent" && (
              <button
                onClick={() => setSignOpen(true)}
                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium shadow-lg bg-gold text-background hover:bg-gold/90"
              >
                <PenLine className="mr-1.5 h-4 w-4" />
                Sign
              </button>
            )}
            {status === "signed" && (
              <span className="inline-flex h-9 items-center px-3 text-xs uppercase tracking-[0.18em] text-emerald-400">
                Signed
              </span>
            )}
            <a
              href="#"
              download={fileName}
              onClick={(e) => {
                e.preventDefault();
                if (!docRef.current) return;
                void generateInvoicePdf(docRef.current, fileName);
              }}
              className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium shadow-lg border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download
            </a>
          </div>
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

    {/* Sign quotation modal */}
    <Dialog open={signOpen} onOpenChange={setSignOpen}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Sign quotation</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          By signing, you confirm acceptance of the terms in this quotation. A deposit invoice will be created automatically.
        </DialogDescription>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Full name *</Label>
            <Input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder={enriched?.client_name || ""} />
          </div>
          <div className="space-y-1.5">
            <Label>Position</Label>
            <Input value={signPosition} onChange={(e) => setSignPosition(e.target.value)} placeholder={enriched?.client_position || ""} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={() => setSignOpen(false)} className="flex-1">Cancel</Button>
          <Button onClick={handleSign} disabled={signing || !signName.trim()} className="flex-1">
            {signing ? "Signing…" : "Confirm & sign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}