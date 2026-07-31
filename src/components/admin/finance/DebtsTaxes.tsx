import { SectionTotal } from "@/components/admin/finance/SectionTotal";
import { useEffect, useMemo, useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useGraceTimers, useNowTicker, formatCountdown, GRACE_MS } from "@/hooks/useGraceTimers";
import { PayslipFlag } from "./PayslipFlag";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, TableFilterSelect, SortTh } from "@/components/ui/TableToolbar";

// One unified row over payroll (PAYE/NI from payslips) + manual tax liabilities.
interface UnifiedTaxRow {
  key: string; kind: "payroll" | "manual"; typeKey: string; typeLabel: string;
  period: string; due: string | null; amount: number; currency: string;
  payroll?: PayrollTaxRow; tax?: Tax;
}
const TAX_COLUMNS: SortableColumn<UnifiedTaxRow>[] = [
  { id: "type", accessor: (r) => r.typeLabel, type: "text" },
  { id: "period", accessor: (r) => r.period, type: "text" },
  { id: "due", accessor: (r) => r.due, type: "date" },
  { id: "amount", accessor: (r) => r.amount, type: "number" },
];

const TYPES = [{ v: "vat", l: "VAT" }, { v: "corporation_tax", l: "Corporation Tax" }, { v: "paye_ni", l: "PAYE / NI" }];
const typeLabel = (t: string) => TYPES.find((x) => x.v === t)?.l ?? t;
const money = (n: number, c = "GBP") =>
  (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `) +
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
// A debt is overdue or due within a week (null due = treat as due now).
const isDebtDue = (due: string | null) => !due || new Date(due).getTime() <= Date.now() + 7 * 86_400_000;

const isoTodayTx = new Date().toISOString().slice(0, 10);

interface Tax {
  id: string; tax_type: string; period_label: string | null; amount: number; currency: string;
  due_date: string | null; payment_status: string; document_path: string | null;
  justPaid?: boolean; paidAt?: number;
}
// PAYE/NI owed to HMRC for a month, derived from a payslip (not the taxes table).
interface PayrollTaxRow { id: string; account_id: string; employee: string; period_label: string; period_end: string | null; amount: number; document_path: string | null; filed: boolean; justPaid?: boolean; paidAt?: number; }

export function DebtsTaxes({ onTotal }: { onTotal?: (n: number) => void } = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Tax[]>([]);
  const [payroll, setPayroll] = useState<PayrollTaxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ tax_type: "vat", period_label: "", amount: "", due_date: "" });
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const grace = useGraceTimers();
  const now = useNowTicker(rows.some((r) => r.justPaid) || payroll.some((p) => p.justPaid));

  async function load() {
    const [{ data }, { data: ps }, { data: emps }] = await Promise.all([
      supabase.from("taxes")
        .select("id, tax_type, period_label, amount, currency, due_date, payment_status, document_path")
        .order("due_date", { ascending: true }),
      supabase.from("payslips").select("id, account_id, period_label, period_end, gross, net, income_tax, employee_ni, employer_ni, student_loan, tax_paid_at, document_path, dropbox_path"),
      supabase.from("accounts").select("id, company_name").eq("employment_type", "employee"),
    ]);
    // Debts only: unpaid AND overdue or due within a week (due date asc).
    setRows(((data ?? []) as Tax[]).filter((t) => t.payment_status !== "paid" && isDebtDue(t.due_date)));

    // Payroll PAYE/NI owed to HMRC per month = income tax + employee NI +
    // student loan (fall back to gross−net if not itemised). Employer NI is
    // excluded — the Employment Allowance covers it, so £0 is due to HMRC.
    const nameById = new Map<string, string>(((emps ?? []) as any[]).map((a) => [a.id, (a.company_name ?? "—").replace(/[_-]+/g, " ")]));
    setPayroll(((ps ?? []) as any[])
      .filter((p) => (!p.period_end || p.period_end <= isoTodayTx) && !p.tax_paid_at)
      .map((p) => {
        const itemised = (Number(p.income_tax) || 0) + (Number(p.employee_ni) || 0) + (Number(p.student_loan) || 0);
        const fallback = Math.max(0, (Number(p.gross) || 0) - (Number(p.net) || 0));
        return { id: p.id, account_id: p.account_id, employee: nameById.get(p.account_id) ?? "Employee", period_label: p.period_label ?? p.period_end ?? "—", period_end: p.period_end, amount: p.income_tax != null ? itemised : fallback, document_path: p.document_path ?? null, filed: !!p.document_path || !!p.dropbox_path };
      })
      .filter((r) => r.amount > 0)
      .sort((a, b) => (a.period_end ?? "").localeCompare(b.period_end ?? "")));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
    + payroll.filter((p) => !p.justPaid).reduce((s, p) => s + p.amount, 0);
  useEffect(() => { onTotal?.(total); }, [total, onTotal]);

  const combined = useMemo<UnifiedTaxRow[]>(() => {
    const p: UnifiedTaxRow[] = payroll.map((r) => ({ key: `p:${r.id}`, kind: "payroll", typeKey: "paye_ni", typeLabel: "PAYE / NI", period: `${r.employee} · ${r.period_label}`, due: r.period_end, amount: r.amount, currency: "GBP", payroll: r }));
    const m: UnifiedTaxRow[] = rows.map((r) => ({ key: `m:${r.id}`, kind: "manual", typeKey: r.tax_type, typeLabel: typeLabel(r.tax_type), period: r.period_label ?? "—", due: r.due_date, amount: Number(r.amount), currency: r.currency ?? "GBP", tax: r }));
    return [...p, ...m];
  }, [payroll, rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return combined.filter((r) => {
      if (typeFilter !== "all" && r.typeKey !== typeFilter) return false;
      if (q && !(r.typeLabel.toLowerCase().includes(q) || r.period.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [combined, search, typeFilter]);
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<UnifiedTaxRow>(filtered, TAX_COLUMNS, { key: "due", dir: "asc" });

  async function markPayrollPaid(r: PayrollTaxRow) {
    setSaving(r.id);
    const { error } = await supabase.from("payslips").update({ tax_paid_at: new Date().toISOString() }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't update", description: error.message, variant: "destructive" }); return; }
    setPayroll((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: true, paidAt: Date.now() } : x));
    grace.schedule(r.id, GRACE_MS, () => setPayroll((prev) => prev.filter((x) => x.id !== r.id)));
  }
  async function revertPayroll(r: PayrollTaxRow) {
    setSaving(r.id);
    const { error } = await supabase.from("payslips").update({ tax_paid_at: null }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't revert", description: error.message, variant: "destructive" }); return; }
    grace.cancel(r.id);
    setPayroll((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: false } : x));
  }

  async function markPaid(r: Tax) {
    setSaving(r.id);
    const { error } = await supabase.from("taxes")
      .update({ payment_status: "paid", payment_date: new Date().toISOString().slice(0, 10) }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't update", description: error.message, variant: "destructive" }); return; }
    // Keep it 5 min so a mistake can be reverted, then drop it.
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: true, paidAt: Date.now() } : x));
    grace.schedule(r.id, GRACE_MS, () => setRows((prev) => prev.filter((x) => x.id !== r.id)));
  }

  async function revert(r: Tax) {
    setSaving(r.id);
    const { error } = await supabase.from("taxes").update({ payment_status: "unpaid", payment_date: null }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't revert", description: error.message, variant: "destructive" }); return; }
    grace.cancel(r.id);
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: false } : x));
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
        <SectionTotal amount={total} format={money} />
      </div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
          <Plus className="h-3 w-3" strokeWidth={1.5} />Add tax liability
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 && payroll.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No tax liabilities recorded. Add one with the scan or HMRC screenshot.</div>
      ) : (
        <>
        <TableToolbar>
          <TableSearch value={search} onChange={setSearch} placeholder="SEARCH TYPE OR PERIOD" width="w-[260px]" />
          <TableFilterSelect value={typeFilter} onChange={setTypeFilter} width="w-[180px]"
            options={[{ value: "all", label: "All types" }, { value: "paye_ni", label: "PAYE / NI" }, { value: "vat", label: "VAT" }, { value: "corporation_tax", label: "Corporation Tax" }]} />
        </TableToolbar>
        <div className="ssr-tile overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <SortTh id="type" label="Type" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="period" label="Period" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="due" label="Due" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="amount" label="Amount" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                <th className="px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal">Doc</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-recessive text-sm">No liabilities match.</td></tr>
              ) : sortedRows.map((u) => {
                const justPaid = u.payroll?.justPaid || u.tax?.justPaid;
                const paidAt = u.payroll?.paidAt ?? u.tax?.paidAt ?? 0;
                const rowId = u.payroll?.id ?? u.tax?.id ?? u.key;
                return (
                <tr key={u.key} className={`border-b border-white/[0.05] last:border-0 ${justPaid ? "opacity-45" : ""}`}>
                  <td className="px-4 py-3 text-strong">{u.typeLabel}</td>
                  <td className="px-4 py-3 text-standard">{u.period}</td>
                  <td className="px-4 py-3 text-standard">{u.kind === "manual" ? fmtDate(u.due) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-strong">{money(u.amount, u.currency)}</td>
                  <td className="px-4 py-3">
                    {u.payroll
                      ? <PayslipFlag payslipId={u.payroll.id} accountId={u.payroll.account_id} employeeName={u.payroll.employee} periodEnd={u.payroll.period_end}
                          documentPath={u.payroll.document_path} filed={u.payroll.filed} onDone={load} />
                      : u.tax?.document_path
                        ? <button onClick={() => view(u.tax!)} className="text-white/45 hover:text-gold" title="View document"><Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                        : <span className="text-white/20">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {saving === rowId ? <BrandLoader size="sm" className="h-3 w-3 inline-block" />
                      : justPaid
                        ? <span className="inline-flex items-center gap-3"><span className="text-[11px] tabular-nums text-gold">{formatCountdown(paidAt + GRACE_MS - now)}</span><button onClick={() => u.payroll ? revertPayroll(u.payroll) : revert(u.tax!)} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75">Revert</button></span>
                        : <button onClick={() => u.payroll ? markPayrollPaid(u.payroll) : markPaid(u.tax!)} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
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
