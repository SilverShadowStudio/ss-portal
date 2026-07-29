import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { estimatePayroll, TAX_YEAR } from "@/lib/payrollEstimate";

interface EmployeeRow {
  id: string;
  name: string;
  position: string | null;
  gross_salary_annual: number;
  salary_start_date: string | null;
}

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const money2 = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/**
 * Debts → Salaries: fixed-salary employees and the monthly payroll provision.
 * Figures are a FORECAST (gross → net + true employer cost) for budgeting; the
 * exact numbers land each month from the payslip (Phase 4). See payrollEstimate.
 */
export function DebtsSalaries() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, company_name, position, gross_salary_annual, salary_start_date")
        .eq("employment_type", "employee");
      const mapped: EmployeeRow[] = ((data ?? []) as any[])
        .filter((a) => Number(a.gross_salary_annual) > 0)
        .map((a) => ({
          id: a.id,
          name: (a.company_name ?? "—").replace(/[_-]+/g, " "),
          position: a.position,
          gross_salary_annual: Number(a.gross_salary_annual),
          salary_start_date: a.salary_start_date,
        }));
      setRows(mapped);
      setLoading(false);
    })();
  }, []);

  const totalCostAnnual = rows.reduce((s, r) => s + estimatePayroll(r.gross_salary_annual).employerCost, 0);

  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Salaries</h2></div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{money(totalCostAnnual)}/yr provision</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No employees yet. Add one via Team → Add member → existing agreement, set Engagement to “Employee”.</div>
      ) : (
        <>
          <div className="ssr-tile overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {["Employee", "Position", "Gross / yr", "Net / mo", "Cost / mo", "Provision / yr"].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = estimatePayroll(r.gross_salary_annual);
                  return (
                    <tr key={r.id} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-4 py-3 text-strong">{r.name}</td>
                      <td className="px-4 py-3 text-recessive text-[12px]">{r.position ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money(e.gross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money2(e.net / 12)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money2(e.employerCost / 12)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-strong">{money(e.employerCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
            Estimate · {TAX_YEAR} rates · net &amp; cost confirmed by payslip. Cost = gross + employer NI + employer pension.
          </p>
        </>
      )}
    </section>
  );
}
