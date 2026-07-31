import { SectionTotal } from "@/components/admin/finance/SectionTotal";
import { useEffect, useMemo, useState } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useGraceTimers, useNowTicker, formatCountdown, GRACE_MS } from "@/hooks/useGraceTimers";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, SortTh } from "@/components/ui/TableToolbar";
import { CurrencyAmount } from "@/components/finance/CurrencyAmount";
import { useFx } from "@/contexts/FxContext";

interface OH {
  id: string; supplier_name: string | null; description: string | null; category_code: string | null;
  gross_amount: number; currency: string | null; due_date: string | null; payment_status: string | null;
  justPaid?: boolean; paidAt?: number;
}
const money = (n: number, c = "GBP") =>
  (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `) +
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
// A debt is overdue or due within a week (null due = treat as due now).
const isDebtDue = (due: string | null) => !due || new Date(due).getTime() <= Date.now() + 7 * 86_400_000;
const detailOf = (r: OH) => r.description || r.category_code || "";

const COLUMNS: SortableColumn<OH>[] = [
  { id: "supplier", accessor: (r) => r.supplier_name ?? "", type: "text" },
  { id: "detail", accessor: (r) => detailOf(r), type: "text" },
  { id: "due", accessor: (r) => r.due_date, type: "date" },
  { id: "amount", accessor: (r) => Number(r.gross_amount ?? 0), type: "number" },
];

/** Debts → Overheads: the unpaid overhead bills already recorded in the P&L. */
export function DebtsOverheads({ onTotal }: { onTotal?: (n: number) => void } = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<OH[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const grace = useGraceTimers();
  const now = useNowTicker(rows.some((r) => r.justPaid));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.supplier_name ?? "").toLowerCase().includes(q) || detailOf(r).toLowerCase().includes(q));
  }, [rows, search]);
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<OH>(filtered, COLUMNS, { key: "due", dir: "asc" });

  async function load() {
    const { data } = await supabase.from("overheads")
      .select("id, supplier_name, description, category_code, gross_amount, currency, due_date, payment_status")
      .order("due_date", { ascending: true });
    setRows(((data ?? []) as OH[]).filter((o) => o.payment_status !== "paid" && Number(o.gross_amount) > 0 && isDebtDue(o.due_date)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const fx = useFx();
  // Unpaid overheads are live-rate; convert foreign to GBP for the header total.
  const total = rows.reduce((s, r) => s + fx.gbp(Number(r.gross_amount || 0), r.currency ?? "GBP", null), 0);
  useEffect(() => { onTotal?.(total); }, [total, onTotal]);

  async function markPaid(r: OH) {
    setSaving(r.id);
    const { error } = await supabase.from("overheads")
      .update({ payment_status: "paid", payment_date: new Date().toISOString().slice(0, 10) }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't mark paid", description: error.message, variant: "destructive" }); return; }
    // Keep it 5 min so a mistake can be reverted, then drop it.
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: true, paidAt: Date.now() } : x));
    grace.schedule(r.id, GRACE_MS, () => setRows((prev) => prev.filter((x) => x.id !== r.id)));
  }

  async function revert(r: OH) {
    setSaving(r.id);
    const { error } = await supabase.from("overheads").update({ payment_status: "unpaid", payment_date: null }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't revert", description: error.message, variant: "destructive" }); return; }
    grace.cancel(r.id);
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, justPaid: false } : x));
  }

  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Overheads</h2></div>
        <SectionTotal amount={total} format={money} />
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No unpaid overheads. Add them in P&amp;L → Money out.</div>
      ) : (
        <>
        <TableToolbar>
          <TableSearch value={search} onChange={setSearch} placeholder="SEARCH SUPPLIER OR DETAIL" width="w-[280px]" />
        </TableToolbar>
        <div className="ssr-tile overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <SortTh id="supplier" label="Supplier" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="detail" label="Detail" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="due" label="Due" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                <SortTh id="amount" label="Amount" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id} className={`border-b border-white/[0.05] last:border-0 ${r.justPaid ? "opacity-45" : ""}`}>
                  <td className="px-4 py-3 text-strong">{r.supplier_name ?? "—"}</td>
                  <td className="px-4 py-3 text-recessive text-[12px]">{r.description || r.category_code || "—"}</td>
                  <td className="px-4 py-3 text-standard">{fmtDate(r.due_date)}</td>
                  <td className="px-4 py-3 text-right text-strong"><CurrencyAmount amount={Number(r.gross_amount)} currency={r.currency ?? "GBP"} rateDate={null} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {saving === r.id
                      ? <BrandLoader size="sm" className="h-3 w-3 inline-block" />
                      : r.justPaid
                        ? <span className="inline-flex items-center gap-3"><span className="text-[11px] tabular-nums text-gold">{formatCountdown((r.paidAt ?? 0) + GRACE_MS - now)}</span><button onClick={() => revert(r)} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75">Revert</button></span>
                        : <button onClick={() => markPaid(r)} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}
