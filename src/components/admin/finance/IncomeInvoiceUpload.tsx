import { useEffect, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { friendlyDbError } from "@/lib/dbErrors";

/**
 * Income invoices raised OUTSIDE the portal (e.g. Xero). Written to `invoices`
 * with `type: 'external'` so they never double-count against portal-generated
 * invoices. They flow into Money in and, when paid, into cash-basis output VAT.
 *
 * This module exports:
 *   • IncomeInvoiceReviewDialog — the pre-filled review form + save (reused by
 *     the manual button and the bulk drop zone).
 *   • IncomeInvoiceUpload — the "New income invoice" manual entry button.
 *   • FormState / EMPTY_INCOME_FORM / mapInvoiceToForm — for the bulk flow.
 */

export type InvoiceKind = "deposit" | "balance" | "standalone";

export interface FormState {
  clientName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  net: string;
  vatAmount: string;
  gross: string;
  currency: string;
  paid: "paid" | "unpaid";
  kind: InvoiceKind;
  lineItems: unknown;
}

export const EMPTY_INCOME_FORM: FormState = {
  clientName: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  net: "",
  vatAmount: "",
  gross: "",
  currency: "GBP",
  paid: "paid",
  kind: "standalone",
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

function invoiceKind(v: unknown, invoiceNumber: string): InvoiceKind {
  // The studio's numbering convention is deterministic and therefore
  // AUTHORITATIVE: -A = deposit, -B/-C/... = balance. It wins over the model's
  // reading of often-ambiguous invoice wording — which mislabelled KAT025-B as
  // "standalone" even with the -B right there. Only when the number carries no
  // A–Z suffix do we trust the parser's semantic guess.
  const suffix = invoiceNumber.trim().match(/-([A-Za-z])\d*$/)?.[1]?.toUpperCase();
  if (suffix === "A") return "deposit";
  if (suffix && suffix >= "B" && suffix <= "Z") return "balance";
  const k = str(v).toLowerCase();
  if (k === "deposit" || k === "balance" || k === "standalone") return k;
  return "standalone";
}

/** Map parse-document's INVOICE_SCHEMA output to the review form. */
export function mapInvoiceToForm(data: Record<string, unknown>): FormState {
  const net = num(data.net_total);
  const vat = num(data.vat_amount);
  const gross = num(data.gross_total);
  const invoiceNumber = str(data.invoice_number);
  return {
    clientName: str(data.client_company) || str(data.client_name),
    invoiceNumber,
    invoiceDate: isoDate(data.invoice_date),
    dueDate: isoDate(data.due_date),
    net: net != null ? String(net) : "",
    vatAmount: vat != null ? String(vat) : "",
    gross: gross != null ? String(gross) : "",
    currency: str(data.currency) || "GBP",
    paid: "paid",
    kind: invoiceKind(data.invoice_kind, invoiceNumber),
    lineItems: data.line_items ?? null,
  };
}

interface ReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: FormState;
  sourceFile: File | null;
  onSaved: () => void;
  /** e.g. "2 of 7" — shows the bulk-review position in the header. */
  queueLabel?: string | null;
  /** When set, the dialog edits this existing invoice (update) and offers Delete. */
  editId?: string | null;
  onDeleted?: () => void;
}

/** The pre-filled income-invoice review form. Resets from `initial` on open or
 *  whenever `initial` changes (so a bulk queue can advance it in place). */
export function IncomeInvoiceReviewDialog({ open, onOpenChange, initial, sourceFile, onSaved, queueLabel, editId, onDeleted }: ReviewProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => { if (open) setForm(initial); }, [open, initial]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const gross = num(form.gross);
    if (gross == null) { toast({ title: "Gross amount is required", variant: "destructive" }); return; }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setSaving(false); toast({ title: "Not signed in", variant: "destructive" }); return; }

    // Edit mode: update the existing invoice and finish (no dup check, no filing).
    if (editId) {
      const paid = form.paid === "paid";
      const invoiceDate = form.invoiceDate || null;
      const { error } = await supabase.from("invoices").update({
        status: paid ? "paid" : "sent",
        amount: gross,
        subtotal: num(form.net) ?? null,
        vat_amount: num(form.vatAmount) ?? null,
        invoice_number: form.invoiceNumber || null,
        reference_number: form.invoiceNumber.trim() || `EXT-${editId.slice(0, 8).toUpperCase()}`,
        issued_at: invoiceDate,
        due_date: form.dueDate || null,
        paid_at: paid ? invoiceDate : null,
        currency: form.currency || "GBP",
        notes: form.clientName || null,
        invoice_kind: form.kind,
      } as never).eq("id", editId);
      setSaving(false);
      if (error) { toast({ title: "Couldn't update the invoice", description: friendlyDbError(error.message), variant: "destructive" }); return; }
      toast({ title: "Invoice updated" });
      onSaved();
      onOpenChange(false);
      return;
    }

    // Duplicate guard — match on invoice number, then client name + gross.
    let existing: { invoice_number: string | null } | null = null;
    if (form.invoiceNumber.trim()) {
      const { data } = await supabase.from("invoices").select("invoice_number").eq("invoice_number", form.invoiceNumber.trim()).limit(1);
      if (data && data.length) existing = data[0] as { invoice_number: string | null };
    }
    if (!existing && form.clientName.trim()) {
      const { data } = await supabase.from("invoices").select("invoice_number").ilike("notes", `%${form.clientName.trim()}%`).eq("amount", gross).limit(1);
      if (data && data.length) existing = data[0] as { invoice_number: string | null };
    }
    if (existing) {
      const label = existing.invoice_number ? ` (${existing.invoice_number})` : "";
      const ok = window.confirm(`Possible duplicate: an invoice${label} for ${form.currency} ${gross.toFixed(2)} is already recorded. Add this one anyway?`);
      if (!ok) { setSaving(false); return; }
    }

    const paid = form.paid === "paid";
    const invoiceDate = form.invoiceDate || null;
    const { data: inserted, error } = await supabase.from("invoices").insert({
      user_id: userId,
      type: "external",
      // reference_number is NOT NULL — use the client's invoice number, or a
      // generated internal reference when the invoice has none.
      reference_number: form.invoiceNumber.trim() || `EXT-${Date.now().toString(36).toUpperCase()}`,
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
      invoice_kind: form.kind,
      line_items: form.lineItems ?? null,
    } as never).select("id").single();
    if (error || !inserted) {
      setSaving(false);
      toast({ title: "Couldn't save the income invoice", description: friendlyDbError(error?.message), variant: "destructive" });
      return;
    }

    // File the original to Dropbox (policy: no P&L entry without a file).
    const invoiceId = (inserted as { id: string }).id;
    if (sourceFile) {
      const ext = sourceFile.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".pdf";
      const { error: upErr } = await supabase.storage.from("income-invoices").upload(`${invoiceId}${ext}`, sourceFile, { contentType: sourceFile.type, upsert: true });
      if (upErr) {
        toast({ title: "Recorded, but the file didn't upload", description: upErr.message, variant: "destructive" });
      } else {
        const { data: filed, error: fileErr } = await supabase.functions.invoke("dropbox-save-invoice-file", { body: { invoice_id: invoiceId } });
        if (fileErr || (filed as { success?: boolean })?.success === false) {
          toast({ title: "Recorded, but filing to Dropbox failed", description: "Use “File to Dropbox” on the invoice to retry.", variant: "destructive" });
        } else {
          toast({ title: "Income invoice added & filed to Dropbox" });
        }
      }
    } else {
      toast({ title: "Income invoice added", description: "No file attached — it will show as “Not filed”." });
    }
    setSaving(false);
    onSaved();
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("Delete this income invoice? This removes it from your P&L. This cannot be undone.")) return;
    setDeleting(true);
    // Best-effort remove the stored original (we don't track the extension).
    await Promise.all(["pdf", "png", "jpg", "jpeg"].map((ext) => supabase.storage.from("income-invoices").remove([`${editId}.${ext}`]).catch(() => {})));
    const { error } = await supabase.from("invoices").delete().eq("id", editId);
    setDeleting(false);
    if (error) { toast({ title: "Couldn't delete the invoice", description: friendlyDbError(error.message), variant: "destructive" }); return; }
    toast({ title: "Invoice deleted" });
    (onDeleted ?? onSaved)();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-sm border-divider bg-background">
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            Revenue · external invoice
            {queueLabel && <span className="ml-2 text-[#C9A96A]">· reviewing {queueLabel}</span>}
          </p>
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
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={form.kind} onValueChange={(v) => set("kind", v as InvoiceKind)}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">Deposit / downpayment</SelectItem>
                <SelectItem value="balance">Balance</SelectItem>
                <SelectItem value="standalone">Standalone (full)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {editId ? (
            <button type="button" onClick={handleDelete} disabled={deleting || saving} className="text-sm text-destructive/80 hover:text-destructive transition-colors disabled:opacity-40">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : <span />}
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => onOpenChange(false)} className="text-sm text-recessive hover:text-standard transition-colors">
              Cancel
            </button>
            <Button onClick={handleSave} disabled={saving} className="rounded-sm">
              {saving ? "Saving…" : editId ? "Save changes" : "Save income invoice"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manual "New income invoice" entry — opens the review form blank. */
export function IncomeInvoiceUpload({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-gold hover:underline underline-offset-4">
        New income invoice
      </button>
      <IncomeInvoiceReviewDialog open={open} onOpenChange={setOpen} initial={EMPTY_INCOME_FORM} sourceFile={null} onSaved={onSaved} />
    </>
  );
}
