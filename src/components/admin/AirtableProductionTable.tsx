import { useEffect, useMemo, useState } from "react";
import { supabase, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ExternalLink, AlertCircle, Search } from "lucide-react";
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

function statusBadgeClasses(value: string | null): string {
  const v = (value || "").toLowerCase();
  if (v.includes("done") || v.includes("approved") || v.includes("complete")) {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  }
  if (v.includes("progress")) {
    return "bg-[#181613] text-gold-muted border-gold/30";
  }
  if (v.includes("review") || v.includes("pending")) {
    return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30";
  }
  if (v.includes("block") || v.includes("reject") || v.includes("fail")) {
    return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
  }
  return "bg-muted text-muted-foreground border-border";
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        statusBadgeClasses(value),
      )}
    >
      {value}
    </span>
  );
}

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function formatDeadline(s: string | null): { label: string; overdue: boolean } {
  if (!s) return { label: "—", overdue: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { label: s, overdue: false };
  const overdue = d.getTime() < Date.now();
  return {
    label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    overdue,
  };
}

export function AirtableProductionTable() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async (force = false) => {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const projectId = "oodhsoiwnqxcimzmzick";
      const url = `https://${projectId}.supabase.co/functions/v1/airtable-list-models${
        force ? "?force_refresh=true" : ""
      }`;
      const r = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
      setData(json as ApiResponse);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.records;
    return data.records.filter((r) =>
      [r.modelName, r.modeller, r.status, r.approvalStatus, r.clientFacingStatus]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <div className="h-px w-6 bg-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Airtable
            </span>
          </div>
          <h2 className="font-serif text-xl tracking-tight text-foreground md:text-2xl">
            Production Tracker
          </h2>
          <p className="mt-1 text-xs text-muted-foreground font-sans">
            Showing all rows. Per-project filtering coming soon.
            {data?.cachedAt && (
              <>
                {" · "}Last updated{" "}
                {new Date(data.cachedAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models…"
              className="h-9 w-56 pl-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw size={14} className={cn("mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 border-b border-border bg-rose-500/5 px-6 py-4">
          <AlertCircle className="mt-0.5 text-rose-500" size={16} />
          <div className="text-sm">
            <p className="font-medium text-foreground">Couldn't load Airtable data</p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-6 py-10">
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          {search ? "No models match your search." : "No records found."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Modeller</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Approval</th>
                <th className="px-4 py-3 text-left font-medium">Client Facing</th>
                <th className="px-4 py-3 text-left font-medium">Deadline</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-right font-medium">Hrs</th>
                <th className="px-4 py-3 text-left font-medium">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => {
                const dl = formatDeadline(r.deadline);
                return (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.modelName || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.modeller || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge value={r.status} /></td>
                    <td className="px-4 py-3"><StatusBadge value={r.approvalStatus} /></td>
                    <td className="px-4 py-3"><StatusBadge value={r.clientFacingStatus} /></td>
                    <td
                      className={cn(
                        "px-4 py-3 whitespace-nowrap",
                        dl.overdue ? "text-rose-500 font-medium" : "text-muted-foreground",
                      )}
                    >
                      {dl.label}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatCurrency(r.modelCost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {r.budgetedHours ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.referenceFolderUrl && (
                          <a
                            href={r.referenceFolderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            title="Reference folder"
                          >
                            Ref <ExternalLink size={11} />
                          </a>
                        )}
                        {r.productUrl && (
                          <a
                            href={r.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            title="Product page"
                          >
                            Product <ExternalLink size={11} />
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
    </section>
  );
}

export default AirtableProductionTable;