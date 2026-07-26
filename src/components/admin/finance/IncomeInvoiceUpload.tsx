import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentAutofillDropzone } from "@/components/admin/DocumentAutofillDropzone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * Add an income invoice into P&L → Money in, either by uploading an invoice
 * (Claude extracts the fields via parse-document's INVOICE_SCHEMA) or by hand.
 *
 * These are invoices raised OUTSIDE the portal (e.g. in Xero). They are written
 * to the `invoices` table with `type: 'external'` so they are always separable
 * from — and never double-count against — portal-generated invoices. They flow
 * into Money in and, when marked paid, into cash-basis output VAT automatically.
 */

interface Props {
  onSaved: () => void;
}

interface FormState {
  clientName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  net: string;
  vatAmount: string;
  gross: string;
  currency: string;
  paid: "paid" | "unpaid";
  lineItems: unknown;
}

const EMPTY: FormState = {
  clientName: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  net: "",
  vatAmount: "",
  gross: "",
  currency: "GBP",
  paid: "paid",
  lineItems: null,
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[£$€,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function isoDate(v: unknown): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function IncomeInvoiceUpload({ onSaved }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const { toast } = useToast();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openBlank() {
    setForm(EMPTY);
    setFormOpen(true);
  }

  function handleExtracted(data: Record<string, unknown>) {
    const net = num(data.net_total);
    const vat = num(data.vat_amount);
    const gross = num(data.gross_total);
    setForm({
      clientName: str(data.client_company) || str(data.client_name),
      invoiceNumber: str(data.invoice_number),
      invoiceDate: isoDate(data.invoice_date),
      dueDate: isoDate(data.due_date),
      net: net != null ? String(net) : "",
      vatAmount: vat != null ? String(vat) : "",
      gross: gross != null ? String(gross) : "",
      currency: str(data.currency) || "GBP",
      paid: "paid",
      lineItems: data.line_items ?? null,
    });
    setUploadOpen(false);
    setFormOpen(true);
  }

  async function handleSave() {
    const gross = num(form.gross);
    if (gross == null) {
      toast({ title: "Gross amount is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSaving(false);
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const paid = form.paid === "paid";
    const invoiceDate = form.invoiceDate || null;
    const { error } = await supabase.from("invoices").insert({
      user_id: userId,
      type: "external",
      status: paid ? "paid" : "sent",
      amount: gross,
      subtotal: num(form.net) ?? null,
      vat_amount: num(form.vatAmount) ?? null,
      invoice_number: form.invoiceNumber || null,
      issued_at: invoiceDate,
      due_date: form.dueDate || null,
      paid_at: paid ? invoiceDate : null,
      currency: form.currency || "GBP",
      notes: form.clientName || null,
      line_items: form.lineItems ?? null,
    } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save the income invoice", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Income invoice added" });
    setFormOpen(false);
    onSaved();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setUploadOpen(true)}
        className="text-sm text-gold hover:underline underline-offset-4"
      >
        Upload income invoice
      </button>
      <button
        type="button"
        onClick={openBlank}
        className="text-sm text-gold hover:underline underline-offset-4"
      >
        New income invoice
      </button>

      {/* Upload → extract → review */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-lg rounded-sm border-divider bg-background" hideClose>
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Money in</p>
            <DialogTitle className="font-serif font-normal text-2xl">Upload income invoice</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <DocumentAutofillDropzone
              documentType="invoice"
              onExtracted={handleExtracted}
              onLoadingChange={setBusy}
            />
            <p className="mt-3 font-sans text-[11px] text-foreground/40">
              PDF, JPEG, or PNG. We&rsquo;ll pre-fill the form so you can review before saving.
            </p>
          </div>
          <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              disabled={busy}
              className="text-sm text-recessive hover:text-standard transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review / manual create */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Money in · external invoice</p>
            <DialogTitle className="font-serif font-normal text-2xl">Income invoice</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Client</Label>
              <Input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice number</Label>
              <Input value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Invoice date</Label>
              <Input type="date" value={form.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Net</Label>
              <Input inputMode="decimal" value={form.net} onChange={(e) => set("net", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>VAT</Label>
              <Input inputMode="decimal" value={form.vatAmount} onChange={(e) => set("vatAmount", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Gross</Label>
              <Input inputMode="decimal" value={form.gross} onChange={(e) => set("gross", e.target.value)} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.paid} onValueChange={(v) => set("paid", v as FormState["paid"])}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="text-sm text-recessive hover:text-standard transition-colors"
            >
              Cancel
            </button>
            <Button onClick={handleSave} disabled={saving} className="rounded-sm">
              {saving ? "Saving…" : "Save income invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
