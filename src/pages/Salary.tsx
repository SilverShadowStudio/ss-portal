import { useEffect, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Slip {
  id: string;
  period_label: string | null;
  period_end: string | null;
  gross: number | null;
  net: number | null;
  document_path: string | null;
  dropbox_path: string | null;
  salary_paid_at: string | null;
}
interface Payment { id: string; payslip_id: string; amount: number; paid_at: string; }

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const monthLabel = (s: Slip) => s.period_label
  ?? (s.period_end ? new Date(s.period_end).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "—");

/**
 * Employee-facing salary statement. Every month with its gross, net, due date,
 * payment(s) — including part-payments when a month was settled in instalments —
 * and the payslip itself. The one document employer and employee share.
 * RLS limits every query to the signed-in person's own account.
 */
export default function Salary() {
  const { toast } = useToast();
  const [slips, setSlips] = useState<Slip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: ps } = await supabase
        .from("payslips")
        .select("id, period_label, period_end, gross, net, document_path, dropbox_path, salary_paid_at")
        .order("period_end", { ascending: false });
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
      ) : slips.length === 0 ? (
        <div className="ssr-zone animate-fade-in">
          <div className="ssr-tile p-10 text-center text-recessive text-sm">Your salary statement will appear here once payroll is set up.</div>
        </div>
      ) : (
        <div className="ssr-zone animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Monthly statement</h2>
          </div>
          <div className="ssr-tile overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {["Month", "Gross", "Net", "Due", "Payments", "Status", "Payslip"].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] text-white/40 font-normal ${i === 1 || i === 2 ? "text-right" : i === 6 ? "text-center" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => {
                  const st = status(s);
                  const pays = paymentsFor(s.id);
                  return (
                    <tr key={s.id} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-4 py-3 text-strong">{monthLabel(s)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{money(Number(s.gross || 0))}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-strong">{money(Number(s.net || 0))}</td>
                      <td className="px-4 py-3 text-standard">{fmtDate(s.period_end)}</td>
                      <td className="px-4 py-3 text-recessive text-[12px]">
                        {pays.length === 0
                          ? (s.salary_paid_at ? fmtDate(s.salary_paid_at.slice(0, 10)) : "—")
                          : pays.map((p) => `${fmtDate(p.paid_at)} · ${money(Number(p.amount))}`).join("  ·  ")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={st.tone === "rest" ? "text-[11px] uppercase tracking-[0.16em] text-white/45" : st.tone === "part" ? "text-[11px] tabular-nums text-[#ecd39c]" : "text-[11px] uppercase tracking-[0.16em] text-[#C9A96A]"}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {busyId === s.id ? (
                          <BrandLoader size="sm" className="h-3.5 w-3.5 inline-block" />
                        ) : s.document_path ? (
                          <span className="inline-flex items-center gap-4" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
                            <button onClick={() => openPayslip(s, false)} className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors"><Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">View</span></button>
                            <button onClick={() => openPayslip(s, true)} className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors"><Download style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">PDF</span></button>
                          </span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">Net is your take-home pay. A month paid in instalments shows each payment above.</p>
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
