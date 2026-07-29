import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { estimatePayroll, estimateMonthlyEmployerOnCosts, TAX_YEAR } from "@/lib/payrollEstimate";

interface EmployeeRow {
  id: string;
  name: string;
  position: string | null;
  gross_salary_annual: number;
}
interface Payslip {
  id: string; account_id: string; period_label: string | null; period_end: string | null;
  gross: number | null; net: number | null; employer_cost: number | null; document_path: string | null;
}

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const money2 = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };

/**
 * Debts → Salaries. The forecast (gross → net + employer cost) gives the annual
 * provision; uploaded payslips give the actual employer cost paid to date, so
 * the two can be compared. See payrollEstimate.
 */
export function DebtsSalaries() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [slips, setSlips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-payslip dialog
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<EmployeeRow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ period_label: "", period_end: "", gross: "", net: "", employer_ni: "", employer_pension: "" });

  async function load() {
    const [{ data: accts }, { data: ps }] = await Promise.all([
      supabase.from("accounts").select("id, company_name, position, gross_salary_annual").eq("employment_type", "employee"),
      supabase.from("payslips").select("id, account_id, period_label, period_end, gross, net, employer_cost, document_path").order("period_end", { ascending: false }),
    ]);
    setRows(((accts ?? []) as any[])
      .filter((a) => Number(a.gross_salary_annual) > 0)
      .map((a) => ({ id: a.id, name: (a.company_name ?? "—").replace(/[_-]+/g, " "), position: a.position, gross_salary_annual: Number(a.gross_salary_annual) })));
    setSlips((ps ?? []) as Payslip[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const actualFor = (accountId: string) => slips.filter((s) => s.account_id === accountId).reduce((sum, s) => sum + Number(s.employer_cost || 0), 0);
  const countFor = (accountId: string) => slips.filter((s) => s.account_id === accountId).length;
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
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{money(totalProvision)}/yr provision</span>
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
                  {["Employee", "Position", "Gross / yr", "Est cost / mo", "Actual paid", "Payslips", ""].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal ${i >= 2 && i <= 4 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = estimatePayroll(r.gross_salary_annual);
                  const actual = actualFor(r.id);
                  const n = countFor(r.id);
                  return (
                    <tr key={r.id} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-4 py-3 text-strong">{r.name}</td>
                      <td className="px-4 py-3 text-recessive text-[12px]">{r.position ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money(e.gross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money2(e.employerCost / 12)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-strong">{n ? money(actual) : <span className="text-white/25">—</span>}</td>
                      <td className="px-4 py-3 text-recessive text-[12px]">{n || 0}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openFor(r)} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                          <Plus className="h-3 w-3" strokeWidth={1.5} />Payslip
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
            Est cost = gross + employer NI + employer pension ({TAX_YEAR} estimate). Actual paid = sum of recorded payslips. Add a payslip to true it up.
          </p>
        </>
      )}

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
    </section>
  );
}
