import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { OverheadForm } from "@/components/admin/overheads/OverheadForm";
import { OverheadDetail } from "@/components/admin/overheads/OverheadDetail";
import { BulkOverheadDropzone } from "@/components/admin/overheads/BulkOverheadDropzone";
import { RecurringOverheadsDialog } from "@/components/admin/overheads/RecurringOverheadsDialog";
import { IncomeInvoiceUpload } from "@/components/admin/finance/IncomeInvoiceUpload";
import { BulkIncomeDropzone } from "@/components/admin/finance/BulkIncomeDropzone";
import {
  FinanceSummary,
  type FinanceSectionKey,
  type MoneyOutKind,
} from "@/components/admin/finance/FinanceSummary";
import { VatIndicator } from "@/components/admin/finance/VatIndicator";
import { MoneyInTable } from "@/components/admin/finance/MoneyInTable";
import { MoneyOutTable } from "@/components/admin/finance/MoneyOutTable";
import { OutstandingCards } from "@/components/admin/finance/OutstandingCards";
import { PayableDetail } from "@/components/admin/finance/PayableDetail";
import {
  InvoiceViewer,
  type InvoiceViewerData,
} from "@/components/invoices/InvoiceViewer";
import {
  buildMoneyOutRows,
  computeQuarterVat,
  formatDate,
  getCurrentQuarter,
  getPreviousQuarter,
  outstandingFor,
  payablePeriodDate,
  payslipEmployerCost,
  type ExpenseCategory,
  type MoneyInInvoice,
  type MoneyOutRow,
  type Overhead,
  type Payable,
  type PayablePaidStatus,
  type PayslipCost,
} from "@/lib/finance";
import { attachPayslip, viewPayslip } from "@/lib/payslipAttach";
import { useFx } from "@/contexts/FxContext";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "@/integrations/supabase/client";

type MoneyOutTypeFilter = "all" | MoneyOutKind;
type MoneyOutStatusFilter = "all" | PayablePaidStatus;
type InvoiceStatusFilter = "all" | "draft" | "sent" | "paid" | "overdue" | "pending" | "cancelled";

interface PeriodOption {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

export default function AdminPnL() {
  const [overheads, setOverheads] = useState<Overhead[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [invoices, setInvoices] = useState<MoneyInInvoice[]>([]);
  const [payslips, setPayslips] = useState<PayslipCost[]>([]);
  const [loading, setLoading] = useState(true);

  // Salary rows in the money-out ledger carry a "payslip missing" flag; clicking
  // one opens this hidden picker to upload that month's payslip.
  const salaryAttachInputRef = useRef<HTMLInputElement>(null);
  const salaryAttachTargetRef = useRef<{ id: string; accountId: string; employeeName: string; periodEnd: string | null } | null>(null);

  // Which detail section is open below the summary (null = none; click a
  // summary tile to open it, click it again to close).
  const [activeSection, setActiveSection] = useState<FinanceSectionKey | null>(null);

  // Period drives the whole page — the spine figures and both detail tables.
  // Empty resolves to the first option (current quarter) once options build.
  const [periodKey, setPeriodKey] = useState<string>("");

  // Money out — one ledger over overheads (fixed) + payables (variable).
  const [moType, setMoType] = useState<MoneyOutTypeFilter>("all");
  const [moSearch, setMoSearch] = useState("");
  const [moStatus, setMoStatus] = useState<MoneyOutStatusFilter>("all");

  const [invSearch, setInvSearch] = useState("");
  const [invStatus, setInvStatus] = useState<InvoiceStatusFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Overhead | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit">("edit");
  const [prefillDefaults, setPrefillDefaults] = useState<Partial<Overhead> | null>(null);
  // Non-null == an upload was staged to `overhead-invoices/staging/...` and
  // still needs cleanup if the review gate closes without a save.
  const pendingStagingPathRef = useRef<string | null>(null);
  // Bulk-drop review queue: parsed invoices awaiting Fred's per-invoice
  // validation. The form advances to the next on save OR skip (cancel).
  const reviewQueueRef = useRef<Partial<Overhead>[]>([]);
  const reviewTotalRef = useRef(0);
  const reviewPosRef = useRef(0);
  const justSavedRef = useRef(false);
  const [reviewLabel, setReviewLabel] = useState<string | null>(null);

  const [overheadDetailOpen, setOverheadDetailOpen] = useState(false);
  const [selectedOverhead, setSelectedOverhead] = useState<Overhead | null>(null);

  const [invoiceViewing, setInvoiceViewing] = useState<InvoiceViewerData | null>(null);

  const [payables, setPayables] = useState<Payable[]>([]);
  const [payableBaseId, setPayableBaseId] = useState<string | null>(null);
  const [selectedPayable, setSelectedPayable] = useState<Payable | null>(null);
  const [payableDetailOpen, setPayableDetailOpen] = useState(false);
  const [refreshingPayables, setRefreshingPayables] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const { toast } = useToast();
  const fx = useFx();

  const currentQuarter = useMemo(() => getCurrentQuarter(), []);
  const previousQuarter = useMemo(() => getPreviousQuarter(currentQuarter), [currentQuarter]);

  // Prior years that actually carry data — a year with nothing recorded is
  // never offered as a period.
  const dataYears = useMemo<Set<number>>(() => {
    const years = new Set<number>();
    const add = (d: string | null | undefined) => {
      if (!d) return;
      const dt = new Date(d);
      if (!isNaN(dt.getTime())) years.add(dt.getFullYear());
    };
    invoices.forEach((i) => add(i.issued_at ?? i.created_at));
    overheads.forEach((o) => add(o.invoice_date));
    payables.forEach((p) => add(payablePeriodDate(p)));
    payslips.forEach((p) => add(p.period_end));
    return years;
  }, [invoices, overheads, payables, payslips]);

  // Presets: the current quarter, then each earlier quarter of this year, then
  // every prior year (with data) as its own entry — most recent first.
  const periodOptions = useMemo<PeriodOption[]>(() => {
    const y = currentQuarter.year;
    const opts: PeriodOption[] = [
      {
        key: `q:${y}:${currentQuarter.q}`,
        label: currentQuarter.label,
        start: currentQuarter.start,
        end: currentQuarter.end,
      },
    ];
    for (let q = currentQuarter.q - 1; q >= 1; q--) {
      opts.push({
        key: `q:${y}:${q}`,
        label: `Q${q} ${y}`,
        start: new Date(y, (q - 1) * 3, 1, 0, 0, 0, 0),
        end: new Date(y, (q - 1) * 3 + 3, 0, 23, 59, 59, 999),
      });
    }
    for (const yr of Array.from(dataYears).filter((v) => v < y).sort((a, b) => b - a)) {
      opts.push({
        key: `year:${yr}`,
        label: String(yr),
        start: new Date(yr, 0, 1, 0, 0, 0, 0),
        end: new Date(yr, 11, 31, 23, 59, 59, 999),
      });
    }
    return opts;
  }, [currentQuarter, dataYears]);

  const period = periodOptions.find((o) => o.key === periodKey) ?? periodOptions[0];

  const inPeriod = useMemo(() => {
    return (dateStr: string | null | undefined) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      return d >= period.start && d <= period.end;
    };
  }, [period]);

  async function fetchAll() {
    setLoading(true);
    const [
      { data: ovs, error: ovErr },
      { data: cats, error: cErr },
      { data: invs, error: iErr },
      { data: slips },
      { data: emps },
    ] = await Promise.all([
      supabase.from("overheads" as any).select("*").order("invoice_date", { ascending: false }),
      supabase.from("expense_categories" as any).select("*").order("code"),
      supabase.from("invoices").select("*").order("created_at", { ascending: false }),
      supabase.from("payslips").select("id, account_id, period_end, period_label, gross, employer_ni, employer_pension, employer_cost, document_path, dropbox_path, salary_paid_at, tax_paid_at"),
      supabase.from("accounts").select("id, company_name").eq("employment_type", "employee"),
    ]);
    if (ovErr) toast({ title: "Failed to load overheads", description: ovErr.message, variant: "destructive" });
    if (cErr) toast({ title: "Failed to load categories", description: cErr.message, variant: "destructive" });
    if (iErr) toast({ title: "Failed to load invoices", description: iErr.message, variant: "destructive" });

    const overheadsList = ((ovs as unknown) as Overhead[]) ?? [];
    const catsList = ((cats as unknown) as ExpenseCategory[]) ?? [];
    const invoicesList = (invs ?? []) as any[];

    const accountIds = Array.from(new Set(invoicesList.map((i) => i.account_id).filter(Boolean)));
    let accountsMap: Record<string, string> = {};
    if (accountIds.length) {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name")
        .in("id", accountIds);
      accountsMap = Object.fromEntries((accs ?? []).map((a: any) => [a.id, a.company_name]));
    }

    const empName = new Map<string, string>(((emps ?? []) as any[]).map((a) => [a.id, (a.company_name ?? "—").replace(/[_-]+/g, " ")]));
    setPayslips(((slips ?? []) as any[]).map((p) => ({
      id: p.id,
      account_id: p.account_id,
      employee_name: empName.get(p.account_id) ?? "Employee",
      period_end: p.period_end,
      period_label: p.period_label,
      gross: p.gross,
      employer_ni: p.employer_ni,
      employer_pension: p.employer_pension,
      employer_cost: p.employer_cost,
      document_path: p.document_path,
      dropbox_path: p.dropbox_path,
      salary_paid_at: p.salary_paid_at,
      tax_paid_at: p.tax_paid_at,
    })) as PayslipCost[]);

    setOverheads(overheadsList);
    setCategories(catsList);
    setInvoices(
      invoicesList.map((i) => ({
        ...i,
        account_company: i.account_id ? accountsMap[i.account_id] ?? null : null,
      })) as MoneyInInvoice[],
    );
    setLoading(false);
  }

  async function fetchPayables() {
    const { data, error } = await supabase
      .from("payables_snapshot" as any)
      .select("*")
      .order("period_date", { ascending: false, nullsFirst: false });
    if (error) {
      toast({ title: "Failed to load payables", description: error.message, variant: "destructive" });
      return;
    }
    const rows = ((data as unknown) as Payable[]) ?? [];
    setPayables(rows);
    if (rows.length) setLastSyncedAt(rows[0].synced_at);
  }

  async function fetchPayableBaseId() {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "airtable_payables_field_config")
      .maybeSingle();
    const bid = (data?.value as any)?.base_id ?? null;
    if (bid) setPayableBaseId(bid);
  }

  async function handleRefreshPayables() {
    setRefreshingPayables(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast({ title: "Not signed in", variant: "destructive" });
        return;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/payables-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const result = await res.json();
      if (result?.ok) {
        await fetchPayables();
        toast({
          title: "Payables synced",
          description: `${result.duration_ms}ms · ${Object.values(result.counts ?? {}).reduce((s: number, c: any) => s + (c?.upserted ?? 0), 0)} rows`,
        });
      } else {
        toast({
          title: "Sync completed with errors",
          description: JSON.stringify(result?.errors ?? result?.error ?? "unknown"),
          variant: "destructive",
        });
        await fetchPayables();
      }
    } catch (e) {
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRefreshingPayables(false);
    }
  }

  useEffect(() => {
    fetchAll();
    fetchPayables();
    fetchPayableBaseId();
  }, []);

  const catByCode = useMemo(
    () => new Map(categories.map((c) => [c.code, c] as const)),
    [categories],
  );

  // Money out — normalise both sources into one ledger, then filter.
  const moneyOutRows = useMemo(
    () =>
      buildMoneyOutRows(overheads, payables, (code) => {
        const c = code ? catByCode.get(code) : null;
        return c ? `${c.code} — ${c.name}` : code;
      }, payslips),
    [overheads, payables, catByCode, payslips],
  );

  const filteredMoneyOut = useMemo(() => {
    return moneyOutRows.filter((r) => {
      if (moType !== "all" && r.kind !== moType) return false;
      if (moStatus !== "all" && r.status !== moStatus) return false;
      if (!inPeriod(r.date)) return false;
      if (moSearch.trim() && !r.name.toLowerCase().includes(moSearch.trim().toLowerCase()))
        return false;
      return true;
    });
  }, [moneyOutRows, moType, moStatus, moSearch, inPeriod]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((r) => {
      if (invStatus !== "all" && r.status !== invStatus) return false;
      if (!inPeriod(r.issued_at ?? r.created_at)) return false;
      if (invSearch.trim()) {
        const q = invSearch.trim().toLowerCase();
        const co = (r.account_company ?? "").toLowerCase();
        const num = (r.invoice_number ?? r.reference_number ?? "").toLowerCase();
        if (!co.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, invStatus, invSearch, inPeriod]);

  // ---- Summary spine (selected period, VAT-inclusive) ---------------------
  // Outstanding is "as of now" — it deliberately ignores the period.
  // Outstanding is "as of now" (unpaid) → live FX.
  const outstandingIn = useMemo(
    () =>
      invoices
        .filter((i) => i.status === "sent" || i.status === "overdue" || i.status === "pending")
        .reduce((s, i) => s + fx.gbp(Number(i.amount ?? 0), i.currency ?? "GBP", null), 0),
    [invoices, fx],
  );
  const outstandingOut = useMemo(
    () =>
      overheads
        .filter((r) => r.payment_status === "unpaid")
        .reduce((s, r) => s + fx.gbp(Number(r.gross_amount ?? 0), r.currency ?? "GBP", null), 0) +
      payables.reduce((s, p) => s + outstandingFor(p), 0),
    [overheads, payables, fx],
  );

  // Revenue — paid invoices lock to their paid date, unpaid use the live rate.
  const revenue = useMemo(
    () =>
      invoices
        .filter((i) => inPeriod(i.issued_at ?? i.created_at))
        .reduce((s, i) => s + fx.gbp(Number(i.amount ?? 0), i.currency ?? "GBP", i.status === "paid" ? i.paid_at : null), 0),
    [invoices, inPeriod, fx],
  );
  // Operational fixed cost = overheads + payroll (employer cost per month).
  const fixedCost = useMemo(
    () =>
      overheads
        .filter((o) => inPeriod(o.invoice_date))
        .reduce((s, o) => s + fx.gbp(Number(o.gross_amount ?? 0), o.currency ?? "GBP", o.payment_status === "paid" ? o.payment_date : null), 0) +
      payslips
        .filter((p) => inPeriod(p.period_end))
        .reduce((s, p) => s + payslipEmployerCost(p), 0),
    [overheads, payslips, inPeriod, fx],
  );
  const variableCost = useMemo(
    () =>
      payables
        .filter((p) => inPeriod(payablePeriodDate(p)))
        .reduce((s, p) => s + Number(p.invoice_total ?? 0), 0),
    [payables, inPeriod],
  );
  const grossProfit = revenue - variableCost;
  const operatingProfit = grossProfit - fixedCost;

  const currentVat = useMemo(
    () => computeQuarterVat(invoices, overheads, currentQuarter),
    [invoices, overheads, currentQuarter],
  );
  const closedVat = useMemo(
    () => computeQuarterVat(invoices, overheads, previousQuarter),
    [invoices, overheads, previousQuarter],
  );

  // Net VAT for the SELECTED period (cash basis): output VAT on invoices paid
  // in-period minus input VAT on overheads paid in-period (reverse-charge
  // excluded). Because the spine is VAT-inclusive, subtracting this reconciles
  // Operating profit down to a net-of-VAT Net profit.
  const periodVat = useMemo(() => {
    const output = invoices
      .filter((i) => i.status === "paid" && inPeriod(i.paid_at))
      .reduce((s, i) => s + fx.gbp(Number(i.vat_amount ?? 0), i.currency ?? "GBP", i.paid_at), 0);
    const input = overheads
      .filter((o) => o.payment_status === "paid" && inPeriod(o.payment_date) && !o.is_reverse_charge)
      .reduce((s, o) => s + fx.gbp(Number(o.vat_amount ?? 0), o.currency ?? "GBP", o.payment_date), 0);
    return output - input;
  }, [invoices, overheads, inPeriod, fx]);

  const netProfit = operatingProfit - periodVat;

  // ---- Row-click / open handlers -----------------------------------------
  function openMoneyOutRow(r: MoneyOutRow) {
    if (r.overhead) {
      setSelectedOverhead(r.overhead);
      setOverheadDetailOpen(true);
    } else if (r.payable) {
      setSelectedPayable(r.payable);
      setPayableDetailOpen(true);
    } else if (r.salary) {
      // Filed → view the PDF; missing → open the picker to attach this month's payslip.
      if (r.salary.documentPath) {
        void viewPayslip(r.salary.documentPath);
      } else {
        salaryAttachTargetRef.current = { id: r.salary.id, accountId: r.salary.accountId, employeeName: r.salary.employeeName, periodEnd: r.salary.periodEnd };
        salaryAttachInputRef.current?.click();
      }
    }
  }

  async function handleSalaryAttachFile(file: File | undefined) {
    const target = salaryAttachTargetRef.current;
    salaryAttachTargetRef.current = null;
    if (!file || !target) return;
    try {
      const { figuresUpdated } = await attachPayslip({ payslipId: target.id, accountId: target.accountId, employeeName: target.employeeName, periodEnd: target.periodEnd, file });
      toast({ title: "Payslip attached", description: figuresUpdated ? "Figures updated and filed to Dropbox." : "Filed to Dropbox — figures kept." });
      fetchAll();
    } catch (e) {
      toast({ title: "Couldn't attach the payslip", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

  // "Invoice missing" chip → open the overhead's edit form so its PDF can be
  // attached (which files it to Dropbox), like the payslip-missing flow.
  function attachOverheadInvoice(r: MoneyOutRow) {
    if (!r.overhead) return;
    setEditing(r.overhead);
    setPrefillDefaults(null);
    pendingStagingPathRef.current = null;
    setFormMode("edit");
    setFormOpen(true);
  }

  function openOverheadEditFromDetail() {
    if (!selectedOverhead) return;
    setEditing(selectedOverhead);
    setPrefillDefaults(null);
    pendingStagingPathRef.current = null;
    setFormMode("edit");
    setOverheadDetailOpen(false);
    setFormOpen(true);
  }

  // ── Bulk-drop review queue ────────────────────────────────────────────────
  function startReviewQueue(items: Partial<Overhead>[]) {
    if (!items.length) return;
    reviewTotalRef.current = items.length;
    reviewPosRef.current = 1;
    reviewQueueRef.current = items.slice(1);
    setReviewLabel(items.length > 1 ? `1 of ${items.length}` : null);
    openCreateExpenseFromUpload(items[0]);
  }

  function advanceReviewQueue() {
    const next = reviewQueueRef.current.shift();
    if (next) {
      reviewPosRef.current += 1;
      setReviewLabel(reviewTotalRef.current > 1 ? `${reviewPosRef.current} of ${reviewTotalRef.current}` : null);
      openCreateExpenseFromUpload(next);
    } else {
      reviewTotalRef.current = 0;
      reviewPosRef.current = 0;
      setReviewLabel(null);
    }
  }

  function clearReviewQueue() {
    reviewQueueRef.current = [];
    reviewTotalRef.current = 0;
    reviewPosRef.current = 0;
    setReviewLabel(null);
  }

  function openCreateExpense() {
    clearReviewQueue();
    setEditing(null);
    setPrefillDefaults(null);
    pendingStagingPathRef.current = null;
    setFormMode("create");
    setFormOpen(true);
  }

  function openCreateExpenseFromUpload(defaults: Partial<Overhead>) {
    setEditing(null);
    setPrefillDefaults(defaults);
    pendingStagingPathRef.current = defaults.staging_storage_path ?? null;
    setFormMode("create");
    setFormOpen(true);
  }

  function handleOverheadFormOpenChange(nextOpen: boolean) {
    if (nextOpen) { setFormOpen(true); return; }
    setFormOpen(false);
    const saved = justSavedRef.current;
    justSavedRef.current = false;
    // Closing without a save leaves an orphaned staged upload — clean it
    // (fire-and-forget so the queue can advance seamlessly in the same tick).
    if (!saved) {
      const orphan = pendingStagingPathRef.current;
      pendingStagingPathRef.current = null;
      if (orphan) {
        void supabase.storage.from("overhead-invoices").remove([orphan]).then(
          ({ error }) => { if (error) console.warn("[AdminPnL] failed to clean up staged file", error); },
        );
      }
    }
    // Advance to the next queued invoice (skip on cancel, next on save).
    if (reviewQueueRef.current.length > 0) advanceReviewQueue();
    else if (reviewTotalRef.current > 0) clearReviewQueue();
  }

  function handleOverheadSaved() {
    // Save owns the staging path now — clear the ref before onOpenChange fires.
    justSavedRef.current = true;
    pendingStagingPathRef.current = null;
    fetchAll();
  }

  // Clicking a summary tile opens/closes a detail section. Cost tiles also
  // pre-filter Money out to fixed / variable.
  function handleSelectSection(key: FinanceSectionKey, kind?: MoneyOutKind) {
    if (key === "moneyOut") {
      const nextType: MoneyOutTypeFilter = kind ?? "all";
      setActiveSection((cur) => (cur === "moneyOut" && moType === nextType ? null : "moneyOut"));
      setMoType(nextType);
    } else {
      setActiveSection((cur) => (cur === key ? null : key));
    }
  }

  // Realtime — reflect Dropbox filing state on overheads without a manual
  // reload (the trigger + edge function UPDATE the row when the file lands).
  const fetchAllRef = useRef(fetchAll);
  useEffect(() => { fetchAllRef.current = fetchAll; });
  useEffect(() => {
    const channel = supabase
      .channel("admin-overheads-realtime-pnl")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "overheads" },
        () => { void fetchAllRef.current(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  function openInvoiceViewer(r: MoneyInInvoice) {
    const items = Array.isArray(r.line_items) ? (r.line_items as any) : [];
    setInvoiceViewing({
      id: r.id,
      invoice_number: r.invoice_number,
      reference_number: r.reference_number,
      amount: Number(r.amount),
      currency: r.currency ?? "GBP",
      status: r.status,
      due_date: r.due_date,
      issued_at: r.issued_at,
      created_at: r.created_at,
      notes: r.notes,
      line_items: items,
      client_company: r.account_company,
      account_id: r.account_id,
      subtotal: r.subtotal != null ? Number(r.subtotal) : null,
      vat_rate: r.vat_rate != null ? Number(r.vat_rate) : null,
      vat_amount: r.vat_amount != null ? Number(r.vat_amount) : null,
    });
  }

  return (
    <AdminLayout panel>
      {/* Header — page-name eyebrow (matches the dashboard's Studio Overview) */}
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">P&amp;L</span>
        </div>
        <p className="mt-3 text-sm text-recessive">
          Revenue, costs, and cash-basis VAT — choose the period below.
        </p>
      </div>

      {/* Summary — the P&L spine leads the surface */}
      <section className="ssr-zone mb-4">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Summary</h2>
          </div>
          {/* Period — underline select, matching the Money Out / Revenue filters */}
          <div className="group relative w-[130px] pb-[7px]">
            <Select value={period.key} onValueChange={setPeriodKey}>
              <SelectTrigger className="h-auto justify-end gap-2 rounded-none border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 focus:ring-0 focus:ring-offset-0 [&>svg]:text-[#C9A96A]/60 [&>svg]:opacity-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
          </div>
        </div>
        <FinanceSummary
          revenue={revenue}
          variableCost={variableCost}
          fixedCost={fixedCost}
          grossProfit={grossProfit}
          operatingProfit={operatingProfit}
          netProfit={netProfit}
          vatNet={periodVat}
          vatLabel={period.label}
          active={activeSection}
          moneyOutType={moType}
          onSelect={handleSelectSection}
        />
      </section>

      {/* VAT panel — shown when its summary tile is selected */}
      {activeSection === "vat" && (
        <section className="ssr-zone mb-4">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">VAT</h2>
          </div>
          <VatIndicator current={currentVat} closed={closedVat} />
        </section>
      )}

      {/* Money OUT — one ledger over fixed (overheads) + variable (payables) */}
      {activeSection === "moneyOut" && (
        <section className="ssr-zone mb-4">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Money Out</h2>
            </div>
            <div className="flex items-baseline gap-6">
              <p className="text-xs text-recessive">
                {moType === "fixed"
                  ? "Overheads — entered and edited here in the portal"
                  : moType === "variable"
                  ? <>Variable production — read-only Airtable mirror, outside your VAT return{lastSyncedAt && <> · synced {formatDate(lastSyncedAt)}</>}</>
                  : <>Fixed costs are entered here; variable production is a read-only Airtable mirror, outside your VAT return{lastSyncedAt && <> · synced {formatDate(lastSyncedAt)}</>}</>}
              </p>
              {/* Airtable only backs the variable rows — hide the sync control when viewing fixed only. */}
              {moType !== "fixed" && (
                <button
                  type="button"
                  onClick={handleRefreshPayables}
                  disabled={refreshingPayables}
                  className="whitespace-nowrap text-xs text-gold hover:underline underline-offset-4 disabled:opacity-50"
                >
                  {refreshingPayables ? "Syncing…" : "Refresh from Airtable"}
                </button>
              )}
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-8">
            {/* Search — underline field, matching the members search bar */}
            <div className="group relative flex w-[220px] items-center gap-2.5 pb-[7px]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#C9A96A]/55 transition-colors duration-300 group-focus-within:text-[#C9A96A]" />
              <input
                type="text"
                value={moSearch}
                onChange={(e) => setMoSearch(e.target.value)}
                placeholder="SEARCH NAME"
                className="w-full border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-0"
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
            </div>

            {/* Type filter — underline select */}
            <div className="group relative w-[210px] pb-[7px]">
              <Select value={moType} onValueChange={(v) => setMoType(v as MoneyOutTypeFilter)}>
                <SelectTrigger className="h-auto rounded-none border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 focus:ring-0 focus:ring-offset-0 [&>svg]:text-[#C9A96A]/60 [&>svg]:opacity-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All costs</SelectItem>
                  <SelectItem value="fixed">Operational fixed (Overheads)</SelectItem>
                  <SelectItem value="variable">Variable production (Airtable)</SelectItem>
                </SelectContent>
              </Select>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
            </div>

            {/* Status filter — underline select */}
            <div className="group relative w-[150px] pb-[7px]">
              <Select value={moStatus} onValueChange={(v) => setMoStatus(v as MoneyOutStatusFilter)}>
                <SelectTrigger className="h-auto rounded-none border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 focus:ring-0 focus:ring-offset-0 [&>svg]:text-[#C9A96A]/60 [&>svg]:opacity-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
            </div>
            <div className="ml-auto flex items-center gap-6">
              <RecurringOverheadsDialog categories={categories} onChange={fetchAll} />
              <button
                type="button"
                onClick={openCreateExpense}
                className="text-sm text-gold hover:underline underline-offset-4"
              >
                New expense
              </button>
            </div>
          </div>
          <div className="mb-5">
            <BulkOverheadDropzone categories={categories} onParsed={startReviewQueue} />
          </div>
          <MoneyOutTable rows={filteredMoneyOut} loading={loading} onRowClick={openMoneyOutRow} onAttachInvoice={attachOverheadInvoice} />
        </section>
      )}

      {/* Revenue (money-in) — shown when its summary tile is selected */}
      {activeSection === "moneyIn" && (
        <section className="ssr-zone mb-4">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Revenue</h2>
            </div>
            <p className="text-xs text-recessive">Invoices · cash basis</p>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-8">
            <div className="group relative flex w-[260px] items-center gap-2.5 pb-[7px]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#C9A96A]/55 transition-colors duration-300 group-focus-within:text-[#C9A96A]" />
              <input
                type="text"
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="SEARCH CLIENT OR INVOICE #"
                className="w-full border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-0"
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
            </div>
            <div className="group relative w-[150px] pb-[7px]">
              <Select value={invStatus} onValueChange={(v) => setInvStatus(v as InvoiceStatusFilter)}>
                <SelectTrigger className="h-auto rounded-none border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 focus:ring-0 focus:ring-offset-0 [&>svg]:text-[#C9A96A]/60 [&>svg]:opacity-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
            </div>
            <div className="ml-auto flex items-center gap-6">
              <IncomeInvoiceUpload onSaved={fetchAll} />
            </div>
          </div>
          <div className="mb-5">
            <BulkIncomeDropzone onSaved={fetchAll} />
          </div>
          <MoneyInTable rows={filteredInvoices} loading={loading} onRowClick={openInvoiceViewer} />
        </section>
      )}

      {/* Outstanding — standing balances, independent of the selected period */}
      <section className="ssr-zone mb-4">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-6 bg-gold-muted" />
          <h2 className="text-label">Outstanding</h2>
        </div>
        <OutstandingCards receivable={outstandingIn} payable={outstandingOut} />
      </section>

      {/* Hidden picker for attaching a payslip to a money-out salary row */}
      <input
        ref={salaryAttachInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => { void handleSalaryAttachFile(e.target.files?.[0] ?? undefined); e.target.value = ""; }}
      />

      {/* Dialogs rendered unconditionally at page root */}
      <OverheadForm
        open={formOpen}
        onOpenChange={handleOverheadFormOpenChange}
        mode={formMode}
        initial={editing}
        defaultValues={prefillDefaults}
        categories={categories}
        onSaved={handleOverheadSaved}
        queueLabel={reviewLabel}
      />
      <OverheadDetail
        open={overheadDetailOpen}
        onOpenChange={setOverheadDetailOpen}
        overhead={selectedOverhead}
        categories={categories}
        onEdit={openOverheadEditFromDetail}
      />
      <InvoiceViewer
        invoice={invoiceViewing}
        open={!!invoiceViewing}
        onOpenChange={(o) => !o && setInvoiceViewing(null)}
      />
      <PayableDetail
        open={payableDetailOpen}
        onOpenChange={setPayableDetailOpen}
        payable={selectedPayable}
        baseId={payableBaseId}
      />
    </AdminLayout>
  );
}
