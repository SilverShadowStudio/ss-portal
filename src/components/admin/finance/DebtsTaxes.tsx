import { useEffect, useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const TYPES = [{ v: "vat", l: "VAT" }, { v: "corporation_tax", l: "Corporation Tax" }, { v: "paye_ni", l: "PAYE / NI" }];
const typeLabel = (t: string) => TYPES.find((x) => x.v === t)?.l ?? t;
const money = (n: number, c = "GBP") =>
  (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `) +
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
// A debt is overdue or due within a week (null due = treat as due now).
const isDebtDue = (due: string | null) => !due || new Date(due).getTime() <= Date.now() + 7 * 86_400_000;

interface Tax {
  id: string; tax_type: string; period_label: string | null; amount: number; currency: string;
  due_date: string | null; payment_status: string; document_path: string | null;
}

export function DebtsTaxes() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Tax[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ tax_type: "vat", period_label: "", amount: "", due_date: "" });
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    const { data } = await supabase.from("taxes")
      .select("id, tax_type, period_label, amount, currency, due_date, payment_status, document_path")
      .order("due_date", { ascending: true });
    // Debts only: unpaid AND overdue or due within a week (due date asc).
    setRows(((data ?? []) as Tax[]).filter((t) => t.payment_status !== "paid" && isDebtDue(t.due_date)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  async function markPaid(r: Tax) {
    setSaving(r.id);
    const { error } = await supabase.from("taxes")
      .update({ payment_status: "paid", payment_date: new Date().toISOString().slice(0, 10) }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't update", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    toast({ title: "Tax marked paid" });
  }

  async function view(r: Tax) {
    if (!r.document_path) return;
    const { data } = await supabase.storage.from("tax-documents").createSignedUrl(r.document_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function save() {
    const amount = parseFloat(form.amount.replace(/[^0-9.]/g, ""));
    if (!(amount > 0)) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const id = crypto.randomUUID();
      let documentPath: string | null = null;
      if (file) {
        const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
        documentPath = `${id}${ext}`;
        const { error: upErr } = await supabase.storage.from("tax-documents").upload(documentPath, file, { contentType: file.type, upsert: true });
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from("taxes").insert({
        id, tax_type: form.tax_type, period_label: form.period_label.trim() || null,
        amount, due_date: form.due_date || null, document_path: documentPath,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
      toast({ title: "Tax liability added" });
      setOpen(false); setForm({ tax_type: "vat", period_label: "", amount: "", due_date: "" }); setFile(null);
      load();
    } catch (e) {
      toast({ title: "Couldn't add tax liability", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Taxes</h2></div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{money(total)} outstanding</span>
          <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
            <Plus className="h-3 w-3" strokeWidth={1.5} />Add tax liability
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No tax liabilities recorded. Add one with the scan or HMRC screenshot.</div>
      ) : (
        <div className="ssr-tile overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                {["Type", "Period", "Due", "Amount", "Doc", ""].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal ${i === 3 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.05] last:border-0">
                  <td className="px-4 py-3 text-strong">{typeLabel(r.tax_type)}</td>
                  <td className="px-4 py-3 text-standard">{r.period_label ?? "—"}</td>
                  <td className="px-4 py-3 text-standard">{fmtDate(r.due_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-strong">{money(Number(r.amount), r.currency ?? "GBP")}</td>
                  <td className="px-4 py-3">
                    {r.document_path
                      ? <button onClick={() => view(r)} className="text-white/45 hover:text-gold" title="View document"><Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                      : <span className="text-white/20">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {saving === r.id ? <BrandLoader size="sm" className="h-3 w-3 inline-block" />
                      : <button onClick={() => markPaid(r)} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Debts · Taxes</p>
            <DialogTitle className="font-serif font-normal text-2xl">Add tax liability</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Type</Label>
              <Select value={form.tax_type} onValueChange={(v) => setForm((f) => ({ ...f, tax_type: v }))}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="rounded-sm" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Period (optional)</Label>
              <Input value={form.period_label} onChange={(e) => setForm((f) => ({ ...f, period_label: e.target.value }))} placeholder="e.g. Q2 2026 / FY 2025" className="rounded-sm" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Document (scan / HMRC screenshot)</Label>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="rounded-sm" />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={save} disabled={busy} className="rounded-sm">{busy ? "Saving…" : "Add liability"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
