import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";
import { useGraceTimers, GRACE_MS } from "@/hooks/useGraceTimers";
import { DebtsOverheads } from "@/components/admin/finance/DebtsOverheads";
import { DebtsTaxes } from "@/components/admin/finance/DebtsTaxes";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ROLE: Record<string, string> = {
  modeller_invoices: "Modeller", scene_manager_invoice: "Scene Manager", photographer_invoice: "Photographer",
};

interface Row {
  airtable_record_id: string;
  source_table: string;
  payee_name: string | null;
  period_year: number | null;
  period_month: number | null;
  invoice_total: number;
  amount_paid: number;
  balance: number;
  paid_status: string | null;
  justPaid?: boolean;   // fully paid, still in the 5-min revert window
}

function money(n: number) {
  return "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
// Airtable stores names hyphen/underscore-joined ("Maycon-Santos") — show spaces.
const humanName = (s: string | null) => (s ?? "—").replace(/[_-]+/g, " ");

// A freelancer's monthly amount falls due at the end of that month.
function periodEnd(y: number | null, m: number | null): string | null {
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
// A debt is anything overdue or due within a week (null due = treat as due now).
function isDebtDue(due: string | null): boolean {
  if (!due) return true;
  return new Date(due).getTime() <= Date.now() + 7 * 86_400_000;
}

const COLUMNS: SortableColumn<Row>[] = [
  { id: "name",   accessor: (r) => r.payee_name ?? "", type: "text" },
  { id: "role",   accessor: (r) => ROLE[r.source_table] ?? "", type: "text" },
  { id: "period", accessor: (r) => (r.period_year ?? 0) * 100 + (r.period_month ?? 0), type: "number" },
  { id: "total",  accessor: (r) => r.invoice_total, type: "number" },
  { id: "paid",   accessor: (r) => r.amount_paid, type: "number" },
  { id: "due",    accessor: (r) => r.balance, type: "number" },
];

export default function AdminFreelancerPayments() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialAmt, setPartialAmt] = useState("");

  async function load() {
    const { data } = await supabase.from("payables_snapshot")
      .select("airtable_record_id, source_table, payee_name, period_year, period_month, invoice_total, amount_paid, balance_remaining, paid_status")
      .in("source_table", Object.keys(ROLE));
    const mapped: Row[] = (data ?? [])
      .map((r) => {
        const total = Number(r.invoice_total) || 0;
        const bal = r.balance_remaining != null ? Number(r.balance_remaining) : (r.paid_status === "paid" ? 0 : total);
        return {
          airtable_record_id: r.airtable_record_id as string,
          source_table: r.source_table as string,
          payee_name: r.payee_name as string | null,
          period_year: r.period_year as number | null,
          period_month: r.period_month as number | null,
          invoice_total: total,
          amount_paid: Math.max(0, total - bal),
          balance: bal,
          paid_status: r.paid_status as string | null,
        };
      })
      // Debts only: still owed AND overdue or due within a week.
      .filter((r) => r.balance > 0.005 && isDebtDue(periodEnd(r.period_year, r.period_month)));
    setRows(mapped);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const outstandingTotal = useMemo(() => rows.reduce((s, r) => s + r.balance, 0), [rows]);

  // Default: largest outstanding first. Any column is click-sortable (asc↔desc).
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Row>(rows, COLUMNS, { key: "due", dir: "desc" });
  const grace = useGraceTimers();

  async function pay(row: Row, action: "paid" | "partial" | "unpaid", amount?: number) {
    setSaving(row.airtable_record_id);
    try {
      const { data, error } = await supabase.functions.invoke("pay-freelancer", {
        body: { source_table: row.source_table, airtable_record_id: row.airtable_record_id, action, amount },
      });
      if (error || (data as { success?: boolean })?.success === false) throw new Error(error?.message ?? "Failed");
      const d = data as { amount_paid: number; balance: number; paid_status: string };
      const fullyPaid = d.balance <= 0.005;
      const id = row.airtable_record_id;
      setRows((prev) => prev.map((r) => r.airtable_record_id === id
        ? { ...r, amount_paid: d.amount_paid, balance: d.balance, paid_status: d.paid_status, justPaid: fullyPaid } : r));
      // Fully paid: keep it 5 min so a mistake can be reverted, then drop it.
      if (fullyPaid) grace.schedule(id, GRACE_MS, () => setRows((prev) => prev.filter((r) => r.airtable_record_id !== id)));
      else grace.cancel(id);
      setPartialFor(null); setPartialAmt("");
      toast({ title: "Payment recorded in Airtable" });
    } catch (e) {
      toast({ title: "Couldn't record payment", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <AdminLayout panel>
      <div className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Debts</span>
        </div>
        <p className="mt-3 text-sm text-recessive">What the studio owes, by category.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : (
       <>
        <section className="ssr-zone">
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
            <div className="flex items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Freelancers</h2>
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{money(outstandingTotal)} outstanding</span>
          </div>

          {sortedRows.length === 0 ? (
            <div className="ssr-tile p-10 text-center text-recessive text-sm">No freelancer invoices found.</div>
          ) : (
            <div className="ssr-tile overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <SortableTh id="name"   label="Freelancer" activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4" />
                    <SortableTh id="role"   label="Role"       activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4" />
                    <SortableTh id="period" label="Period"     activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4" />
                    <SortableTh id="total"  label="Total"      activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4 text-right" />
                    <SortableTh id="paid"   label="Paid"       activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4 text-right" />
                    <SortableTh id="due"    label="Due"        activeKey={sortKey} dir={sortDir} onClick={toggle} className="px-4 text-right" />
                    <th className="px-4" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const key = r.airtable_record_id;
                    const busy = saving === key;
                    const period = r.period_year && r.period_month ? `${MONTHS[r.period_month - 1]} ${r.period_year}` : "—";
                    return (
                      <tr key={key} className={`border-b border-white/[0.05] last:border-0 ${r.justPaid ? "opacity-45" : ""}`}>
                        <td className="px-4 py-3 text-strong">{humanName(r.payee_name)}</td>
                        <td className="px-4 py-3 text-recessive text-[12px]">{ROLE[r.source_table]}</td>
                        <td className="px-4 py-3 text-standard">{period}</td>
                        <td className="px-4 py-3 text-right text-standard tabular-nums">{money(r.invoice_total)}</td>
                        <td className="px-4 py-3 text-right text-standard tabular-nums">{money(r.amount_paid)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-strong">{money(r.balance)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {partialFor === key ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-white/40 text-[12px]">£</span>
                              <input
                                autoFocus type="text" inputMode="decimal" value={partialAmt}
                                onChange={(e) => setPartialAmt(e.target.value)}
                                placeholder={r.balance.toFixed(2)}
                                className="w-20 bg-transparent border-b border-white/20 text-right text-standard text-[12px] focus:outline-none focus:border-[#C9A96A]"
                              />
                              <button disabled={busy} onClick={() => pay(r, "partial", parseFloat(partialAmt.replace(/[^0-9.]/g, "")))}
                                className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c] disabled:opacity-40">Save</button>
                              <button onClick={() => { setPartialFor(null); setPartialAmt(""); }}
                                className="text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white/60">Cancel</button>
                            </span>
                          ) : busy ? (
                            <BrandLoader size="sm" className="h-3 w-3 inline-block" />
                          ) : r.justPaid ? (
                            <span className="inline-flex items-center gap-3">
                              <span className="text-[9px] uppercase tracking-[0.2em] text-gold">Paid</span>
                              <button onClick={() => pay(r, "unpaid")} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75">Revert</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-3">
                              {r.paid_status === "partial" && <span className="text-[9px] uppercase tracking-[0.2em] text-[#c98a6a]">Partial</span>}
                              <button onClick={() => pay(r, "paid")} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>
                              <button onClick={() => { setPartialFor(key); setPartialAmt(""); }} className="text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75">Partial</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <EmptySection title="Salaries" note="Payroll model to be scoped — employees, PAYE/NI, hours and bonuses." />
        <DebtsOverheads />
        <DebtsTaxes />
       </>
      )}
    </AdminLayout>
  );
}

function EmptySection({ title, note }: { title: string; note?: string }) {
  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center gap-3 border-b border-white/[0.07] pb-3">
        <div className="h-px w-6 bg-gold-muted" />
        <h2 className="text-label">{title}</h2>
      </div>
      <div className="ssr-tile p-10 text-center text-recessive text-sm">{note ?? "Not set up yet."}</div>
    </section>
  );
}
