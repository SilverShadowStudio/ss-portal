import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, TableFilterSelect, SortTh } from "@/components/ui/TableToolbar";
import { type ExpenseCategory, type VatTreatment } from "@/lib/finance";
import { CurrencyAmount } from "@/components/finance/CurrencyAmount";

interface Commitment {
  id: string;
  supplier_name: string;
  description: string | null;
  service: string | null;
  category_code: string | null;
  currency: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  vat_treatment: string | null;
  frequency: "monthly" | "quarterly" | "annual";
  day_of_month: number;
  lead_days: number;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

const FREQ_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };
const money = (n: number, c = "GBP") => (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `) + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const num = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };

// VAT treatments practical for recurring commitments (rent, SaaS, subscriptions).
const VAT_OPTS: { v: VatTreatment; l: string }[] = [
  { v: "none", l: "Outside scope / no VAT" },
  { v: "exempt", l: "Exempt (e.g. rent)" },
  { v: "standard", l: "Standard 20%" },
  { v: "reverse_charge", l: "Reverse charge (overseas)" },
  { v: "zero", l: "Zero-rated" },
];

const EMPTY = {
  id: "" as string,
  supplier_name: "", service: "", category_code: "", currency: "GBP",
  amount: "", vat_treatment: "none" as VatTreatment,
  frequency: "monthly" as Commitment["frequency"], day_of_month: "1", lead_days: "0",
  start_date: "", end_date: "",
};

/**
 * Recurring commitments — rents, subscriptions and any fixed bill that repeats.
 * Fill Supplier / Service / Fee / Period / Contract start once; the portal then
 * materialises every past-and-future bill into the P&L and Debts automatically
 * (recurring-overheads-generate), each starting DUE with the "invoice missing"
 * flag until the real invoice is uploaded — exactly like salaries/payslips.
 */
export default function AdminRecurring() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Commitment[]>([]);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [freqFilter, setFreqFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  async function load() {
    const [{ data }, { data: c }] = await Promise.all([
      supabase.from("recurring_overheads").select("*").order("supplier_name"),
      supabase.from("expense_categories" as any).select("*").order("code"),
    ]);
    setRows((data ?? []) as Commitment[]);
    setCats(((c as unknown) as ExpenseCategory[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const derived = useMemo(() => {
    const gross = num(form.amount);
    const treatment = form.vat_treatment;
    // Enter the headline fee (gross); back out net + VAT from the treatment.
    if (treatment === "standard") {
      const net = Math.round((gross / 1.2) * 100) / 100;
      return { net, vat: Math.round((gross - net) * 100) / 100, gross };
    }
    return { net: gross, vat: 0, gross };
  }, [form.amount, form.vat_treatment]);

  function openNew() { setForm({ ...EMPTY, start_date: new Date().toISOString().slice(0, 10) }); setOpen(true); }
  function openEdit(r: Commitment) {
    setForm({
      id: r.id, supplier_name: r.supplier_name, service: r.service ?? r.description ?? "",
      category_code: r.category_code ?? "", currency: r.currency ?? "GBP",
      amount: String(r.gross_amount ?? ""), vat_treatment: (r.vat_treatment as VatTreatment) ?? "none",
      frequency: r.frequency, day_of_month: String(r.day_of_month ?? 1), lead_days: String(r.lead_days ?? 0),
      start_date: r.start_date, end_date: r.end_date ?? "",
    });
    setOpen(true);
  }
  function applyRentPreset() {
    setForm((f) => ({ ...f, frequency: "monthly", day_of_month: "1", lead_days: "20", vat_treatment: "exempt" }));
    toast({ title: "Rent timing set", description: "Monthly, due the 1st, issued ~15th of the prior month." });
  }

  async function save() {
    if (!form.supplier_name.trim()) { toast({ title: "Supplier is required", variant: "destructive" }); return; }
    if (!form.start_date) { toast({ title: "Contract start is required", variant: "destructive" }); return; }
    if (!(num(form.amount) > 0)) { toast({ title: "Enter the fee", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const payload = {
        supplier_name: form.supplier_name.trim(),
        service: form.service.trim() || null,
        description: form.service.trim() || null,
        category_code: form.category_code || null,
        currency: form.currency || "GBP",
        net_amount: derived.net, vat_amount: derived.vat, gross_amount: derived.gross,
        vat_treatment: form.vat_treatment,
        frequency: form.frequency,
        day_of_month: Math.min(28, Math.max(1, parseInt(form.day_of_month || "1", 10) || 1)),
        lead_days: Math.max(0, parseInt(form.lead_days || "0", 10) || 0),
        start_date: form.start_date,
        contract_start: form.start_date,
        end_date: form.end_date || null,
        active: true,
      };
      let id = form.id;
      if (id) {
        const { error } = await supabase.from("recurring_overheads").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("recurring_overheads").insert({ ...payload, created_by: userId }).select("id").single();
        if (error) throw error;
        id = (data as { id: string }).id;
      }
      // Materialise past + upcoming bills for this commitment immediately.
      const { data: gen } = await supabase.functions.invoke("recurring-overheads-generate", { body: { recurring_overhead_id: id } });
      toast({ title: form.id ? "Commitment updated" : "Commitment added", description: `${(gen as { created?: number })?.created ?? 0} bill(s) generated into P&L & Debts.` });
      setOpen(false);
      load();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Commitment) {
    if (!window.confirm(`Remove the recurring commitment for ${r.supplier_name}? Bills already generated stay in the P&L/Debts; no new ones will be created.`)) return;
    const { error } = await supabase.from("recurring_overheads").delete().eq("id", r.id);
    if (error) { toast({ title: "Couldn't remove", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Commitment removed" });
    load();
  }

  async function regenerateAll() {
    setRegenerating(true);
    try {
      const { data } = await supabase.functions.invoke("recurring-overheads-generate", { body: {} });
      toast({ title: "Generated", description: `${(data as { created?: number })?.created ?? 0} new bill(s) added.` });
      load();
    } catch (e) {
      toast({ title: "Couldn't generate", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (freqFilter !== "all" && r.frequency !== freqFilter) return false;
      if (q && !(r.supplier_name.toLowerCase().includes(q) || (r.service ?? r.description ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, freqFilter]);
  const COLUMNS: SortableColumn<Commitment>[] = [
    { id: "supplier", accessor: (r) => r.supplier_name, type: "text" },
    { id: "service", accessor: (r) => r.service ?? r.description ?? "", type: "text" },
    { id: "fee", accessor: (r) => Number(r.gross_amount ?? 0), type: "number" },
    { id: "frequency", accessor: (r) => r.frequency, type: "text" },
    { id: "start", accessor: (r) => r.start_date, type: "date" },
  ];
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Commitment>(filtered, COLUMNS, { key: "supplier", dir: "asc" });

  return (
    <AdminLayout panel>
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Recurring costs</span>
        </div>
        <p className="mt-3 text-sm text-recessive">Rents and subscriptions that repeat — set once, and every past-and-future bill flows into the P&amp;L and Debts automatically.</p>
      </div>

      <section className="ssr-zone mb-4">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Commitments</h2></div>
          <div className="flex items-center gap-5">
            <button onClick={regenerateAll} disabled={regenerating} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c] disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} strokeWidth={1.5} />Generate due bills
            </button>
            <button onClick={openNew} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
              <Plus className="h-3 w-3" strokeWidth={1.5} />Add commitment
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
        ) : rows.length === 0 ? (
          <div className="ssr-tile p-10 text-center text-recessive text-sm">No recurring commitments yet. Add rent, Corona, Dropbox, Slack, Softr, Airtable…</div>
        ) : (
          <>
            <TableToolbar>
              <TableSearch value={search} onChange={setSearch} placeholder="SEARCH SUPPLIER OR SERVICE" width="w-[280px]" />
              <TableFilterSelect value={freqFilter} onChange={setFreqFilter} width="w-[160px]"
                options={[{ value: "all", label: "All periods" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "annual", label: "Annual" }]} />
            </TableToolbar>
            <div className="ssr-tile overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <SortTh id="supplier" label="Supplier" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="service" label="Service" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="fee" label="Fee" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                    <SortTh id="frequency" label="Period" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="start" label="Contract start" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.id} className={`border-b border-white/[0.05] last:border-0 ${r.active ? "" : "opacity-45"}`}>
                      <td className="px-4 py-3 text-strong">{r.supplier_name}</td>
                      <td className="px-4 py-3 text-standard">{r.service ?? r.description ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-strong"><CurrencyAmount amount={Number(r.gross_amount)} currency={r.currency} rateDate={null} /><span className="ml-1.5 text-[10px] text-white/35">/{r.frequency === "annual" ? "yr" : r.frequency === "quarterly" ? "qtr" : "mo"}</span></td>
                      <td className="px-4 py-3 text-standard">{FREQ_LABEL[r.frequency] ?? r.frequency}</td>
                      <td className="px-4 py-3 text-standard">{fmtDate(r.start_date)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-4">
                          <button onClick={() => openEdit(r)} className="text-white/40 hover:text-gold transition-colors" title="Edit"><Pencil className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                          <button onClick={() => remove(r)} className="text-white/40 hover:text-[#d8a184] transition-colors" title="Remove"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">Each generated bill starts due with an “invoice missing” flag until you upload the real invoice, in Money Out.</p>
          </>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-sm border-divider bg-background max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Recurring costs</p>
            <DialogTitle className="font-serif font-normal text-2xl">{form.id ? "Edit commitment" : "New commitment"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5"><Label>Supplier</Label><Input value={form.supplier_name} onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))} placeholder="e.g. Corona / Landlord" className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Service</Label><Input value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))} placeholder="e.g. Render licence / Studio rent" className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Fee (headline)</Label><Input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 1000" className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="GBP">GBP</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5"><Label>VAT treatment</Label>
              <Select value={form.vat_treatment} onValueChange={(v) => setForm((f) => ({ ...f, vat_treatment: v as VatTreatment }))}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{VAT_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[10px] text-white/35">Net {money(derived.net, form.currency)} · VAT {money(derived.vat, form.currency)} · Gross {money(derived.gross, form.currency)}</p>
            </div>
            <div className="space-y-1.5"><Label>Period</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v as Commitment["frequency"] }))}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Contract start</Label><Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="rounded-sm" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Category (optional)</Label>
              <Select value={form.category_code || "none"} onValueChange={(v) => setForm((f) => ({ ...f, category_code: v === "none" ? "" : v }))}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Uncategorised" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Uncategorised</SelectItem>{cats.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 rounded-sm border border-white/[0.07] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Timing</span>
                <button type="button" onClick={applyRentPreset} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Use rent timing</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5"><Label>Bill day</Label><Input inputMode="numeric" value={form.day_of_month} onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))} className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label>Issue ahead (days)</Label><Input inputMode="numeric" value={form.lead_days} onChange={(e) => setForm((f) => ({ ...f, lead_days: e.target.value }))} className="rounded-sm" /></div>
                <div className="space-y-1.5"><Label>End (optional)</Label><Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="rounded-sm" /></div>
              </div>
              <p className="mt-2 text-[10px] text-white/35">Bill day = day of the month the bill is dated. Issue ahead lets it appear early — rent: day 1, ahead 20, so it shows ~the 15th for the 1st of next month.</p>
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={save} disabled={saving} className="rounded-sm">{saving ? "Saving…" : form.id ? "Save & generate" : "Add & generate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
