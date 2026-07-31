import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BrandLoader } from "@/components/ui/BrandLoader";

interface Pocket { currency: string; balance: number; name: string; gbp: number }
interface Balances { capturedAt: string; totalGbp: number; pockets: Pocket[] }

const sb = supabase as unknown as {
  from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: { total_gbp: number }[] | null }> } } };
};

const gbp = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const orig = (n: number, c: string) => n.toLocaleString("en-GB", { style: "currency", currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CashPositionCard() {
  const [data, setData] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trend, setTrend] = useState<number[]>([]);

  const loadTrend = useCallback(async () => {
    try {
      const { data: rows } = await sb.from("bank_balance_snapshots").select("total_gbp").order("captured_at", { ascending: false }).limit(30);
      setTrend(((rows ?? []) as { total_gbp: number }[]).map((r) => Number(r.total_gbp)).reverse());
    } catch { /* trend is optional */ }
  }, []);

  const fetchLive = useCallback(async (isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("revolut-balances", { body: {} });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      setData(res as Balances);
      await loadTrend();
    } catch {
      // Fall back to nothing — card shows unavailable state.
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [loadTrend]);

  useEffect(() => { fetchLive(false); }, [fetchLive]);

  const asOf = data ? new Date(data.capturedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  const nonZero = (data?.pockets ?? []).filter((p) => Math.abs(p.balance) > 0.005);

  return (
    <div className="mb-4 animate-fade-in">
      <div className="ssr-zone">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Cash position</h2>
          </div>
          <div className="flex items-center gap-3">
            {asOf && <span className="text-xs text-recessive">as of {asOf}</span>}
            <button
              onClick={() => fetchLive(true)} disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 rounded bg-gold/20 px-2.5 py-1 text-xs text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40">
              {refreshing ? <BrandLoader size="sm" className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="ssr-tile grid place-items-center py-10"><BrandLoader /></div>
        ) : !data ? (
          <div className="ssr-tile p-6 text-center text-sm text-recessive">Live balance unavailable — try Refresh.</div>
        ) : (
          <div className="flex flex-wrap items-stretch gap-3">
            {/* Total */}
            <div className="ssr-tile flex min-w-[220px] flex-1 flex-col justify-between px-5 py-4">
              <div>
                <p className="text-label">Total across pockets</p>
                <p className="mt-1 font-serif text-strong" style={{ fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em" }}>{gbp(data.totalGbp)}</p>
              </div>
              {trend.length > 1 && <Sparkline values={trend} />}
            </div>
            {/* Pockets */}
            <div className="ssr-tile min-w-[240px] flex-1 px-5 py-4">
              <p className="text-label mb-2">Pockets</p>
              <div className="flex flex-col gap-1.5">
                {nonZero.length === 0 ? (
                  <p className="text-sm text-recessive">All pockets empty.</p>
                ) : nonZero.map((p, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-sm text-standard">{p.name}{p.currency !== "GBP" ? ` · ${p.currency}` : ""}</span>
                    <span className="shrink-0 tabular-nums text-sm text-standard">
                      {p.currency === "GBP" ? gbp(p.gbp) : <>{orig(p.balance, p.currency)} <span className="text-recessive">≈ {gbp(p.gbp)}</span></>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 160, h = 28;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-3" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? "#d3b47c" : "#a4796b"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
