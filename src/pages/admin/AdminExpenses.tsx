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
import { OverheadTable } from "@/components/admin/overheads/OverheadTable";
import { OverheadDetail } from "@/components/admin/overheads/OverheadDetail";
import { OverheadUploadFlow } from "@/components/admin/overheads/OverheadUploadFlow";
import {
  dateInQuarter,
  formatCurrency,
  getCurrentQuarter,
  getPreviousQuarter,
  type ExpenseCategory,
  type Overhead,
  type PaymentStatus,
} from "@/lib/finance";

type QuarterFilter = "current" | "previous" | "all";
type StatusFilter = "all" | PaymentStatus;

export default function AdminExpenses() {
  const [rows, setRows] = useState<Overhead[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [quarterFilter, setQuarterFilter] = useState<QuarterFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Overhead | null>(null);
  const [prefillDefaults, setPrefillDefaults] = useState<Partial<Overhead> | null>(null);
  // Ref (not state) so back-to-back onSaved + onOpenChange(false) callbacks
  // in the same event both read the freshest value without closure staleness.
  // Non-null == an upload was staged to `overhead-invoices/staging/...` and
  // still needs cleanup if the review gate closes without a save.
  const pendingStagingPathRef = useRef<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Overhead | null>(null);

  const { toast } = useToast();

  const currentQuarter = useMemo(() => getCurrentQuarter(), []);
  const previousQuarter = useMemo(() => getPreviousQuarter(currentQuarter), [currentQuarter]);

  async function fetchAll() {
    setLoading(true);
    const [{ data: overheads, error: oErr }, { data: cats, error: cErr }] = await Promise.all([
      supabase.from("overheads" as any).select("*").order("invoice_date", { ascending: false }),
      supabase
        .from("expense_categories" as any)
        .select("*")
        .order("code", { ascending: true }),
    ]);
    if (oErr) toast({ title: "Failed to load expenses", description: oErr.message, variant: "destructive" });
    if (cErr) toast({ title: "Failed to load categories", description: cErr.message, variant: "destructive" });
    setRows(((overheads as unknown) as Overhead[]) ?? []);
    setCategories(((cats as unknown) as ExpenseCategory[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.payment_status !== statusFilter) return false;
      if (quarterFilter === "current" && !dateInQuarter(r.invoice_date, currentQuarter)) return false;
      if (quarterFilter === "previous" && !dateInQuarter(r.invoice_date, previousQuarter)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.supplier_name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, quarterFilter, search, currentQuarter, previousQuarter]);

  const totals = useMemo(() => {
    const outstanding = rows
      .filter((r) => r.payment_status === "unpaid")
      .reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
    const paidThisQuarter = rows
      .filter((r) => r.payment_status === "paid" && dateInQuarter(r.payment_date, currentQuarter))
      .reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
    const totalThisQuarter = rows
      .filter((r) => dateInQuarter(r.invoice_date, currentQuarter))
      .reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
    return { outstanding, paidThisQuarter, totalThisQuarter };
  }, [rows, currentQuarter]);

  function openCreate() {
    setEditing(null);
    setPrefillDefaults(null);
    pendingStagingPathRef.current = null;
    setFormMode("create");
    setFormOpen(true);
  }

  function openCreateFromUpload(defaults: Partial<Overhead>) {
    setEditing(null);
    setPrefillDefaults(defaults);
    pendingStagingPathRef.current = defaults.staging_storage_path ?? null;
    setFormMode("create");
    setFormOpen(true);
  }

  function openEditFromDetail() {
    if (!selected) return;
    setEditing(selected);
    setPrefillDefaults(null);
    pendingStagingPathRef.current = null;
    setFormMode("edit");
    setDetailOpen(false);
    setFormOpen(true);
  }

  async function handleFormOpenChange(nextOpen: boolean) {
    setFormOpen(nextOpen);
    // If the dialog is closing and a staging path is still pending, the row
    // was NOT saved (successful save clears the ref via handleSaved before
    // the dialog closes). Clean the orphaned file from Storage.
    if (!nextOpen) {
      const orphan = pendingStagingPathRef.current;
      pendingStagingPathRef.current = null;
      if (orphan) {
        const { error } = await supabase.storage
          .from("overhead-invoices")
          .remove([orphan]);
        if (error) {
          console.warn("[AdminExpenses] failed to clean up staged file", error);
        }
      }
    }
  }

  function handleSaved() {
    // Save succeeded — the overheads row now owns the staging path.
    // Clear the cleanup ref BEFORE the dialog's onOpenChange(false) fires,
    // so handleFormOpenChange sees null and does not delete the file.
    pendingStagingPathRef.current = null;
    fetchAll();
  }

  function openDetail(o: Overhead) {
    setSelected(o);
    setDetailOpen(true);
  }

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-3">Finance</p>
        <h1 className="font-serif font-normal tracking-tight text-strong text-4xl leading-none">
          Expenses
        </h1>
        <p className="mt-3 text-sm text-recessive">
          Overhead ledger and VAT-relevant records. {currentQuarter.label}.
        </p>
      </div>

      {/* Summary band — figures lead the surface */}
      <div className="mb-10 grid grid-cols-3 gap-8 border-y border-divider py-6">
        <SummaryTile label="Outstanding" value={formatCurrency(totals.outstanding)} />
        <SummaryTile label={`Paid ${currentQuarter.label}`} value={formatCurrency(totals.paidThisQuarter)} />
        <SummaryTile label={`Total ${currentQuarter.label}`} value={formatCurrency(totals.totalThisQuarter)} />
      </div>

      {/* Filters + CTA */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-sm max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="rounded-sm w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        <Select value={quarterFilter} onValueChange={(v) => setQuarterFilter(v as QuarterFilter)}>
          <SelectTrigger className="rounded-sm w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All quarters</SelectItem>
            <SelectItem value="current">{currentQuarter.label}</SelectItem>
            <SelectItem value="previous">{previousQuarter.label}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-6">
          <OverheadUploadFlow onExtracted={openCreateFromUpload} />
          <button
            type="button"
            onClick={openCreate}
            className="text-sm text-gold hover:underline underline-offset-4"
          >
            New expense
          </button>
        </div>
      </div>

      {/* Table */}
      <OverheadTable
        rows={filtered}
        categories={categories}
        loading={loading}
        onRowClick={openDetail}
      />

      {/* Dialogs rendered unconditionally at page root (CLAUDE.md pattern) */}
      <OverheadForm
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        mode={formMode}
        initial={editing}
        defaultValues={prefillDefaults}
        categories={categories}
        onSaved={handleSaved}
      />
      <OverheadDetail
        open={detailOpen}
        onOpenChange={setDetailOpen}
        overhead={selected}
        categories={categories}
        onEdit={openEditFromDetail}
      />
    </AdminLayout>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{label}</p>
      <p className="mt-2 font-serif text-3xl text-strong tabular-nums">{value}</p>
    </div>
  );
}
