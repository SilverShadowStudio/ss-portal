import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles, FileText, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BrandLoader } from "@/components/ui/BrandLoader";

interface MissingRow { id: string; date: string | null; amount: number; counterparty: string | null; reference: string | null; kind: string }
interface OrphanRow { id: string; name: string; path: string; side: string; invoiceNo: string | null; amount: number | null; date: string | null }

const money = (n: number) => `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function AdminReconciliation() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; matched: number; renamed: number; remaining: number } | null>(null);
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [matched, setMatched] = useState<number | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("reconcile-receipts", { body });
    if (error) throw error;
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as Record<string, unknown>;
  }, []);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke({ action: "list" });
      setMissing((d.missing as MissingRow[]) ?? []);
      setOrphans((d.orphans as OrphanRow[]) ?? []);
      setMatched((d.matched as number) ?? null);
    } catch (e) {
      toast({ title: "Could not load reconciliation", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [invoke, toast]);

  useEffect(() => { loadLists(); }, [loadLists]);

  async function scan() {
    setScanning(true);
    try {
      const d = await invoke({ action: "scan" });
      toast({ title: "Scan complete", description: `${d.filesCataloged} files · ${d.matched} matched by reference/amount` });
      await loadLists();
    } catch (e) {
      toast({ title: "Scan failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  async function runAi() {
    if (!window.confirm("AI-read every remaining receipt, match to a Revolut line, and rename confident matches to the standard? This renames real Dropbox files (an audit trail is kept).")) return;
    setAiRunning(true);
    setAiProgress({ done: 0, matched: 0, renamed: 0, remaining: 0 });
    try {
      let done = 0, m = 0, r = 0;
      for (let i = 0; i < 400; i++) {
        const d = await invoke({ action: "ai-parse", batch: 10 });
        done += Number(d.processed) || 0; m += Number(d.matched) || 0; r += Number(d.renamed) || 0;
        setAiProgress({ done, matched: m, renamed: r, remaining: Number(d.remaining) || 0 });
        if (Number(d.remaining) <= 0 || Number(d.processed) === 0) break;
      }
      toast({ title: "AI reconciliation complete", description: `${m} matched · ${r} renamed to standard` });
      await loadLists();
    } catch (e) {
      toast({ title: "AI reconciliation stopped", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setAiRunning(false);
    }
  }

  const missingIncome = missing.filter((m) => m.kind === "client_income");
  const missingExpense = missing.filter((m) => m.kind === "expense");

  return (
    <AdminLayout panel>
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Reconciliation</span>
        </div>
        <p className="mt-3 text-sm text-recessive">Match every Revolut entry to its invoice/receipt in Dropbox 03_Invoices. Missing receipts and orphan files are listed below.</p>
      </div>

      {/* Actions + summary */}
      <section className="ssr-zone mb-4">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Run</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={scan} disabled={scanning || aiRunning}
              className="inline-flex items-center gap-2 rounded bg-white/5 px-3 py-1.5 text-xs text-standard hover:bg-white/10 disabled:opacity-40">
              {scanning ? <BrandLoader size="sm" className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {scanning ? "Scanning…" : "Scan Dropbox"}
            </button>
            <button onClick={runAi} disabled={scanning || aiRunning}
              className="inline-flex items-center gap-2 rounded bg-gold/20 px-3 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40">
              {aiRunning ? <BrandLoader size="sm" className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiRunning ? "AI reconciling…" : "AI reconcile + rename"}
            </button>
          </div>
        </div>

        {aiRunning && aiProgress && (
          <div className="ssr-tile mb-3 px-4 py-2.5 text-xs text-standard">
            Reading receipts… {aiProgress.done} processed · {aiProgress.matched} matched · {aiProgress.renamed} renamed · {aiProgress.remaining} remaining
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Matched receipts" value={matched != null ? String(matched) : "—"} />
          <Tile label="Income missing receipt" value={String(missingIncome.length)} tone={missingIncome.length ? "warn" : undefined} />
          <Tile label="Expense missing receipt" value={String(missingExpense.length)} tone={missingExpense.length ? "warn" : undefined} />
          <Tile label="Orphan receipts" value={String(orphans.length)} tone={orphans.length ? "warn" : undefined} />
        </div>
      </section>

      {loading ? (
        <div className="ssr-zone grid place-items-center py-20"><BrandLoader /></div>
      ) : (
        <>
          {/* Missing receipts */}
          <section className="ssr-zone mb-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Revolut entries missing a receipt · {missing.length}</h2>
            </div>
            {missing.length === 0 ? (
              <div className="ssr-tile p-8 text-center text-sm text-recessive">Every Revolut entry has a matched receipt.</div>
            ) : (
              <div className="ssr-tile overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left text-label">
                      <th className="px-4 py-2 font-normal">Date</th>
                      <th className="px-4 py-2 font-normal">Counterparty</th>
                      <th className="px-4 py-2 font-normal">Reference</th>
                      <th className="px-4 py-2 font-normal">Type</th>
                      <th className="px-4 py-2 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missing.slice(0, 400).map((m) => (
                      <tr key={m.id} className="border-b border-white/[0.04]">
                        <td className="px-4 py-2 text-recessive whitespace-nowrap">{fmtDate(m.date)}</td>
                        <td className="px-4 py-2 text-standard">{m.counterparty ?? "—"}</td>
                        <td className="px-4 py-2 text-recessive">{m.reference ?? "—"}</td>
                        <td className="px-4 py-2"><span className="rounded bg-white/5 px-2 py-0.5 text-xs text-recessive">{m.kind === "client_income" ? "Income" : "Expense"}</span></td>
                        <td className="px-4 py-2 text-right tabular-nums text-standard">{money(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missing.length > 400 && <p className="px-4 py-2 text-xs text-recessive">Showing first 400 of {missing.length}.</p>}
              </div>
            )}
          </section>

          {/* Orphan receipts */}
          <section className="ssr-zone">
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Receipts with no Revolut line · {orphans.length}</h2>
            </div>
            {orphans.length === 0 ? (
              <div className="ssr-tile p-8 text-center text-sm text-recessive">Every receipt file matches a Revolut line.</div>
            ) : (
              <div className="ssr-tile overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left text-label">
                      <th className="px-4 py-2 font-normal">File</th>
                      <th className="px-4 py-2 font-normal">Side</th>
                      <th className="px-4 py-2 font-normal">Parsed date</th>
                      <th className="px-4 py-2 text-right font-normal">Parsed amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.slice(0, 400).map((o) => (
                      <tr key={o.id} className="border-b border-white/[0.04]">
                        <td className="px-4 py-2 text-standard"><span className="inline-flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-recessive shrink-0" />{o.name}</span></td>
                        <td className="px-4 py-2 text-recessive">{o.side.replace("payable_", "").replace("_", " ")}</td>
                        <td className="px-4 py-2 text-recessive whitespace-nowrap">{fmtDate(o.date)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-standard">{o.amount != null ? money(o.amount) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {orphans.length > 400 && <p className="px-4 py-2 text-xs text-recessive">Showing first 400 of {orphans.length}.</p>}
              </div>
            )}
          </section>
        </>
      )}
    </AdminLayout>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="ssr-tile px-4 py-3">
      <p className="font-serif text-strong" style={{ fontSize: 24, lineHeight: 1 }}>
        {tone === "warn" && value !== "0" && <AlertTriangle className="mr-1.5 inline h-4 w-4 text-[#d3b47c]" />}
        {value}
      </p>
      <p className="text-label mt-1">{label}</p>
    </div>
  );
}
