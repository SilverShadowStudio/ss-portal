import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { InvoiceLineItem } from "@/lib/invoiceUtils";
import { lineItemsTotal, formatCurrency } from "@/lib/invoiceUtils";
import { BANK_ACCOUNTS, DEFAULT_BANK_ACCOUNT_ID } from "@/lib/bankAccounts";

interface AccountOption {
  id: string;
  company_name: string;
  owner_user_id: string;
}

interface ProjectOption {
  id: string;
  name: string;
  account_id: string | null;
}

interface InvoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function InvoiceFormDialog({ open, onOpenChange, onSaved }: InvoiceFormDialogProps) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("none");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [status, setStatus] = useState("draft");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [vatRate, setVatRate] = useState<number>(20);
  const [notes, setNotes] = useState("");
  const [bankAccount, setBankAccount] = useState<string>(DEFAULT_BANK_ACCOUNT_ID);
  const [items, setItems] = useState<InvoiceLineItem[]>([
    { description: "", quantity: 1, unit_price: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name, owner_user_id")
        .order("company_name");
      setAccounts(accs || []);
      const { data: projs } = await supabase
        .from("projects")
        .select("id, name, account_id")
        .is("archived_at", null)
        .order("name");
      setProjects(projs || []);
      setInvoiceNumber(suggestInvoiceNumber());
    })();
  }, [open]);

  function suggestInvoiceNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${y}${m}-${rand}`;
  }

  function reset() {
    setAccountId("");
    setProjectId("none");
    setInvoiceNumber("");
    setStatus("draft");
    setDueDate("");
    setCurrency("GBP");
    setVatRate(20);
    setNotes("");
    setBankAccount(DEFAULT_BANK_ACCOUNT_ID);
    setItems([{ description: "", quantity: 1, unit_price: 0 }]);
  }

  function updateItem(i: number, patch: Partial<InvoiceLineItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    if (!accountId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    if (!invoiceNumber.trim()) {
      toast({ title: "Invoice number required", variant: "destructive" });
      return;
    }
    const subtotal = lineItemsTotal(items);
    const vatAmount = +(subtotal * (Number(vatRate) || 0) / 100).toFixed(2);
    const total = +(subtotal + vatAmount).toFixed(2);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;

    setSaving(true);
    const payload = {
      account_id: accountId,
      project_id: projectId !== "none" ? projectId : null,
      user_id: account.owner_user_id,
      invoice_number: invoiceNumber.trim(),
      reference_number: invoiceNumber.trim(),
      amount: total,
      subtotal,
      vat_rate: Number(vatRate) || 0,
      vat_amount: vatAmount,
      status,
      due_date: dueDate || null,
      currency,
      notes: notes.trim() || null,
      bank_account: bankAccount,
      line_items: items.filter((it) => it.description.trim() !== ""),
      issued_at: new Date().toISOString(),
      sent_at: status === "sent" ? new Date().toISOString() : null,
    };

    const { data: created, error } = await supabase
      .from("invoices")
      .insert(payload as any)
      .select("id, invoice_number, reference_number")
      .single();
    if (error) {
      setSaving(false);
      toast({ title: "Failed to create invoice", description: error.message, variant: "destructive" });
      return;
    }

    if (status === "sent" && created) {
      const { data: members } = await supabase
        .from("account_members")
        .select("user_id")
        .eq("account_id", accountId);
      const num = created.invoice_number || created.reference_number || invoiceNumber.trim();
      const rows = (members || []).map((m: any) => ({
        user_id: m.user_id,
        account_id: accountId,
        kind: "invoice",
        title: `New invoice ${num}`,
        message: null,
        link_path: `/invoices?invoice=${created.id}`,
        entity_type: "invoice",
        entity_id: created.id,
      }));
      if (rows.length) await supabase.from("client_notifications").insert(rows as any);
    }
    setSaving(false);
    toast({ title: "Invoice created" });
    reset();
    onSaved();
    onOpenChange(false);
  }

  const filteredProjects = accountId
    ? projects.filter((p) => p.account_id === accountId)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setProjectId("none"); }}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project (optional)</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={!accountId}>
                <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {filteredProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Invoice #</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unit_price: 0 }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add item
              </Button>
            </div>

            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <Input
                  className="col-span-6"
                  placeholder="Description"
                  value={it.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Qty"
                  value={it.quantity}
                  onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })}
                />
                <Input
                  className="col-span-3"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unit price"
                  value={it.unit_price}
                  onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="col-span-1"
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex flex-col items-end gap-1 pt-2 text-sm">
              <div className="flex gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums w-28 text-right">{formatCurrency(lineItemsTotal(items), currency)}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground">VAT ({vatRate || 0}%)</span>
                <span className="tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items) * (Number(vatRate) || 0) / 100, currency)}
                </span>
              </div>
              <div className="flex gap-3 pt-1 border-t border-border/40">
                <span className="font-medium">Total</span>
                <span className="font-semibold tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items) * (1 + (Number(vatRate) || 0) / 100), currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>VAT rate (%)</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bank account</Label>
            <Select value={bankAccount} onValueChange={setBankAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(BANK_ACCOUNTS).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Create invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
