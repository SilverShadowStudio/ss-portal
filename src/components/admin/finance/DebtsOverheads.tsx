import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OH {
  id: string; supplier_name: string | null; description: string | null; category_code: string | null;
  gross_amount: number; currency: string | null; due_date: string | null; payment_status: string | null;
}
const money = (n: number, c = "GBP") =>
  (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : `${c} `) +
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Debts → Overheads: the unpaid overhead bills already recorded in the P&L. */
export function DebtsOverheads() {
  const { toast } = useToast();
  const [rows, setRows] = useState<OH[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("overheads")
      .select("id, supplier_name, description, category_code, gross_amount, currency, due_date, payment_status")
      .order("due_date", { ascending: true });
    setRows(((data ?? []) as OH[]).filter((o) => o.payment_status !== "paid" && Number(o.gross_amount) > 0));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const total = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);

  async function markPaid(r: OH) {
    setSaving(r.id);
    const { error } = await supabase.from("overheads")
      .update({ payment_status: "paid", payment_date: new Date().toISOString().slice(0, 10) }).eq("id", r.id);
    setSaving(null);
    if (error) { toast({ title: "Couldn't mark paid", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    toast({ title: "Overhead marked paid" });
  }

  return (
    <section className="ssr-zone">
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Overheads</h2></div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">{money(total)} outstanding</span>
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
      ) : rows.length === 0 ? (
        <div className="ssr-tile p-10 text-center text-recessive text-sm">No unpaid overheads. Add them in P&amp;L → Money out.</div>
      ) : (
        <div className="ssr-tile overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                {["Supplier", "Detail", "Due", "Amount", ""].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal ${i === 3 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.05] last:border-0">
                  <td className="px-4 py-3 text-strong">{r.supplier_name ?? "—"}</td>
                  <td className="px-4 py-3 text-recessive text-[12px]">{r.description || r.category_code || "—"}</td>
                  <td className="px-4 py-3 text-standard">{fmtDate(r.due_date)}</td>
                  <td className="px-4 py-3 text-right text-strong tabular-nums">{money(Number(r.gross_amount), r.currency ?? "GBP")}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {saving === r.id
                      ? <BrandLoader size="sm" className="h-3 w-3 inline-block" />
                      : <button onClick={() => markPaid(r)} className="text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
