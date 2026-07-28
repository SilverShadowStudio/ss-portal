import { useEffect, useState } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

interface Line { description: string; qty: number | null; unit: string; rate: number | null; amount: number }
interface Period {
  key: string; role: string; period_label: string;
  total: number; amount_paid: number; balance: number; paid_status: string | null; lines: Line[];
}
interface EarningsData {
  name: string | null; role: string | null; currency: string;
  totals: { earned: number; paid: number; outstanding: number };
  periods: Period[];
}

function money(n: number, ccy: string) {
  const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ccy === "USD" ? "$" : `${ccy} `;
  return sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function qtyLabel(l: Line) {
  if (l.qty == null || l.rate == null) return "";
  const q = Number(l.qty).toLocaleString("en-GB");
  return `${q} ${l.unit} × ${l.rate}`;
}

export default function Earnings() {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke("freelancer-earnings").then(({ data, error }) => {
      if (error) setError(error.message);
      else setData(data as EarningsData);
      setLoading(false);
    });
  }, []);

  const ccy = data?.currency ?? "GBP";

  return (
    <ClientLayout>
      {/* Header */}
      <div className="mb-14 animate-fade-in">
        <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}>
          Earnings
        </h1>
        <p className="mt-3 font-sans uppercase text-foreground/45" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
          {data?.role ? `${data.role} · your work in detail` : "Your work in detail"} — live from Airtable
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : error ? (
        <p className="font-serif italic text-foreground/45 py-4 border-t border-border/30" style={{ fontSize: 13 }}>
          We couldn&rsquo;t load your earnings just now. Please try again shortly.
        </p>
      ) : !data || data.periods.length === 0 ? (
        <p className="font-serif italic text-foreground/45 py-4 border-t border-border/30" style={{ fontSize: 13 }}>
          No earnings recorded yet. Your work will appear here as it&rsquo;s logged.
        </p>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {/* ── Summary ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-14">
            {[
              { label: "Total earned", value: data.totals.earned, tone: "text-foreground" },
              { label: "Paid", value: data.totals.paid, tone: "text-gold" },
              { label: "Outstanding", value: data.totals.outstanding, tone: "text-foreground" },
            ].map((s) => (
              <div key={s.label} className="ssr-tile" style={{ padding: "22px 24px" }}>
                <p className="font-sans uppercase text-foreground/45" style={{ fontSize: 9, letterSpacing: "0.24em" }}>{s.label}</p>
                <p className={`font-serif ${s.tone} mt-3 tabular-nums`} style={{ fontSize: "1.9rem", letterSpacing: "-0.01em" }}>
                  {money(s.value, ccy)}
                </p>
              </div>
            ))}
          </div>

          {/* ── Periods ───────────────────────────────────────────────── */}
          <div className="space-y-12">
            {data.periods.map((p) => (
              <section key={p.key}>
                {/* Period header */}
                <div className="flex items-end justify-between gap-4 border-b border-border/40 pb-3">
                  <div>
                    <p className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>{p.role}</p>
                    <h2 className="font-serif font-normal text-foreground mt-1" style={{ fontSize: "1.5rem", letterSpacing: "-0.005em" }}>
                      {p.period_label}
                    </h2>
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-foreground tabular-nums" style={{ fontSize: "1.25rem" }}>{money(p.total, ccy)}</p>
                    <p className="font-sans uppercase mt-1" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                      {p.balance <= 0.005
                        ? <span className="text-gold">Paid</span>
                        : <span className="text-foreground/45">{money(p.balance, ccy)} outstanding</span>}
                    </p>
                  </div>
                </div>

                {/* Line items */}
                {p.lines.length === 0 ? (
                  <p className="font-serif italic text-foreground/35 py-4" style={{ fontSize: 12.5 }}>
                    Detail not available for this period.
                  </p>
                ) : (
                  <div>
                    {p.lines.map((l, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-6 py-3 border-b border-border/20">
                        <div className="min-w-0">
                          <p className="font-serif text-foreground truncate" style={{ fontSize: 13.5 }}>{l.description}</p>
                          {qtyLabel(l) && (
                            <p className="font-sans text-foreground/40 mt-0.5" style={{ fontSize: 11 }}>{qtyLabel(l)}</p>
                          )}
                        </div>
                        <p className="font-serif text-foreground shrink-0 tabular-nums" style={{ fontSize: 13.5 }}>{money(l.amount, ccy)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </ClientLayout>
  );
}
