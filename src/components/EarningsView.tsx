import { BrandLoader } from "@/components/ui/BrandLoader";

// Shared presentational view for a freelancer's Earnings — rendered both on the
// team member's own portal (src/pages/Earnings.tsx) and, read-only, by an admin
// viewing a member's earnings (src/pages/admin/AdminTeamEarnings.tsx). It only
// renders the inner content; each caller wraps it in its own layout.

export interface EarningsLine { description: string; date: string | null; qty: number | null; unit: string; rate: number | null; amount: number }
export interface EarningsPeriod {
  key: string; role: string; period_label: string;
  total: number; amount_paid: number; balance: number; paid_status: string | null; lines: EarningsLine[];
}
export interface EarningsData {
  name: string | null; role: string | null; currency: string;
  totals: { earned: number; paid: number; outstanding: number };
  periods: EarningsPeriod[];
}

function niceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" });
}
function money(n: number, ccy: string) {
  const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ccy === "USD" ? "$" : `${ccy} `;
  return sym + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function qtyLabel(l: EarningsLine, ccy: string) {
  if (l.qty == null || l.rate == null) return "";
  return `${Number(l.qty).toLocaleString("en-GB")} ${l.unit} × ${money(l.rate, ccy)}`;
}

interface Props {
  data: EarningsData | null;
  loading: boolean;
  error: string | null;
  /** Header eyebrow label (defaults to "Earnings"). */
  eyebrow?: string;
  /** When set, shown in the subtitle in place of the role — e.g. the member's name for admins. */
  nameOverride?: string | null;
}

export function EarningsView({ data, loading, error, eyebrow = "Earnings", nameOverride }: Props) {
  const ccy = data?.currency ?? "GBP";
  const lead = nameOverride
    ? `${nameOverride}${data?.role ? ` — ${data.role}` : ""} · work in detail, `
    : data?.role ? `${data.role} — your work in detail, ` : "Your work in detail, ";

  return (
    <>
      {/* Page header — gold eyebrow */}
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">{eyebrow}</span>
        </div>
        <p className="mt-3 text-sm text-recessive">{lead}live from Airtable</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : error ? (
        <div className="ssr-zone"><div className="ssr-tile p-10 text-center text-recessive">We couldn&rsquo;t load these earnings just now. Please try again shortly.</div></div>
      ) : !data || data.periods.length === 0 ? (
        <div className="ssr-zone"><div className="ssr-tile p-10 text-center text-recessive">No earnings recorded yet. Work will appear here as it&rsquo;s logged.</div></div>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {/* ── Summary ───────────────────────────────────────────────── */}
          <div className="ssr-zone">
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Summary</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Total earned", value: data.totals.earned, gold: false },
                { label: "Paid", value: data.totals.paid, gold: true },
                { label: "Outstanding", value: data.totals.outstanding, gold: false },
              ].map((s) => (
                <div key={s.label} className="ssr-tile p-6">
                  <p className="text-label text-white/45">{s.label}</p>
                  <p className={`mt-3 font-serif tabular-nums ${s.gold ? "text-gold" : "text-strong"}`} style={{ fontSize: "1.85rem", letterSpacing: "-0.01em" }}>
                    {money(s.value, ccy)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Per-period breakdown ──────────────────────────────────── */}
          {data.periods.map((p) => (
            <div key={p.key} className="ssr-zone">
              <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-px w-6 bg-gold-muted" />
                  <h2 className="text-label">{p.period_label}</h2>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/35">{p.role}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-serif text-strong tabular-nums" style={{ fontSize: "1.05rem" }}>{money(p.total, ccy)}</span>
                  {p.balance <= 0.005
                    ? <span className="text-[9px] uppercase tracking-[0.22em] text-gold">Paid</span>
                    : <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">{money(p.balance, ccy)} due</span>}
                </div>
              </div>

              {p.lines.length === 0 ? (
                <div className="ssr-tile p-6 text-center text-recessive text-sm">Detail not available for this period.</div>
              ) : (
                <div className="ssr-tile overflow-hidden">
                  {p.lines.map((l, i) => (
                    <div key={i} className="flex items-baseline gap-6 px-6 py-3.5 border-b border-white/[0.05] last:border-0">
                      {l.date ? (
                        <>
                          <div className="w-[200px] shrink-0">
                            <p className="text-standard" style={{ fontSize: 13.5 }}>{niceDate(l.date)}</p>
                            {qtyLabel(l, ccy) && <p className="text-white/40 mt-0.5" style={{ fontSize: 11 }}>{qtyLabel(l, ccy)}</p>}
                          </div>
                          <p className="text-standard flex-1 min-w-0 truncate" style={{ fontSize: 13.5 }}>{l.description}</p>
                        </>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className="text-standard truncate" style={{ fontSize: 13.5 }}>{l.description}</p>
                          {qtyLabel(l, ccy) && <p className="text-white/40 mt-0.5" style={{ fontSize: 11 }}>{qtyLabel(l, ccy)}</p>}
                        </div>
                      )}
                      <p className="text-strong shrink-0 tabular-nums" style={{ fontSize: 13.5 }}>{money(l.amount, ccy)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
