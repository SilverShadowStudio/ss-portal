import { SectionTotal } from "@/components/admin/finance/SectionTotal";
import { useEffect, useMemo, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { estimatePayroll, estimateMonthlyEmployerOnCosts, TAX_YEAR } from "@/lib/payrollEstimate";
import { useGraceTimers, useNowTicker, formatCountdown, GRACE_MS } from "@/hooks/useGraceTimers";
import { PayslipFlag } from "./PayslipFlag";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, TableFilterSelect, SortTh } from "@/components/ui/TableToolbar";

interface EmployeeRow {
  id: string;
  name: string;
  position: string | null;
  gross_salary_annual: number;
}
interface Payslip {
  id: string; account_id: string; period_label: string | null; period_end: string | null;
  gross: number | null; net: number | null; employer_cost: number | null; document_path: string | null; dropbox_path: string | null;
  income_tax: number | null; employee_ni: number | null; employer_ni: number | null; student_loan: number | null;
  back_pay: number | null; taxable_gross_pay: number | null;
  salary_paid_at: string | null;
  justPaid?: boolean; paidAt?: number;
}

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const money2 = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };

// ── Accountant's Salary & Deductions Tracker CSV → payslip rows ──────────────
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const isoToday = new Date().toISOString().slice(0, 10);

/** Parse CSV into records, respecting quoted fields + embedded newlines. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "", record: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length) { record.push(field); if (record.some((f) => f.trim() !== "")) records.push(record); }
  return records;
}

interface TrackerRow {
  period_label: string; period_end: string;
  gross: number; income_tax: number; employee_ni: number; student_loan: number; net: number; employer_ni: number;
}

/** Extract data rows (columns: Month, Yearly, MonthlyPay, BackPay, Tax, NI, StudentLoan, TaxableGross, EmployerNI, TakeHome). */
function parseTracker(text: string): TrackerRow[] {
  const out: TrackerRow[] = [];
  for (const rec of parseCsvRecords(text)) {
    const m = (rec[0] || "").trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    if (!m || rec.length < 10) continue; // header/blank rows skipped
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi < 0) continue;
    const year = Number(m[2]);
    const period_end = `${year}-${String(mi + 1).padStart(2, "0")}-${new Date(year, mi + 1, 0).getDate()}`;
    out.push({
      period_label: `${m[1]} ${year}`,
      period_end,
      gross: num(rec[2]) + num(rec[3]),   // monthly pay + back pay
      income_tax: num(rec[4]),
      employee_ni: num(rec[5]),
      student_loan: num(rec[6]),
      net: num(rec[9]),                   // take-home
      employer_ni: num(rec[8]),
    });
  }
  return out;
}

/**
 * Debts → Salaries. The forecast (gross → net + employer cost) gives the annual
 * provision; uploaded payslips give the actual employer cost paid to date, so
 * the two can be compared. See payrollEstimate.
 */
export function DebtsSalaries({ onTotal }: { onTotal?: (n: number) => void } = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [pays, setPays] = useState<{ id: string; payslip_id: string; amount: number; paid_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [payslipFilter, setPayslipFilter] = useState<"all" | "missing" | "filed">("all");
  // Part-payment dialog (a month paid in instalments).
  const [partOpen, setPartOpen] = useState(false);
  const [partTarget, setPartTarget] = useState<Payslip | null>(null);
  const [partForm, setPartForm] = useState({ amount: "", date: isoToday });
  const [partBusy, setPartBusy] = useState(false);

  // Add-payslip dialog
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<EmployeeRow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [f, setF] = useState({ period_label: "", period_end: "", gross: "", net: "", employer_ni: "", employer_pension: "" });
  const [editSlip, setEditSlip] = useState<null | { id: string; period_label: string; gross: string; back_pay: string; income_tax: string; employee_ni: string; student_loan: string; taxable_gross_pay: string; net: string; employer_ni: string }>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Add salaried person (payroll-only — not a team member)
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", position: "", salary: "" });

  async function addPerson() {
    if (!addForm.name.trim()) { toast({ title: "Enter a name", variant: "destructive" }); return; }
    setAddBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-payroll-employee", {
        body: { name: addForm.name.trim(), position: addForm.position.trim(), gross_salary_annual: addForm.salary },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: "Salaried person added", description: `${addForm.name.trim()} — import their payslips to populate.` });
      setAddOpen(false); setAddForm({ name: "", position: "", salary: "" });
      load();
    } catch (e) {
      toast({ title: "Couldn't add", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setAddBusy(false);
    }
  }

  async function load() {
    const [{ data: accts }, { data: ps }] = await Promise.all([
      supabase.from("accounts").select("id, company_name, position, gross_salary_annual").eq("employment_type", "employee"),
      supabase.from("payslips").select("id, account_id, period_label, period_end, gross, net, employer_cost, document_path, dropbox_path, income_tax, employee_ni, employer_ni, student_loan, back_pay, taxable_gross_pay, salary_paid_at").order("period_end", { ascending: false }),
    ]);
    setRows(((accts ?? []) as any[])
      .filter((a) => Number(a.gross_salary_annual) > 0)
      .map((a) => ({ id: a.id, name: (a.company_name ?? "—").replace(/[_-]+/g, " "), position: a.position, gross_salary_annual: Number(a.gross_salary_annual) })));
    setSlips((ps ?? []) as Payslip[]);
    const { data: paysData } = await supabase.from("salary_payments").select("id, payslip_id, amount, paid_at");
    setPays((paysData ?? []) as any[]);
    setLoading(false);
  }
  const paidFor = (id: string) => pays.filter((p) => p.payslip_id === id).reduce((s, p) => s + Number(p.amount || 0), 0);
  useEffect(() => { load(); }, []);

  const grace = useGraceTimers();
  const now = useNowTicker(slips.some((s) => s.justPaid));
  const empName = (id: string) => rows.find((r) => r.id === id)?.name ?? "—";

  // Unpaid NET salary for due months (period_end ≤ today), oldest first — the
  // salary owed to employees. (Tax owed to HMRC lives in Debts → Taxes.)
  const owed = slips
    .filter((s) => Number(s.net) > 0 && (!s.period_end || s.period_end <= isoToday) && (!s.salary_paid_at || s.justPaid))
    .sort((a, b) => (a.period_end ?? "").localeCompare(b.period_end ?? ""));
  const totalOwed = owed.filter((s) => !s.justPaid).reduce((sum, s) => sum + Number(s.net || 0), 0);
  useEffect(() => { onTotal?.(totalOwed); }, [totalOwed, onTotal]);

  const hasDoc = (s: Payslip) => !!s.document_path || !!s.dropbox_path;
  const salColumns = useMemo<SortableColumn<Payslip>[]>(() => [
    { id: "employee", accessor: (s) => empName(s.account_id), type: "text" },
    { id: "month", accessor: (s) => s.period_end, type: "date" },
    { id: "net", accessor: (s) => Number(s.net ?? 0), type: "number" },
  ], [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredOwed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return owed.filter((s) => {
      if (payslipFilter === "missing" && hasDoc(s)) return false;
      if (payslipFilter === "filed" && !hasDoc(s)) return false;
      if (q && !empName(s.account_id).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [owed, search, payslipFilter, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sortedRows: sortedOwed, sortKey, sortDir, toggle } = useTableSort<Payslip>(filteredOwed, salColumns, { key: "month", dir: "asc" });

  async function markSalaryPaid(s: Payslip) {
    const iso = new Date().toISOString();
    // Record the outstanding balance as a payment so the shared statement is
    // complete, then settle the month.
    const remaining = Number(s.net || 0) - paidFor(s.id);
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
    if (remaining > 0.01) {
      await supabase.from("salary_payments").insert({ payslip_id: s.id, amount: remaining, paid_at: iso.slice(0, 10), created_by: userId });
    }
    const { error } = await supabase.from("payslips").update({ salary_paid_at: iso }).eq("id", s.id);
    if (error) { toast({ title: "Couldn't mark paid", description: error.message, variant: "destructive" }); return; }
    setPays((prev) => remaining > 0.01 ? [...prev, { id: crypto.randomUUID(), payslip_id: s.id, amount: remaining, paid_at: iso.slice(0, 10) }] : prev);
    setSlips((prev) => prev.map((x) => x.id === s.id ? { ...x, justPaid: true, paidAt: Date.now(), salary_paid_at: iso } : x));
    grace.schedule(s.id, GRACE_MS, () => setSlips((prev) => prev.map((x) => x.id === s.id ? { ...x, justPaid: false } : x)));
  }

  function openPartPay(s: Payslip) {
    setPartTarget(s);
    setPartForm({ amount: Math.max(0, Number(s.net || 0) - paidFor(s.id)).toFixed(2), date: isoToday });
    setPartOpen(true);
  }
  async function savePartPay() {
    if (!partTarget) return;
    const amount = num(partForm.amount);
    if (!(amount > 0)) { toast({ title: "Enter an amount", variant: "destructive" }); return; }
    setPartBusy(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error } = await supabase.from("salary_payments").insert({ payslip_id: partTarget.id, amount, paid_at: partForm.date || isoToday, created_by: userId });
      if (error) throw error;
      // Settle the month once the instalments cover the net.
      const net = Number(partTarget.net || 0);
      if (paidFor(partTarget.id) + amount >= net - 0.01) {
        await supabase.from("payslips").update({ salary_paid_at: new Date().toISOString() }).eq("id", partTarget.id);
      }
      toast({ title: "Payment recorded", description: `${money2(amount)} towards ${partTarget.period_label ?? "the month"}.` });
      setPartOpen(false);
      load();
    } catch (e) {
      toast({ title: "Couldn't record the payment", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setPartBusy(false);
    }
  }
  const strn = (n: number | null) => (n != null ? String(n) : "");
  function openEditSlip(s: Payslip) {
    setEditSlip({
      id: s.id, period_label: s.period_label ?? "",
      gross: strn(s.gross), back_pay: strn(s.back_pay), income_tax: strn(s.income_tax), employee_ni: strn(s.employee_ni),
      student_loan: strn(s.student_loan), taxable_gross_pay: strn(s.taxable_gross_pay), net: strn(s.net), employer_ni: strn(s.employer_ni),
    });
  }
  async function saveEditSlip() {
    if (!editSlip) return;
    const e = editSlip;
    setSavingEdit(true);
    const { error } = await supabase.from("payslips").update({
      period_label: e.period_label.trim() || null,
      gross: num(e.gross) || null, back_pay: num(e.back_pay) || null, income_tax: num(e.income_tax) || null,
      employee_ni: num(e.employee_ni) || null, student_loan: num(e.student_loan) || null,
      taxable_gross_pay: num(e.taxable_gross_pay) || null, net: num(e.net) || null, employer_ni: num(e.employer_ni) || null,
    }).eq("id", e.id);
    setSavingEdit(false);
    if (error) { toast({ title: "Couldn't update payslip", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Payslip updated" });
    setEditSlip(null);
    load();
  }
  async function deleteSlip(s: Payslip) {
    if (!window.confirm(`Delete the ${s.period_label ?? "this"} payslip for ${empName(s.account_id)}? This cannot be undone.`)) return;
    if (s.document_path) await supabase.storage.from("payslips").remove([s.document_path]).catch(() => {});
    const { error } = await supabase.from("payslips").delete().eq("id", s.id);
    if (error) { toast({ title: "Couldn't delete payslip", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Payslip deleted" });
    load();
  }

  async function revertSalary(s: Payslip) {
    // Undo "Mark paid": remove the balancing payment it recorded, then unsettle.
    const { data: latest } = await supabase.from("salary_payments").select("id").eq("payslip_id", s.id).order("created_at", { ascending: false }).limit(1);
    const latestId = (latest as { id: string }[] | null)?.[0]?.id;
    if (latestId) await supabase.from("salary_payments").delete().eq("id", latestId);
    const { error } = await supabase.from("payslips").update({ salary_paid_at: null }).eq("id", s.id);
    if (error) { toast({ title: "Couldn't revert", description: error.message, variant: "destructive" }); return; }
    grace.cancel(s.id);
    if (latestId) setPays((prev) => prev.filter((p) => p.id !== latestId));
    setSlips((prev) => prev.map((x) => x.id === s.id ? { ...x, justPaid: false, salary_paid_at: null } : x));
  }

  async function importTracker(emp: EmployeeRow, file: File) {
    setImportingId(emp.id);
    try {
      const rows = parseTracker(await file.text());
      if (rows.length === 0) { toast({ title: "No monthly rows found in that CSV", variant: "destructive" }); return; }
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      // Replace the periods present in the file so re-importing is clean.
      await supabase.from("payslips").delete().eq("account_id", emp.id).in("period_label", rows.map((r) => r.period_label));
      const { error } = await supabase.from("payslips").insert(rows.map((r) => ({
        account_id: emp.id,
        period_label: r.period_label,
        period_end: r.period_end,
        gross: r.gross,
        income_tax: r.income_tax,
        employee_ni: r.employee_ni,
        student_loan: r.student_loan,
        net: r.net,
        employer_ni: r.employer_ni,
        employer_pension: 0,
        employer_cost: r.gross + r.employer_ni,
        created_by: userId,
      })));
      if (error) throw error;
      const past = rows.filter((r) => r.period_end <= isoToday).length;
      toast({ title: `Imported ${rows.length} months`, description: `${past} to date · ${rows.length - past} forecast, from the tracker.` });
      load();
    } catch (e) {
      toast({ title: "Couldn't import the tracker", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setImportingId(null);
    }
  }
  const totalProvision = rows.reduce((s, r) => s + estimatePayroll(r.gross_salary_annual).employerCost, 0);

  function openFor(emp: EmployeeRow) {
    setTarget(emp);
    setFile(null);
    setF({ period_label: "", period_end: "", gross: "", net: "", employer_ni: "", employer_pension: "" });
    setOpen(true);
  }

  async function readPayslip() {
    if (!file) { toast({ title: "Select the payslip PDF first", variant: "destructive" }); return; }
    setParsing(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { const r = reader.result as string; const c = r.indexOf(","); resolve(c >= 0 ? r.slice(c + 1) : r); };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("parse-document", {
        body: { document_type: "payslip", file_data_base64: b64, file_mime_type: file.type },
      });
      if (error) throw error;
      if (!data?.success || !data?.data) throw new Error(data?.error || "Could not read the payslip");
      const p = data.data as Record<string, any>;
      // Fill employer figures from the estimate if the payslip didn't show them.
      const grossN = Number(p.gross) || 0;
      const est = estimateMonthlyEmployerOnCosts(grossN);
      setF({
        period_label: p.period_label ?? "",
        period_end: typeof p.period_end === "string" ? p.period_end : "",
        gross: p.gross != null ? String(p.gross) : "",
        net: p.net != null ? String(p.net) : "",
        employer_ni: p.employer_ni != null ? String(p.employer_ni) : (grossN ? est.employerNi.toFixed(2) : ""),
        employer_pension: p.employer_pension != null ? String(p.employer_pension) : (grossN ? est.employerPension.toFixed(2) : ""),
      });
      toast({ title: "Payslip read", description: "Check the figures, then save." });
    } catch (e) {
      toast({ title: "Couldn't read the payslip", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  const dialogCost = num(f.gross) + num(f.employer_ni) + num(f.employer_pension);

  async function save() {
    if (!target) return;
    if (!(num(f.gross) > 0)) { toast({ title: "Enter the gross for the period", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      let documentPath: string | null = null;
      if (file) {
        const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".pdf";
        documentPath = `${target.id}/${id}${ext}`;
        const { error: upErr } = await supabase.storage.from("payslips").upload(documentPath, file, { contentType: file.type, upsert: true });
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from("payslips").insert({
        id, account_id: target.id,
        period_label: f.period_label.trim() || null,
        period_end: f.period_end || null,
        gross: num(f.gross) || null,
        net: num(f.net) || null,
        employer_ni: num(f.employer_ni) || null,
        employer_pension: num(f.employer_pension) || null,
        employer_cost: dialogCost || null,
        document_path: documentPath,
        created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      });
      if (error) throw error;
      // File the PDF to Dropbox (non-fatal).
      if (file) {
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => { const s = r.result as string; const c = s.indexOf(","); resolve(c >= 0 ? s.slice(c + 1) : s); };
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        await supabase.functions.invoke("dropbox-save-payslip", {
          body: { pdf_base64: b64, mime: file.type, employee_name: target.name, period_end: f.period_end || "", payslip_id: id },
        }).then(() => {}, () => {});
      }
      toast({ title: "Payslip recorded" });
      setOpen(false);
      load();
    } catch (e) {
      toast({ title: "Couldn't save the payslip", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Salaries</h2></div>
        <SectionTotal amount={totalOwed} format={money} />
      </div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
          <Plus className="h-3 w-3" strokeWidth={1.5} />Add employee
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No employees yet. Add one via Team → Add member → existing agreement, set Engagement to “Employee”.</div>
      ) : (
        <>
          {/* Employees + their import / payslip actions */}
          <div className="mb-4 flex flex-wrap gap-2">
            {rows.map((r) => {
              const e = estimatePayroll(r.gross_salary_annual);
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-sm border border-white/[0.07] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-strong">{r.name}</p>
                    <p className="text-[10px] text-recessive">{r.position ?? "Employee"} · net {money2(e.net / 12)}/mo</p>
                  </div>
                  <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]">
                    {importingId === r.id ? <BrandLoader size="sm" className="h-3 w-3" /> : <Upload className="h-3 w-3" strokeWidth={1.5} />}
                    Import
                    <input type="file" accept=".csv,text/csv" className="hidden" disabled={importingId === r.id}
                      onChange={(e2) => { const file = e2.target.files?.[0]; if (file) importTracker(r, file); e2.target.value = ""; }} />
                  </label>
                  <button onClick={() => openFor(r)} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                    <Plus className="h-3 w-3" strokeWidth={1.5} />Payslip
                  </button>
                </div>
              );
            })}
          </div>

          {/* Net salary owed, by month */}
          {owed.length === 0 ? (
            <div className="ssr-tile p-8 text-center text-recessive text-sm">No salary owed — every due month is paid. Import a tracker or add a payslip to populate.</div>
          ) : (
            <>
            <TableToolbar>
              <TableSearch value={search} onChange={setSearch} placeholder="SEARCH EMPLOYEE" width="w-[240px]" />
              <TableFilterSelect value={payslipFilter} onChange={(v) => setPayslipFilter(v as typeof payslipFilter)} width="w-[170px]"
                options={[{ value: "all", label: "All payslips" }, { value: "missing", label: "Payslip missing" }, { value: "filed", label: "Payslip filed" }]} />
            </TableToolbar>
            <div className="ssr-tile overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <SortTh id="employee" label="Employee" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="month" label="Month" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="net" label="Net owed" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                    <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal">Payslip</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sortedOwed.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-recessive text-sm">No months match.</td></tr>
                  ) : sortedOwed.map((s) => (
                    <tr key={s.id} className={`border-b border-white/[0.05] last:border-0 ${s.justPaid ? "opacity-45" : ""}`}>
                      <td className="px-4 py-3 text-strong">{empName(s.account_id)}</td>
                      <td className="px-4 py-3 text-standard">{s.period_label ?? s.period_end ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-strong">
                        {money2(Number(s.net))}
                        {paidFor(s.id) > 0.01 && <span className="ml-2 text-[10px] tabular-nums text-[#ecd39c]">{money2(paidFor(s.id))} paid</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <PayslipFlag payslipId={s.id} accountId={s.account_id} employeeName={empName(s.account_id)} periodEnd={s.period_end}
                          documentPath={s.document_path} filed={!!s.document_path || !!s.dropbox_path} onDone={load} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {s.justPaid
                          ? <span className="inline-flex items-center gap-3"><span className="text-[11px] tabular-nums text-gold">{formatCountdown((s.paidAt ?? 0) + GRACE_MS - now)}</span><button onClick={() => revertSalary(s)} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75">Revert</button></span>
                          : <span className="inline-flex items-center gap-4">
                              <button onClick={() => openEditSlip(s)} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/80">Edit</button>
                              <button onClick={() => openPartPay(s)} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]">Part-pay</button>
                              <button onClick={() => markSalaryPaid(s)} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>
                              <button onClick={() => deleteSlip(s)} className="text-[10px] uppercase tracking-[0.16em] text-white/30 hover:text-rose-400">Delete</button>
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
            Net take-home owed to employees. The PAYE/NI owed to HMRC shows in Taxes. {TAX_YEAR} provision = {money(totalProvision)}/yr.
          </p>
        </>
      )}

      <Dialog open={!!editSlip} onOpenChange={(o) => { if (!o) setEditSlip(null); }}>
        <DialogContent className="max-w-lg rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Salaries · Edit payslip</p>
            <DialogTitle className="font-serif font-normal text-2xl">{editSlip?.period_label || "Payslip"}</DialogTitle>
          </DialogHeader>
          {editSlip && (
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="col-span-2 space-y-1.5"><Label>Period</Label><Input value={editSlip.period_label} onChange={(e) => setEditSlip((x) => x && { ...x, period_label: e.target.value })} className="rounded-sm" /></div>
              {([
                ["Gross (£)", "gross"], ["Back Pay (£)", "back_pay"], ["Tax (£)", "income_tax"], ["National Insurance (£)", "employee_ni"],
                ["Student Loan (£)", "student_loan"], ["Taxable Gross Pay (£)", "taxable_gross_pay"], ["Net take-home (£)", "net"], ["Employer NI (£)", "employer_ni"],
              ] as const).map(([label, key]) => (
                <div key={key} className="space-y-1.5"><Label>{label}</Label>
                  <Input inputMode="decimal" value={editSlip[key]} onChange={(e) => setEditSlip((x) => x && { ...x, [key]: e.target.value })} className="rounded-sm" /></div>
              ))}
            </div>
          )}
          <DialogFooter>
            <button type="button" onClick={() => setEditSlip(null)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={saveEditSlip} disabled={savingEdit} className="rounded-sm">{savingEdit ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Salaries · Payslip</p>
            <DialogTitle className="font-serif font-normal text-2xl">{target?.name ?? "Payslip"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Payslip PDF</Label>
              <div className="flex items-center gap-3">
                <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="rounded-sm" />
                <button type="button" onClick={readPayslip} disabled={parsing || !file} className="shrink-0 text-[11px] uppercase tracking-[0.15em] font-medium border border-input bg-background px-3 py-2 rounded-sm hover:bg-muted transition-colors disabled:opacity-40">
                  {parsing ? "Reading…" : "Read"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Period</Label>
                <Input value={f.period_label} onChange={(e) => setF((x) => ({ ...x, period_label: e.target.value }))} placeholder="August 2025" className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>Period end</Label>
                <Input type="date" value={f.period_end} onChange={(e) => setF((x) => ({ ...x, period_end: e.target.value }))} className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>Gross (£)</Label>
                <Input inputMode="decimal" value={f.gross} onChange={(e) => setF((x) => ({ ...x, gross: e.target.value }))} className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>Net take-home (£)</Label>
                <Input inputMode="decimal" value={f.net} onChange={(e) => setF((x) => ({ ...x, net: e.target.value }))} className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>Employer NI (£)</Label>
                <Input inputMode="decimal" value={f.employer_ni} onChange={(e) => setF((x) => ({ ...x, employer_ni: e.target.value }))} className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>Employer pension (£)</Label>
                <Input inputMode="decimal" value={f.employer_pension} onChange={(e) => setF((x) => ({ ...x, employer_pension: e.target.value }))} className="rounded-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Total cost to studio</span>
              <span className="tabular-nums text-strong">{money2(dialogCost)}</span>
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={save} disabled={saving} className="rounded-sm">{saving ? "Saving…" : "Save payslip"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={partOpen} onOpenChange={setPartOpen}>
        <DialogContent className="max-w-sm rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Salaries · Instalment</p>
            <DialogTitle className="font-serif font-normal text-2xl">Record a payment</DialogTitle>
          </DialogHeader>
          {partTarget && (
            <p className="text-sm text-foreground/45">
              {empName(partTarget.account_id)} · {partTarget.period_label ?? partTarget.period_end ?? ""} — net {money2(Number(partTarget.net || 0))}, {money2(paidFor(partTarget.id))} paid so far.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5"><Label>Amount (£)</Label><Input inputMode="decimal" value={partForm.amount} onChange={(e) => setPartForm((x) => ({ ...x, amount: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Date paid</Label><Input type="date" value={partForm.date} onChange={(e) => setPartForm((x) => ({ ...x, date: e.target.value }))} className="rounded-sm" /></div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setPartOpen(false)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={savePartPay} disabled={partBusy} className="rounded-sm">{partBusy ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Salaries · Payroll record</p>
            <DialogTitle className="font-serif font-normal text-2xl">Add a salaried person</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/45">A payroll-only record for the accounts — no login or team invite. Import their payslips after.</p>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Name</Label>
              <Input value={addForm.name} onChange={(e) => setAddForm((x) => ({ ...x, name: e.target.value }))} placeholder="Fred Colomb" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Position</Label>
              <Input value={addForm.position} onChange={(e) => setAddForm((x) => ({ ...x, position: e.target.value }))} placeholder="Creative Director" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Gross annual salary (£)</Label>
              <Input inputMode="decimal" value={addForm.salary} onChange={(e) => setAddForm((x) => ({ ...x, salary: e.target.value }))} placeholder="45000" className="rounded-sm" />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setAddOpen(false)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={addPerson} disabled={addBusy} className="rounded-sm">{addBusy ? "Adding…" : "Add person"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
