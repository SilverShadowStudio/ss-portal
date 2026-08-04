import { useEffect, useState, type ReactNode } from "react";
import { Download, Eye, X } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTableSort, type SortColumnType } from "@/hooks/useTableSort";

interface Slip {
  id: string;
  period_label: string | null;
  period_end: string | null;
  gross: number | null;
  net: number | null;
  back_pay: number | null;
  income_tax: number | null;
  employee_ni: number | null;
  student_loan: number | null;
  taxable_gross_pay: number | null;
  employer_ni: number | null;
  document_path: string | null;
  dropbox_path: string | null;
  salary_paid_at: string | null;
}
interface Payment { id: string; payslip_id: string; amount: number; paid_at: string; }

// Breakdown columns render in this light blue — same hue as the "Breakdown" toggle.
const BLUE = "#9dbfe4";

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
// Always "January 2026" — full month + year, from the period end date.
const monthLabel = (s: Slip) => (s.period_end
  ? new Date(s.period_end).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  : (s.period_label ?? "—"));

/**
 * Employee-facing salary statement. Summary shows the headline columns; the
 * Breakdown toggle reveals the payslip deductions (tax, NI, student loan,
 * employer NI…) between Gross and Net. Every column is sortable — Month sorts by
 * date value, not alphabetically. RLS limits every query to the signed-in person.
 */
export default function Salary() {
  const { toast } = useToast();
  const [slips, setSlips] = useState<Slip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [mode, setMode] = useState<"summary" | "breakdown">("summary");

  useEffect(() => {
    (async () => {
      const { data: ps } = await supabase
        .from("payslips")
        .select("id, period_label, period_end, gross, net, back_pay, income_tax, employee_ni, student_loan, taxable_gross_pay, employer_ni, document_path, dropbox_path, salary_paid_at")
        .order("period_end", { ascending: true });
      const list = (ps ?? []) as Slip[];
      setSlips(list);
      if (list.length) {
        const { data: pays } = await supabase
          .from("salary_payments")
          .select("id, payslip_id, amount, paid_at")
          .in("payslip_id", list.map((s) => s.id));
        setPayments((pays ?? []) as Payment[]);
      }
      setLoading(false);
    })();
  }, []);

  const paidFor = (id: string) => payments.filter((p) => p.payslip_id === id).reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentsFor = (id: string) => payments.filter((p) => p.payslip_id === id).sort((a, b) => a.paid_at.localeCompare(b.paid_at));

  function status(s: Slip): { label: string; tone: "rest" | "action" | "part" } {
    const net = Number(s.net || 0);
    const paid = paidFor(s.id);
    if (s.salary_paid_at || (net > 0 && paid >= net - 0.01)) return { label: "Paid", tone: "rest" };
    if (paid > 0) return { label: `${money(paid)} of ${money(net)}`, tone: "part" };
    return { label: "Awaiting payment", tone: "action" };
  }

  async function openPayslip(s: Slip, download: boolean) {
    if (!s.document_path) { toast({ title: "Payslip not filed yet", description: "It'll appear here once uploaded." }); return; }
    setBusyId(s.id);
    try {
      const name = `Payslip_${(s.period_end ?? "").slice(0, 7) || "month"}.pdf`;
      const { data, error } = await supabase.storage.from("payslips")
        .createSignedUrl(s.document_path, 300, download ? { download: name } : undefined);
      if (error || !data?.signedUrl) throw error || new Error("No URL");
      if (download) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      else setPreview({ name, url: data.signedUrl });
    } catch {
      toast({ title: "Couldn't open the payslip", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  // ── Column model. `breakdown` columns sit between Gross and Net and only show
  //    in breakdown mode; every column with a `type` is sortable.
  interface Col {
    id: string;
    label: string;
    align: "left" | "right" | "center";
    type?: SortColumnType;                 // omit → not sortable
    accessor?: (s: Slip) => string | number | null | undefined;
    render: (s: Slip) => ReactNode;
    breakdown?: boolean;
  }
  const num = (v: number | null) => money(Number(v || 0));
  const columns: Col[] = [
    { id: "month", label: "Month", align: "left", type: "date", accessor: (s) => s.period_end, render: (s) => <span className="text-strong">{monthLabel(s)}</span> },
    { id: "gross", label: "Gross", align: "right", type: "number", accessor: (s) => Number(s.gross || 0), render: (s) => <span className="tabular-nums text-standard">{num(s.gross)}</span> },
    { id: "back_pay", label: "Back Pay", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.back_pay || 0), render: (s) => <span className="tabular-nums">{num(s.back_pay)}</span> },
    { id: "income_tax", label: "Tax", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.income_tax || 0), render: (s) => <span className="tabular-nums">{num(s.income_tax)}</span> },
    { id: "employee_ni", label: "National Insurance", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.employee_ni || 0), render: (s) => <span className="tabular-nums">{num(s.employee_ni)}</span> },
    { id: "student_loan", label: "Student Loan", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.student_loan || 0), render: (s) => <span className="tabular-nums">{num(s.student_loan)}</span> },
    { id: "taxable_gross_pay", label: "Taxable Gross Pay", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.taxable_gross_pay ?? s.gross ?? 0), render: (s) => <span className="tabular-nums">{num(s.taxable_gross_pay ?? s.gross)}</span> },
    { id: "employer_ni", label: "Employer NI", align: "right", type: "number", breakdown: true, accessor: (s) => Number(s.employer_ni || 0), render: (s) => <span className="tabular-nums">{num(s.employer_ni)}</span> },
    { id: "net", label: "Net", align: "right", type: "number", accessor: (s) => Number(s.net || 0), render: (s) => <span className="tabular-nums text-strong">{num(s.net)}</span> },
    { id: "due", label: "Due", align: "left", type: "date", accessor: (s) => s.period_end, render: (s) => <span className="text-standard">{fmtDate(s.period_end)}</span> },
    {
      id: "payments", label: "Payments", align: "left", type: "number", accessor: (s) => paidFor(s.id),
      render: (s) => {
        const pays = paymentsFor(s.id);
        return <span className="text-recessive text-[12px]">{pays.length === 0 ? (s.salary_paid_at ? fmtDate(s.salary_paid_at.slice(0, 10)) : "—") : pays.map((p) => `${fmtDate(p.paid_at)} · ${money(Number(p.amount))}`).join("  ·  ")}</span>;
      },
    },
    {
      id: "status", label: "Status", align: "left", type: "number", accessor: (s) => Number(s.net || 0) - paidFor(s.id),
      render: (s) => {
        const st = status(s);
        return <span className={st.tone === "rest" ? "text-[11px] uppercase tracking-[0.16em] text-white/45" : st.tone === "part" ? "text-[11px] tabular-nums text-[#ecd39c]" : "text-[11px] uppercase tracking-[0.16em] text-[#C9A96A]"}>{st.label}</span>;
      },
    },
    {
      id: "payslip", label: "Payslip", align: "center",
      render: (s) => busyId === s.id ? <BrandLoader size="sm" className="h-3.5 w-3.5 inline-block" /> : s.document_path ? (
        <span className="inline-flex items-center gap-4" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
          <button onClick={() => openPayslip(s, false)} className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors"><Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">View</span></button>
          <button onClick={() => openPayslip(s, true)} className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors"><Download style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">PDF</span></button>
        </span>
      ) : <span className="text-white/20">—</span>,
    },
  ];
  const visibleColumns = columns.filter((c) => mode === "breakdown" || !c.breakdown);
  const sortCols = visibleColumns.filter((c) => c.type && c.accessor).map((c) => ({ id: c.id, accessor: c.accessor!, type: c.type! }));

  // A month's salary falls due on the 1st of the FOLLOWING month at 00:00 (same
  // as freelancer payments, which fall due at the end of their month). So the
  // in-progress current month never shows — it appears only once that month has
  // finished. Year-month is read straight off the period_end string (m is
  // 1-based), so new Date(y, m, 1) is the 1st of the next month, in local time.
  const dueFromTs = (s: Slip) => {
    if (!s.period_end) return -Infinity;
    const [y, m] = s.period_end.split("-").map(Number);
    return new Date(y, m, 1).getTime();
  };
  const dueSlips = slips.filter((s) => dueFromTs(s) <= Date.now());
  // Still owed across every month that has fallen due.
  const outstandingTotal = dueSlips.reduce(
    (sum, s) => sum + Math.max(0, Number(s.net || 0) - paidFor(s.id)),
    0,
  );
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort(dueSlips, sortCols, { key: "month", dir: "asc" });

  const alignCls = (a: Col["align"]) => a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <ClientLayout panel>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Salary</span>
        </div>
        <p className="mt-3 text-sm text-recessive">Your monthly salary, payments and payslips</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : dueSlips.length === 0 ? (
        <div className="ssr-zone animate-fade-in">
          <div className="ssr-tile p-10 text-center text-recessive text-sm">Your salary statement will appear here once payroll is set up.</div>
        </div>
      ) : (
        <div className="ssr-zone animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
            <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Monthly statement</h2></div>
            {/* Minimal Summary / Breakdown toggle — Breakdown shares the columns' blue. */}
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]">
              <button onClick={() => setMode("summary")} className={mode === "summary" ? "text-gold" : "text-white/35 hover:text-white/70 transition-colors"}>Summary</button>
              <span className="text-white/20">/</span>
              <button onClick={() => setMode("breakdown")} className={mode === "breakdown" ? "" : "text-white/35 hover:text-white/70 transition-colors"} style={mode === "breakdown" ? { color: BLUE } : undefined}>Breakdown</button>
            </div>
          </div>
          <div className="ssr-tile overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {visibleColumns.map((c) => {
                    const sortable = !!(c.type && c.accessor);
                    const active = sortKey === c.id;
                    return (
                      <th
                        key={c.id}
                        onClick={sortable ? () => toggle(c.id) : undefined}
                        className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] font-normal ${alignCls(c.align)} ${sortable ? "cursor-pointer select-none hover:text-white/70" : ""} ${c.breakdown ? "" : "text-white/40"}`}
                        style={c.breakdown ? { color: BLUE } : undefined}
                      >
                        {c.label}{active && <span aria-hidden className="ml-1">{sortDir === "asc" ? "▴" : "▾"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((s) => (
                  <tr key={s.id} className="border-b border-white/[0.05] last:border-0">
                    {visibleColumns.map((c) => (
                      <td key={c.id} className={`px-4 py-3 ${alignCls(c.align)} ${c.align === "right" ? "tabular-nums" : ""}`} style={c.breakdown ? { color: BLUE } : undefined}>
                        {c.render(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* What's still owed matters more than a definition of "net". */}
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 px-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Net is your take-home pay</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">
              Outstanding{" "}
              <span className={`tabular-nums ${outstandingTotal > 0.005 ? "text-[#ecd39c]" : "text-white/45"}`}>{money(outstandingTotal)}</span>
            </p>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-sm animate-fade-in" onClick={() => setPreview(null)}>
          <div className="flex items-center justify-between gap-4 px-6 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <span className="truncate font-sans uppercase text-[#ecd39c]" style={{ fontSize: 11, letterSpacing: "0.16em" }}>{preview.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="font-sans uppercase text-white/50 hover:text-gold transition-colors" style={{ fontSize: 10, letterSpacing: "0.16em" }}>Open in tab</a>
              <button onClick={() => setPreview(null)} className="text-white/50 hover:text-white transition-colors"><X className="h-5 w-5" strokeWidth={1.5} /></button>
            </div>
          </div>
          <div className="flex-1 px-4 pb-4 sm:px-10 sm:pb-10" onClick={(e) => e.stopPropagation()}>
            <iframe src={preview.url} title={preview.name} className="h-full w-full rounded-sm border border-white/10 bg-white shadow-2xl" />
          </div>
        </div>
      )}
    </ClientLayout>
  );
}
