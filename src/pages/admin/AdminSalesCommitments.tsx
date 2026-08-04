import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, X, CalendarClock, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, TableFilterSelect, SortTh } from "@/components/ui/TableToolbar";

// Commitments — what was promised, by whom, and by when.
//
// The Director creates these from conversation; this is where they're worked.
// The column that matters most is Slipped: a deal whose date has moved four
// times is not a live deal, whatever stage it claims to be at.

interface Row {
  id: string;
  lead_id: string;
  party: string;
  description: string;
  due_date: string;
  status: string;
  slip_count: number;
  original_due_date: string | null;
  completed_at: string | null;
  created_at: string;
  leads: { company: string; stage: string } | null;
}

const STATUS_LABEL: Record<string, string> = { open: "Open", kept: "Kept", missed: "Missed", cancelled: "Cancelled" };
const STATUS_CLS: Record<string, string> = {
  open: "text-[#ecd39c]", kept: "text-emerald-400", missed: "text-[#F0544C]", cancelled: "text-white/30",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }) : "—";

/** How overdue, in whole days. Negative means still ahead of us. */
function daysOut(due: string): number {
  const a = Date.parse(`${due}T00:00:00Z`), b = Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function whenLabel(due: string): { text: string; cls: string } {
  const d = daysOut(due);
  if (d > 0) return { text: d === 1 ? "1 day late" : `${d} days late`, cls: "text-[#F0544C]" };
  if (d === 0) return { text: "Today", cls: "text-[#ecd39c]" };
  if (d === -1) return { text: "Tomorrow", cls: "text-white/60" };
  if (d >= -7) return { text: `In ${-d} days`, cls: "text-white/45" };
  return { text: `In ${-d} days`, cls: "text-white/30" };
}

export default function AdminSalesCommitments() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [partyFilter, setPartyFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("commitments")
      .select("id, lead_id, party, description, due_date, status, slip_count, original_due_date, completed_at, created_at, leads(company, stage)")
      .order("due_date", { ascending: true });
    if (error) toast({ title: "Couldn't load commitments", description: error.message, variant: "destructive" });
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (partyFilter !== "all" && r.party !== partyFilter) return false;
      if (q && !`${r.description} ${r.leads?.company ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter, partyFilter]);

  const COLUMNS: SortableColumn<Row>[] = [
    { id: "due", accessor: (r) => r.due_date, type: "date" },
    { id: "company", accessor: (r) => r.leads?.company ?? "", type: "text" },
    { id: "what", accessor: (r) => r.description, type: "text" },
    { id: "party", accessor: (r) => r.party, type: "text" },
    { id: "slipped", accessor: (r) => r.slip_count, type: "number" },
    { id: "status", accessor: (r) => r.status, type: "text" },
  ];
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Row>(filtered, COLUMNS, { key: "due", dir: "asc" });

  const open = rows.filter((r) => r.status === "open");
  const overdue = open.filter((r) => daysOut(r.due_date) > 0);
  const dueToday = open.filter((r) => daysOut(r.due_date) === 0);
  const mine = open.filter((r) => r.party === "us");

  async function update(r: Row, patch: { status?: string; due_date?: string }) {
    setBusy(r.id);
    const { error } = await supabase.rpc("sales_commitment_update", {
      p_id: r.id, p_status: patch.status ?? null, p_due_date: patch.due_date ?? null,
    });
    setBusy(null);
    if (error) { toast({ title: "Couldn't update", description: error.message, variant: "destructive" }); return; }
    await load();
    if (patch.due_date) {
      toast({ title: "Pushed", description: `Now due ${fmtDate(patch.due_date)}. That's a slip — it's counted.` });
    } else {
      toast({ title: patch.status === "kept" ? "Marked kept" : patch.status === "missed" ? "Marked missed" : "Cancelled" });
    }
  }

  function pushAWeek(r: Row) {
    const d = new Date(`${r.due_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    update(r, { due_date: d.toISOString().slice(0, 10) });
  }

  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <div className="mb-8">
        <Link to="/admin/sales" className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-[#ecd39c]">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />Sales
        </Link>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold text-[#ecd39c]">Commitments</span>
          </div>
          {!loading && (
            <div className="flex items-center gap-6 text-right">
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Overdue</p>
                <p className={`font-serif text-xl tabular-nums leading-none mt-1 ${overdue.length ? "text-[#F0544C]" : "text-strong"}`}>{overdue.length}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Due today</p>
                <p className={`font-serif text-xl tabular-nums leading-none mt-1 ${dueToday.length ? "text-[#ecd39c]" : "text-strong"}`}>{dueToday.length}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-white/35">On you</p>
                <p className="font-serif text-xl text-strong tabular-nums leading-none mt-1">{mine.length}</p>
              </div>
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-recessive">
          What was promised, by whom, and by when. Anything you or a client said would happen — the Director files these as you talk.
        </p>
      </div>

      <section className="ssr-zone mb-4">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Promises</h2></div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
        ) : (
          <>
            <TableToolbar className="mb-4">
              <TableSearch value={search} onChange={setSearch} placeholder="SEARCH COMMITMENTS" />
              <TableFilterSelect
                value={statusFilter} onChange={setStatusFilter}
                options={[
                  { value: "open", label: "OPEN" }, { value: "kept", label: "KEPT" },
                  { value: "missed", label: "MISSED" }, { value: "cancelled", label: "CANCELLED" },
                  { value: "all", label: "ALL" },
                ]}
              />
              <TableFilterSelect
                value={partyFilter} onChange={setPartyFilter} width="w-[150px]"
                options={[{ value: "all", label: "EVERYONE" }, { value: "us", label: "ON YOU" }, { value: "them", label: "ON THEM" }]}
              />
            </TableToolbar>

            {sortedRows.length === 0 ? (
              <div className="ssr-tile p-10 text-center text-sm text-recessive">
                {rows.length === 0
                  ? "Nothing promised yet. Tell the Director what you agreed on a call and it'll file it here."
                  : "Nothing matches those filters."}
              </div>
            ) : (
              <div className="ssr-tile overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <SortTh id="due" label="Due" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                      <SortTh id="company" label="Company" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                      <SortTh id="what" label="What" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                      <SortTh id="party" label="Whose" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                      <SortTh id="slipped" label="Slipped" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                      <SortTh id="status" label="Status" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                      <th className="px-4 py-3 text-right text-[9px] font-normal uppercase tracking-[0.2em] text-white/40">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => {
                      const when = whenLabel(r.due_date);
                      const isOpen = r.status === "open";
                      return (
                        <tr key={r.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-3 align-top">
                            <p className="text-sm text-strong tabular-nums">{fmtDate(r.due_date)}</p>
                            {isOpen && <p className={`mt-0.5 text-[11px] ${when.cls}`}>{when.text}</p>}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Link to="/admin/sales" className="text-sm text-strong hover:text-[#ecd39c]">
                              {r.leads?.company ?? "—"}
                            </Link>
                          </td>
                          <td className="max-w-[320px] px-4 py-3 align-top">
                            <p className="text-sm text-white/75">{r.description}</p>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`text-xs ${r.party === "us" ? "text-[#C9A96A]" : "text-white/45"}`}>
                              {r.party === "us" ? "You" : "Them"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            {r.slip_count > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs tabular-nums text-[#F0544C]" title={`Originally due ${fmtDate(r.original_due_date)}`}>
                                <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />{r.slip_count}×
                              </span>
                            ) : (
                              <span className="text-xs text-white/20">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`text-[10px] uppercase tracking-[0.16em] ${STATUS_CLS[r.status] ?? "text-white/40"}`}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">
                            {isOpen ? (
                              <div className="flex items-center justify-end gap-4">
                                <button disabled={busy === r.id} onClick={() => update(r, { status: "kept" })} title="Kept"
                                  className="text-white/35 hover:text-emerald-400 disabled:opacity-30"><Check className="h-3.5 w-3.5" strokeWidth={2} /></button>
                                <button disabled={busy === r.id} onClick={() => pushAWeek(r)} title="Push a week — counts as a slip"
                                  className="text-white/35 hover:text-[#ecd39c] disabled:opacity-30"><CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
                                <button disabled={busy === r.id} onClick={() => update(r, { status: "missed" })} title="Missed"
                                  className="text-white/35 hover:text-[#F0544C] disabled:opacity-30"><X className="h-3.5 w-3.5" strokeWidth={2} /></button>
                              </div>
                            ) : (
                              <p className="text-right text-[11px] text-white/25">
                                {r.completed_at ? fmtDate(r.completed_at.slice(0, 10)) : "—"}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </AdminLayout>
  );
}
