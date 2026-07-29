import { useEffect, useMemo, useRef, useState } from "react";
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
import { OverheadUploadFlow } from "@/components/admin/overheads/OverheadUploadFlow";
import { RecurringOverheadsDialog } from "@/components/admin/overheads/RecurringOverheadsDialog";
import { IncomeInvoiceUpload } from "@/components/admin/finance/IncomeInvoiceUpload";
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
  type ExpenseCategory,
  type MoneyInInvoice,
  type MoneyOutRow,
  type Overhead,
  type Payable,
  type PayablePaidStatus,
} from "@/lib/finance";
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
  const [loading, setLoading] = useState(true);

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

  const currentQuarter = useMemo(() => getCurrentQuarter(), []);
  const previousQuarter = useMemo(() => getPreviousQuarter(currentQuarter), [currentQuarter]);

  // Presets: current quarter, then each earlier quarter of this year
  // (descending), then the whole year, then everything before this year.
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
    opts.push({
      key: `year:${y}`,
      label: String(y),
      start: new Date(y, 0, 1, 0, 0, 0, 0),
      end: new Date(y, 11, 31, 23, 59, 59, 999),
    });
    opts.push({
      key: "prev_years",
      label: `Before ${y}`,
      start: new Date(0),
      end: new Date(y - 1, 11, 31, 23, 59, 59, 999),
    });
    return opts;
  }, [currentQuarter]);

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
    ] = await Promise.all([
      supabase.from("overheads" as any).select("*").order("invoice_date", { ascending: false }),
      supabase.from("expense_categories" as any).select("*").order("code"),
      supabase.from("invoices").select("*").order("created_at", { ascending: false }),
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
      }),
    [overheads, payables, catByCode],
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
  const outstandingIn = useMemo(
    () =>
      invoices
        .filter((i) => i.status === "sent" || i.status === "overdue" || i.status === "pending")
        .reduce((s, i) => s + Number(i.amount ?? 0), 0),
    [invoices],
  );
  const outstandingOut = useMemo(
    () =>
      overheads
        .filter((r) => r.payment_status === "unpaid")
        .reduce((s, r) => s + Number(r.gross_amount ?? 0), 0) +
      payables.reduce((s, p) => s + outstandingFor(p), 0),
    [overheads, payables],
  );

  const revenue = useMemo(
    () =>
      invoices
        .filter((i) => inPeriod(i.issued_at ?? i.created_at))
        .reduce((s, i) => s + Number(i.amount ?? 0), 0),
    [invoices, inPeriod],
  );
  const fixedCost = useMemo(
    () =>
      overheads
        .filter((o) => inPeriod(o.invoice_date))
        .reduce((s, o) => s + Number(o.gross_amount ?? 0), 0),
    [overheads, inPeriod],
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
      .reduce((s, i) => s + Number(i.vat_amount ?? 0), 0);
    const input = overheads
      .filter((o) => o.payment_status === "paid" && inPeriod(o.payment_date) && !o.is_reverse_charge)
      .reduce((s, o) => s + Number(o.vat_amount ?? 0), 0);
    return output - input;
  }, [invoices, overheads, inPeriod]);

  const netProfit = operatingProfit - periodVat;

  // ---- Row-click / open handlers -----------------------------------------
  function openMoneyOutRow(r: MoneyOutRow) {
    if (r.overhead) {
      setSelectedOverhead(r.overhead);
      setOverheadDetailOpen(true);
    } else if (r.payable) {
      setSelectedPayable(r.payable);
      setPayableDetailOpen(true);
    }
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

  function openCreateExpense() {
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

  async function handleOverheadFormOpenChange(nextOpen: boolean) {
    setFormOpen(nextOpen);
    // Closing without a save leaves an orphaned staged upload — clean it.
    if (!nextOpen) {
      const orphan = pendingStagingPathRef.current;
      pendingStagingPathRef.current = null;
      if (orphan) {
        const { error } = await supabase.storage.from("overhead-invoices").remove([orphan]);
        if (error) console.warn("[AdminPnL] failed to clean up staged file", error);
      }
    }
  }

  function handleOverheadSaved() {
    // Save owns the staging path now — clear the ref before onOpenChange fires.
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
          <Select value={period.key} onValueChange={setPeriodKey}>
            <SelectTrigger className="h-8 w-[170px] rounded-sm text-xs">
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
                Fixed &amp; variable · variable is a read-only Airtable mirror, outside your VAT return
                {lastSyncedAt && <> · synced {formatDate(lastSyncedAt)}</>}
              </p>
              <button
                type="button"
                onClick={handleRefreshPayables}
                disabled={refreshingPayables}
                className="whitespace-nowrap text-xs text-gold hover:underline underline-offset-4 disabled:opacity-50"
              >
                {refreshingPayables ? "Syncing…" : "Refresh from Airtable"}
              </button>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search name…"
              value={moSearch}
              onChange={(e) => setMoSearch(e.target.value)}
              className="rounded-sm max-w-xs"
            />
            <Select value={moType} onValueChange={(v) => setMoType(v as MoneyOutTypeFilter)}>
              <SelectTrigger className="rounded-sm w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All costs</SelectItem>
                <SelectItem value="fixed">Operational fixed (Overheads)</SelectItem>
                <SelectItem value="variable">Variable production (Airtable)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moStatus} onValueChange={(v) => setMoStatus(v as MoneyOutStatusFilter)}>
              <SelectTrigger className="rounded-sm w-[140px]">
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
            <div className="ml-auto flex items-center gap-6">
              <OverheadUploadFlow onExtracted={openCreateExpenseFromUpload} categories={categories} />
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
          <MoneyOutTable rows={filteredMoneyOut} loading={loading} onRowClick={openMoneyOutRow} />
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
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search client or invoice #…"
              value={invSearch}
              onChange={(e) => setInvSearch(e.target.value)}
              className="rounded-sm max-w-xs"
            />
            <Select value={invStatus} onValueChange={(v) => setInvStatus(v as InvoiceStatusFilter)}>
              <SelectTrigger className="rounded-sm w-[140px]">
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
            <div className="ml-auto flex items-center gap-6">
              <IncomeInvoiceUpload onSaved={fetchAll} />
            </div>
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

      {/* Dialogs rendered unconditionally at page root */}
      <OverheadForm
        open={formOpen}
        onOpenChange={handleOverheadFormOpenChange}
        mode={formMode}
        initial={editing}
        defaultValues={prefillDefaults}
        categories={categories}
        onSaved={handleOverheadSaved}
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
