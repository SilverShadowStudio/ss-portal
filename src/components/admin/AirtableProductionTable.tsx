import { useEffect, useMemo, useState } from "react";
import { supabase, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ExternalLink, AlertTriangle, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface AirtableRow {
  id: string;
  modelName: string | null;
  modeller: string | null;
  status: string | null;
  approvalStatus: string | null;
  instructions: string | null;
  deadline: string | null;
  modelCost: number | null;
  budgetedHours: number | null;
  clientFacingStatus: string | null;
  referenceFolderUrl: string | null;
  productUrl: string | null;
}

interface ApiResponse {
  records: AirtableRow[];
  cachedAt: string;
  count: number;
}

function statusDot(value: string | null): string {
  const v = (value ?? "").toLowerCase();
  if (v.includes("done") || v.includes("approved") || v.includes("complete")) return "bg-emerald-500";
  if (v.includes("progress")) return "bg-gold";
  if (v.includes("review") || v.includes("pending") || v.includes("to do")) return "bg-sky-400";
  if (v.includes("block") || v.includes("reject") || v.includes("fail")) return "bg-rose-500";
  return "bg-foreground/20";
}

function StatusCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-foreground/25">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDot(value))} />
      <span className="text-foreground/70">{value}</span>
    </span>
  );
}

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

function formatDeadline(s: string | null): { label: string; overdue: boolean } {
  if (!s) return { label: "—", overdue: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { label: s, overdue: false };
  return {
    label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    overdue: d.getTime() < Date.now(),
  };
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_FILTERS = ["All", "In Progress", "Done", "Review", "To Do"] as const;

export function AirtableProductionTable() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  const load = async (force = false) => {
    setError(null);
    force ? setRefreshing(true) : setLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const url = `https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/airtable-list-models${force ? "?force_refresh=true" : ""}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`);
      setData(json as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.records;
    if (statusFilter !== "All") {
      const f = statusFilter.toLowerCase();
      rows = rows.filter(r =>
        [r.status, r.approvalStatus, r.clientFacingStatus].some(v => v?.toLowerCase().includes(f))
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        [r.modelName, r.modeller, r.status, r.approvalStatus, r.clientFacingStatus]
          .some(v => v?.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [data, search, statusFilter]);

  const donePct = useMemo(() => {
    if (!data?.records.length) return null;
    const done = data.records.filter(r =>
      [r.status, r.approvalStatus].some(v => v?.toLowerCase().includes("done") || v?.toLowerCase().includes("approved"))
    ).length;
    return Math.round((done / data.records.length) * 100);
  }, [data]);

  return (
    <div className="border border-border/60 bg-card rounded-sm overflow-hidden">

      {/* Controls */}
      <div className="flex flex-col gap-3 border-b border-border/30 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "font-sans text-[10px] uppercase tracking-[0.2em] transition-colors",
                statusFilter === f ? "text-foreground" : "text-foreground/30 hover:text-foreground/60"
              )}
            >
              {f}
            </button>
          ))}
          {data && (
            <span className="text-[10px] font-sans uppercase tracking-[0.18em] text-foreground/25 ml-2">
              {filtered.length}/{data.count}
              {donePct !== null && <> · {donePct}% done</>}
              {data.cachedAt && <> · {timeAgo(data.cachedAt)}</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-44 pl-8 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing || loading} className="h-8">
            <RefreshCw size={13} className={cn("mr-1.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 border-b border-border/30 bg-rose-500/5 px-6 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-rose-500" size={14} />
          <div>
            <p className="text-xs font-medium text-foreground">Couldn't load Airtable data</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="px-6 py-8 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-sm bg-muted/30" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-xs text-foreground/30 uppercase tracking-[0.2em] font-sans">
          {search || statusFilter !== "All" ? "No models match" : "No records"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 bg-muted/20">
                {["Model", "Modeller", "Status", "Approval", "Client Status", "Deadline", "Cost", "Hrs", ""].map(h => (
                  <th key={h} className={cn(
                    "px-4 py-3 font-sans text-[10px] uppercase tracking-[0.18em] text-foreground/35 font-medium",
                    h === "Cost" || h === "Hrs" || h === "" ? "text-right" : "text-left"
                  )}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const dl = formatDeadline(r.deadline);
                return (
                  <tr key={r.id} className="border-b border-border/20 last:border-0 hover:bg-foreground/[0.02] transition-colors">
                    <td className="px-4 py-3 text-foreground/80 font-medium max-w-[200px] truncate">
                      {r.modelName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-foreground/50 whitespace-nowrap">
                      {r.modeller ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusCell value={r.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusCell value={r.approvalStatus} /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusCell value={r.clientFacingStatus} /></td>
                    <td className={cn("px-4 py-3 whitespace-nowrap tabular-nums",
                      dl.overdue && dl.label !== "—" ? "text-rose-500" : "text-foreground/40"
                    )}>
                      {dl.label}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground/60">
                      {formatCurrency(r.modelCost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground/40">
                      {r.budgetedHours ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {r.referenceFolderUrl && (
                          <a href={r.referenceFolderUrl} target="_blank" rel="noopener noreferrer"
                            className="font-sans text-[10px] uppercase tracking-[0.18em] text-foreground/30 hover:text-foreground/70 transition-colors inline-flex items-center gap-1">
                            Ref <ExternalLink size={10} />
                          </a>
                        )}
                        {r.productUrl && (
                          <a href={r.productUrl} target="_blank" rel="noopener noreferrer"
                            className="font-sans text-[10px] uppercase tracking-[0.18em] text-foreground/30 hover:text-foreground/70 transition-colors inline-flex items-center gap-1">
                            Product <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
