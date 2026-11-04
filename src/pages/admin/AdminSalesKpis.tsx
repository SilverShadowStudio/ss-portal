import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// KPIs — one month of results per person, counted from the CRM.
//
// This is the page the monthly review is held against. The indicators match
// Schedule 3 of the business development agreement, so the contract and the
// screen use the same words. Everything comes from public.sales_kpis(), which
// runs under the caller's RLS: a rep sees her own row, an admin sees everyone.
//
// If it isn't logged, it didn't happen. That is the point, not a limitation.

interface KpiRow {
  owner_id: string;
  owner_name: string;
  outreach: number;
  replies: number;
  meetings: number;
  opportunities: number;
  pipeline_value: number;
  signed_count: number;
  signed_value: number;
}

const money = (n: number) =>
  "£" + new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

/** First day of the month `offset` months from the current one, as YYYY-MM-DD (local). */
function monthStart(offset: number): { iso: string; next: string; label: string } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-01`;
  return { iso: iso(d), next: iso(n), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
}

const COLUMNS: { key: keyof KpiRow | "reply_rate"; label: string; hint: string }[] = [
  { key: "outreach", label: "Outreach", hint: "Calls, emails and messages going out" },
  { key: "replies", label: "Replies", hint: "Responses coming in" },
  { key: "reply_rate", label: "Reply rate", hint: "Replies as a share of outreach" },
  { key: "meetings", label: "Meetings", hint: "Introductory meetings booked" },
  { key: "opportunities", label: "Opportunities", hint: "Leads moved to Qualified or later" },
  { key: "pipeline_value", label: "Pipeline", hint: "Open leads' estimated value today" },
  { key: "signed_value", label: "Signed", hint: "Leads marked Won this month" },
];

export default function AdminSalesKpis() {
  const { toast } = useToast();
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const month = monthStart(offset);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // sales_kpis is newer than the generated types, hence the narrow cast.
    (supabase as unknown as {
      rpc: (fn: string, args: Record<string, string>) => Promise<{ data: KpiRow[] | null; error: { message: string } | null }>;
    })
      .rpc("sales_kpis", { p_from: month.iso, p_to: month.next })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast({ title: "Couldn't load the KPIs", description: error.message, variant: "destructive" });
        setRows(data ?? []);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // month.iso is derived from offset; offset is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const cell = (r: KpiRow, key: (typeof COLUMNS)[number]["key"]) => {
    if (key === "reply_rate") return r.outreach ? `${Math.round((r.replies / r.outreach) * 100)}%` : "—";
    if (key === "pipeline_value") return r.pipeline_value ? money(r.pipeline_value) : "—";
    if (key === "signed_value") return r.signed_count ? `${money(r.signed_value)} · ${r.signed_count}` : "—";
    const v = r[key] as number;
    return v ? String(v) : "—";
  };

  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <div className="mb-8">
        <Link to="/admin/sales" className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-[#ecd39c]">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />Sales
        </Link>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold text-[#ecd39c]">KPIs</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setOffset((o) => o - 1)} className="text-white/40 hover:text-[#ecd39c]" title="Previous month">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <span className="min-w-[9rem] text-center text-[11px] uppercase tracking-[0.18em] text-strong">{month.label}</span>
            <button
              onClick={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset >= 0}
              className="text-white/40 hover:text-[#ecd39c] disabled:opacity-20"
              title="Next month"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm text-recessive">
          The month's results per person, counted from what is logged in Sales. These are the figures each monthly review is held against.
        </p>
      </div>

      <section className="ssr-zone mb-4">
        <div className="mb-5 flex items-center gap-3 border-b border-white/[0.07] pb-3">
          <div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Results</h2>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
        ) : rows.length === 0 ? (
          <div className="ssr-tile p-10 text-center text-sm text-recessive">No leads yet, so nothing to count.</div>
        ) : (
          <div className="ssr-tile overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="px-4 py-3 text-left text-[10px] font-normal uppercase tracking-[0.16em] text-white/45">Person</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} title={c.hint} className="px-4 py-3 text-right text-[10px] font-normal uppercase tracking-[0.16em] text-white/45">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.owner_id} className="border-b border-white/[0.05] last:border-0">
                    <td className="px-4 py-3 text-strong">{r.owner_name}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-right tabular-nums text-standard">{cell(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
          Activity counts by the lead's owner · Pipeline is today's figure, not the month-end one · Content published is tracked on Instagram and LinkedIn, not here
        </p>
      </section>
    </AdminLayout>
  );
}
