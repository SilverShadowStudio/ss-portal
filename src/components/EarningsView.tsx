import { Fragment, useState } from "react";
import { ChevronRight, Eye, Download, Upload } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

// Shared presentational view for a freelancer's Earnings — rendered both on the
// team member's own portal (src/pages/Earnings.tsx) and, read-only, by an admin
// (src/pages/admin/AdminTeamEarnings.tsx). It only renders the inner content;
// each caller wraps it in its own layout.
//
// A monthly statement, mirroring the employee Salary page: one row per month
// showing the FEE (no gross/net — a freelancer invoices a single figure), when
// it fell due, what's been paid, its status, and the self-billed invoice.
// Clicking a month expands its Airtable line items underneath.

export interface EarningsLine { description: string; date: string | null; qty: number | null; unit: string; rate: number | null; amount: number }
export interface EarningsPeriod {
  key: string; role: string; period_label: string;
  period_year?: number | null; period_month?: number | null; source_table?: string | null;
  due_date?: string | null;
  total: number; amount_paid: number; balance: number; paid_status: string | null;
  invoice?: { id: string; invoice_number: string | null; filed: boolean } | null;
  lines: EarningsLine[];
}
export interface EarningsData {
  name: string | null; role: string | null; currency: string;
  payee_email?: string | null;
  totals: { earned: number; paid: number; outstanding: number };
  periods: EarningsPeriod[];
}

// Expanded line items sit in a muted gold so they read as supporting detail and
// don't compete with the month rows above them.
const DETAIL = "rgba(201,169,106,0.72)";
const DETAIL_DIM = "rgba(201,169,106,0.42)";
const DETAIL_AMOUNT = "rgba(201,169,106,0.88)";

function niceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" });
}
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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
  eyebrow?: string;
  nameOverride?: string | null;
  /** Admin only: file a historical invoice for a month that predates self-billing. */
  canUpload?: boolean;
  /** The freelancer's email — needed to file an uploaded invoice against them. */
  payeeEmail?: string | null;
  onUploaded?: () => void;
}

export function EarningsView({ data, loading, error, eyebrow = "Earnings", nameOverride, canUpload, payeeEmail, onUploaded }: Props) {
  const ccy = data?.currency ?? "GBP";
  // One month open at a time — opening another closes the previous, so the
  // statement never becomes a long scroll of expanded detail.
  const [open, setOpen] = useState<string | null>(null);
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key));

  async function openInvoice(invoiceId: string, download: boolean) {
    setBusyInvoice(invoiceId);
    try {
      const { data: res, error } = await supabase.functions.invoke("freelancer-invoice-link", { body: { invoice_id: invoiceId } });
      if (error) throw new Error(error.message);
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      const url = (res as { url: string }).url;
      window.open(download ? `${url}${url.includes("?") ? "&" : "?"}dl=1` : url, "_blank", "noopener,noreferrer");
    } catch {
      /* the row simply stays as it was — no invoice is not an error state */
    } finally {
      setBusyInvoice(null);
    }
  }

  async function uploadInvoice(p: EarningsPeriod, file: File) {
    if (!payeeEmail || !p.period_year || !p.period_month) return;
    setBusyInvoice(p.key);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(new Error("Couldn't read that file"));
        r.readAsDataURL(file);
      });
      const { data: out, error } = await supabase.functions.invoke("freelancer-invoice-upload", {
        body: {
          payee_email: payeeEmail, period_year: p.period_year, period_month: p.period_month,
          source_table: p.source_table ?? undefined, pdf_base64: b64,
        },
      });
      if (error) throw new Error(error.message);
      if ((out as { error?: string })?.error) throw new Error((out as { error: string }).error);
      onUploaded?.();
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setBusyInvoice(null);
    }
  }

  const lead = nameOverride
    ? `${nameOverride}${data?.role ? ` — ${data.role}` : ""} · work in detail, `
    : data?.role ? `${data.role} — your work in detail, ` : "Your work in detail, ";

  function statusOf(p: EarningsPeriod) {
    if (p.balance <= 0.005) return { label: "Paid", tone: "rest" as const };
    if (p.amount_paid > 0.005) return { label: `${money(p.amount_paid, ccy)} of ${money(p.total, ccy)}`, tone: "part" as const };
    return { label: "Awaiting payment", tone: "action" as const };
  }

  return (
    <>
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

          {/* ── Monthly statement ─────────────────────────────────────── */}
          <div className="ssr-zone">
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Monthly statement</h2>
            </div>

            <div className="ssr-tile overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    {["Month", "Fee", "Due", "Payments", "Status", "Invoice"].map((h, i) => (
                      <th key={h}
                        className={`px-4 py-3 text-[9px] uppercase tracking-[0.2em] font-normal text-white/40 ${i === 1 ? "text-right" : i === 5 ? "text-center" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => {
                    const st = statusOf(p);
                    const isOpen = open === p.key;
                    return (
                      <Fragment key={p.key}>
                        <tr
                          onClick={() => toggle(p.key)}
                          data-open={isOpen}
                          className="ssr-row-sweep group cursor-pointer border-b border-white/[0.05]"
                        >
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2">
                              <ChevronRight
                                className="h-3 w-3 shrink-0 text-white/35 transition-transform"
                                style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                                strokeWidth={1.6}
                              />
                              <span className="text-strong">{p.period_label}</span>
                              <span className="text-[9px] uppercase tracking-[0.16em] text-white/30">{p.role}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-strong">{money(p.total, ccy)}</td>
                          <td className="px-4 py-3 text-standard">{shortDate(p.due_date)}</td>
                          <td className="px-4 py-3 text-[12px] text-recessive tabular-nums">
                            {p.amount_paid > 0.005 ? money(p.amount_paid, ccy) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={
                              st.tone === "rest" ? "text-[11px] uppercase tracking-[0.16em] text-white/45"
                                : st.tone === "part" ? "text-[11px] tabular-nums text-[#ecd39c]"
                                : "text-[11px] uppercase tracking-[0.16em] text-[#C9A96A]"
                            }>{st.label}</span>
                          </td>
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            {busyInvoice === p.invoice?.id ? (
                              <BrandLoader size="sm" className="inline-block h-3.5 w-3.5" />
                            ) : p.invoice?.filed ? (
                              <span className="inline-flex items-center gap-4" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
                                <button onClick={() => openInvoice(p.invoice!.id, false)} className="flex items-center gap-1.5 text-white/40 transition-colors hover:text-gold">
                                  <Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">View</span>
                                </button>
                                <button onClick={() => openInvoice(p.invoice!.id, true)} className="flex items-center gap-1.5 text-white/40 transition-colors hover:text-gold">
                                  <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} /><span className="font-sans uppercase">PDF</span>
                                </button>
                              </span>
                            ) : canUpload ? (
                              <label
                                className="inline-flex cursor-pointer items-center gap-1.5 text-white/35 transition-colors hover:text-gold"
                                style={{ fontSize: 10, letterSpacing: "0.16em" }}
                                title="File a historical invoice for this month"
                              >
                                <Upload style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                                <span className="font-sans uppercase">Upload</span>
                                <input
                                  type="file" accept="application/pdf" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadInvoice(p, f); }}
                                />
                              </label>
                            ) : <span className="text-white/20">—</span>}
                          </td>
                        </tr>

                        {/* Line items are real rows, not a nested block, so each day's
                            amount lands directly under the Fee column. */}
                        {isOpen && p.lines.length === 0 && (
                          <tr className="border-b border-white/[0.05]">
                            <td colSpan={6} className="px-4 py-3 text-center text-xs text-recessive">
                              Detail not available for this month.
                            </td>
                          </tr>
                        )}
                        {isOpen && p.lines.map((l, i) => (
                          <tr key={`${p.key}-l${i}`} className="border-b border-white/[0.04] last:border-white/[0.05]">
                            <td className="py-2.5 pl-4 pr-4">
                              <div className="flex items-baseline gap-6 border-l border-white/[0.08] pl-4">
                                {l.date && (
                                  <div className="w-[180px] shrink-0">
                                    <p style={{ fontSize: 13, color: DETAIL }}>{niceDate(l.date)}</p>
                                    {qtyLabel(l, ccy) && <p className="mt-0.5" style={{ fontSize: 11, color: DETAIL_DIM }}>{qtyLabel(l, ccy)}</p>}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate" style={{ fontSize: 13, color: DETAIL }}>{l.description}</p>
                                  {!l.date && qtyLabel(l, ccy) && <p className="mt-0.5" style={{ fontSize: 11, color: DETAIL_DIM }}>{qtyLabel(l, ccy)}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 pr-4 text-right align-top tabular-nums" style={{ fontSize: 13, color: DETAIL_AMOUNT }}>
                              {money(l.amount, ccy)}
                            </td>
                            <td colSpan={4} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {uploadError && <p className="mt-3 px-1 text-xs text-[#FF6B5A]">{uploadError}</p>}
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 px-1">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Click a month to see the work behind it</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                Outstanding{" "}
                <span className={`tabular-nums ${data.totals.outstanding > 0.005 ? "text-[#ecd39c]" : "text-white/45"}`}>
                  {money(data.totals.outstanding, ccy)}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
