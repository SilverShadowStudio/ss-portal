import { useEffect, useMemo, useState } from "react";
import { Clock, X } from "lucide-react";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { ACTION_LABELS } from "@/lib/activityLog";
import { cn } from "@/lib/utils";

interface ActivityRow {
  id: string;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  description: string;
  project_name: string | null;
  scene_name: string | null;
  round_number: number | null;
}

// Unique badge labels for filter chips (in display order)
const BADGE_FILTERS = [
  "Project",
  "Scene",
  "Round",
  "Delivery",
  "Upload",
  "Status",
  "Approved",
  "Revision",
  "Removed",
  "Client",
  "Agreement",
];

const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1.5";
const inputCls =
  "bg-transparent border-b border-border/50 py-1 text-[11px] text-foreground focus:outline-none focus:border-gold transition-colors w-36";

export default function AdminActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLabels, setActiveLabels] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("activity_log")
        .select(
          "id, created_at, actor_name, actor_role, action, description, project_name, scene_name, round_number",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      setRows((data ?? []) as ActivityRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      // Badge filter
      if (activeLabels.size > 0) {
        const badge = ACTION_LABELS[row.action] ?? row.action;
        if (!activeLabels.has(badge)) return false;
      }
      // Date range filter
      if (fromDate) {
        const from = startOfDay(parseISO(fromDate));
        if (new Date(row.created_at) < from) return false;
      }
      if (toDate) {
        const to = endOfDay(parseISO(toDate));
        if (new Date(row.created_at) > to) return false;
      }
      return true;
    });
  }, [rows, activeLabels, fromDate, toDate]);

  function toggleLabel(label: string) {
    setActiveLabels((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function clearFilters() {
    setActiveLabels(new Set());
    setFromDate("");
    setToDate("");
  }

  const hasFilters = activeLabels.size > 0 || fromDate || toDate;

  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Studio Records</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          ACTIVITY LOG
        </h1>
        <p className="text-sm text-muted-foreground">
          Complete, immutable history of production-critical actions.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-8 animate-fade-in space-y-5" style={{ animationDelay: "0.05s" }}>
        {/* Badge type chips */}
        <div>
          <p className={labelCls}>Filter by type</p>
          <div className="flex flex-wrap gap-2">
            {BADGE_FILTERS.map((label) => {
              const active = activeLabels.has(label);
              return (
                <button
                  key={label}
                  onClick={() => toggleLabel(label)}
                  className={cn(
                    "inline-flex items-center rounded-sm px-2.5 py-1 text-[9px] font-bold tracking-[0.18em] uppercase transition-colors border",
                    active
                      ? "bg-gold/10 border-gold/40 text-gold"
                      : "bg-muted/40 border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date range */}
        <div className="flex items-end gap-8">
          <div>
            <label className={labelCls}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputCls}
            />
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
              Clear
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-[10px] tracking-[0.2em] text-muted-foreground mb-1">
              {filtered.length} {filtered.length === 1 ? "ENTRY" : "ENTRIES"}
              {rows.length !== filtered.length && ` of ${rows.length}`}
            </span>
          )}
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-6 md:p-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground tracking-wider">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="h-5 w-5 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-serif text-base text-muted-foreground">
              {hasFilters ? "No entries match the current filters" : "No activity recorded yet"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {filtered.map((row) => (
              <li
                key={row.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <span className="mt-1 inline-flex h-5 min-w-[72px] items-center justify-center rounded-sm bg-muted/60 px-2 text-[9px] font-bold tracking-[0.18em] uppercase text-muted-foreground shrink-0">
                  {ACTION_LABELS[row.action] ?? row.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{row.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">
                    {row.actor_name ?? "Unknown"}
                    {row.actor_role ? ` · ${row.actor_role}` : ""}
                    {row.project_name ? ` · ${row.project_name}` : ""}
                    {row.scene_name ? ` · ${row.scene_name}` : ""}
                    {row.round_number != null
                      ? ` · Round ${String(row.round_number).padStart(2, "0")}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tracking-[0.15em] uppercase text-muted-foreground whitespace-nowrap">
                  {format(new Date(row.created_at), "d MMM yyyy · HH:mm")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}
