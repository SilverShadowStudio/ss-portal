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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function QuotationFormDialog({ open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("none");
  const [quotationNumber, setQuotationNumber] = useState("");
  const [projectName, setProjectName] = useState("");
  const [status, setStatus] = useState("draft");
  const [currency, setCurrency] = useState("GBP");
  const [vatRate, setVatRate] = useState<number>(20);
  const [depositPercentage, setDepositPercentage] = useState<number>(50);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceLineItem[]>([
    { description: "CGI Still Visuals", quantity: 1, unit_price: 2500 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setQuotationNumber(suggestQuotationNumber());
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name, owner_user_id")
        .order("company_name");
      const { data: projs } = await supabase
        .from("projects")
        .select("id, name, account_id")
        .is("archived_at", null)
        .order("name");
      if (cancelled) return;
      setAccounts(accs || []);
      setProjects(projs || []);
    })();
    return () => { cancelled = true; };
  }, []);

  function suggestQuotationNumber() {
    const rand = Math.floor(100 + Math.random() * 900);
    return `KPL${rand}`;
  }

  function reset() {
    setAccountId("");
    setProjectId("none");
    setQuotationNumber("");
    setProjectName("");
    setStatus("draft");
    setCurrency("GBP");
    setVatRate(20);
    setDepositPercentage(50);
    setNotes("");
    setItems([{ description: "CGI Still Visuals", quantity: 1, unit_price: 2500 }]);
  }

  function updateItem(i: number, patch: Partial<InvoiceLineItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    if (!accountId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    if (!quotationNumber.trim()) {
      toast({ title: "Quotation number required", variant: "destructive" });
      return;
    }
    const subtotal = lineItemsTotal(items);
    const vatAmount = +(subtotal * (Number(vatRate) || 0) / 100).toFixed(2);
    const total = +(subtotal + vatAmount).toFixed(2);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;

    setSaving(true);
    const projId = projectId !== "none" ? projectId : null;
    const projName = projectName.trim() || projects.find((p) => p.id === projId)?.name || null;

    const payload = {
      account_id: accountId,
      project_id: projId,
      user_id: account.owner_user_id,
      quotation_number: quotationNumber.trim(),
      reference_number: quotationNumber.trim(),
      project_name: projName,
      amount: total,
      subtotal,
      net_total: subtotal,
      gross_total: total,
      vat_rate: Number(vatRate) || 0,
      vat_amount: vatAmount,
      deposit_percentage: Number(depositPercentage) || 50,
      deposit_amount: +(total * (Number(depositPercentage) || 50) / 100).toFixed(2),
      status,
      currency,
      notes: notes.trim() || null,
      line_items: items.filter((it) => it.description.trim() !== ""),
      issued_at: new Date().toISOString(),
      sent_at: status === "sent" ? new Date().toISOString() : null,
    };

    const { data: created, error } = await supabase
      .from("quotation_documents")
      .insert(payload as any)
      .select("id")
      .single();
    if (error) {
      setSaving(false);
      toast({ title: "Failed to create quotation", description: error.message, variant: "destructive" });
      return;
    }

    if (status === "sent" && created) {
      // Notify all members of the account
      const { data: members } = await supabase
        .from("account_members")
        .select("user_id")
        .eq("account_id", accountId);
      const rows = (members || []).map((m: any) => ({
        user_id: m.user_id,
        account_id: accountId,
        kind: "quotation",
        title: `New quotation ${quotationNumber.trim()}`,
        message: projName ? `For ${projName}` : null,
        link_path: `/documents?quotation=${created.id}`,
        entity_type: "quotation_document",
        entity_id: created.id,
      }));
      if (rows.length) await supabase.from("client_notifications").insert(rows as any);
    }

    setSaving(false);
    toast({ title: "Quotation created" });
    reset();
    onSaved();
    onOpenChange(false);
  }

  const filteredProjects = accountId ? projects.filter((p) => p.account_id === accountId) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setProjectId("none"); setProjectName(""); }}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project (optional)</Label>
              <Input
                value={projectName}
                onChange={(e) => {
                  const val = e.target.value;
                  setProjectName(val);
                  const match = filteredProjects.find((p) => p.name === val);
                  setProjectId(match ? match.id : "none");
                }}
                placeholder={!accountId ? "Select client first" : filteredProjects.length > 0 ? "Type or select a project…" : "Type project name…"}
                disabled={!accountId}
                list="quotation-project-suggestions"
              />
              {filteredProjects.length > 0 && (
                <datalist id="quotation-project-suggestions">
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quotation #</Label>
              <Input value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="signed">Signed</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Scenes / line items</Label>
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
                <span className="text-muted-foreground">Net total</span>
                <span className="tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items), currency)}
                </span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground">VAT ({vatRate || 0}%)</span>
                <span className="tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items) * (Number(vatRate) || 0) / 100, currency)}
                </span>
              </div>
              <div className="flex gap-3 pt-1 border-t border-border/40">
                <span className="font-medium">Gross total</span>
                <span className="font-semibold tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items) * (1 + (Number(vatRate) || 0) / 100), currency)}
                </span>
              </div>
              <div className="flex gap-3 text-muted-foreground">
                <span>Deposit ({depositPercentage || 50}%)</span>
                <span className="tabular-nums w-28 text-right">
                  {formatCurrency(lineItemsTotal(items) * (1 + (Number(vatRate) || 0) / 100) * (Number(depositPercentage) || 50) / 100, currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="z-[200]">
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
            <div className="space-y-2">
              <Label>Deposit (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="5"
                value={depositPercentage}
                onChange={(e) => setDepositPercentage(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Create quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}