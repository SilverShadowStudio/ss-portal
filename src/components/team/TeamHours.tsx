// Hourly work — what a member paid by the hour logs, and what an admin sees of
// it. One component for both sides, like TeamCalendar: the member gets her
// week, a form and her month; an admin also gets the weekly hours (only an
// admin sees the control) and the extra hours waiting for a decision.
//
// Everything goes through team-calendar (hours-* actions): the weekly split,
// the Airtable write and the admin email live there, not here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, Minus, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Status = "approved" | "pending" | "declined";
interface Entry {
  id: string; work_date: string; hours: number; note: string | null; status: Status;
  airtable_record_id?: string | null; airtable_error?: string | null;
}
interface HoursData {
  setup: boolean; isAdmin: boolean; accountName: string | null;
  weekly_hours: number; hourly_rate: number | null;
  week: { from: string; to: string }; month: string;
  entries: Entry[]; pending: Entry[];
}

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const h = (n: number) => `${Math.round(n * 100) / 100} h`;
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const today = () => format(new Date(), "yyyy-MM-dd");

function weekOf(iso: string) {
  const x = d(iso); const dow = (x.getDay() + 6) % 7;
  const mon = new Date(x); mon.setDate(x.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: format(mon, "yyyy-MM-dd"), to: format(sun, "yyyy-MM-dd") };
}

function Ring({ used, of }: { used: number; of: number }) {
  const pct = of > 0 ? Math.min(100, (used / of) * 100) : 0;
  return (
    <div className="h-[46px] w-[46px] shrink-0 rounded-full"
      style={{
        background: `conic-gradient(#C9A96A 0 ${pct}%, rgba(255,255,255,0.1) 0)`,
        WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.5px))",
        mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.5px))",
      }} />
  );
}

function Chip({ e }: { e: Entry }) {
  if (e.status === "pending") return <span className="rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] bg-[#c98a4a]/20 text-[#e8b98a]">Awaiting approval</span>;
  if (e.status === "declined") return <span className="rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] bg-white/5 text-white/40">Declined</span>;
  if (e.airtable_record_id) return <span className="rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] bg-gold/15 text-[#ecd39c]">In Airtable</span>;
  return <span title={e.airtable_error ?? "It'll be sent shortly"} className="rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] bg-white/5 text-white/50">Not in Airtable yet</span>;
}

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ssr-zone mb-4">
      <div className="mb-4 flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">{title}</h2></div>
      {children}
    </div>
  );
}

export function TeamHours({ accountId, className }: { accountId?: string; className?: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<HoursData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: today(), hours: "", note: "" });
  const [rate, setRate] = useState("");

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke("team-calendar", { body: { ...body, ...(accountId ? { account_id: accountId } : {}) } });
    if (error) {
      // A 4xx carries the real reason in its body; invoke() only says "non-2xx".
      const ctx = (error as { context?: Response }).context;
      const detail = ctx && typeof ctx.json === "function" ? await ctx.json().then((j: { error?: string }) => j?.error).catch(() => null) : null;
      throw new Error(detail || error.message);
    }
    const msg = (res as { error?: string } | null)?.error;
    if (msg && (res as { setup?: boolean }).setup !== false) throw new Error(msg);
    return res as Record<string, unknown>;
  }, [accountId]);

  const load = useCallback(async () => {
    try {
      const res = await call({ action: "hours-get" });
      setData(res as unknown as HoursData);
      setRate(res.hourly_rate != null ? String(res.hourly_rate) : "");
    } catch (e) {
      toast({ title: "Couldn't load hours", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [call, toast]);
  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try { const r = await call(body); if (ok) toast({ title: ok }); await load(); return r; }
    catch (e) { toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" }); return null; }
    finally { setBusy(false); }
  };

  const entries = data?.entries ?? [];
  const sumWeek = (wk: { from: string; to: string }) =>
    entries.filter((e) => e.work_date >= wk.from && e.work_date <= wk.to && e.status !== "declined").reduce((t, e) => t + Number(e.hours), 0);
  const weekUsed = data ? sumWeek(data.week) : 0;
  const weekEntries = data ? entries.filter((e) => e.work_date >= data.week.from && e.work_date <= data.week.to) : [];

  // What the member is about to log does to that week — said before she saves.
  const preview = useMemo(() => {
    const n = Number(form.hours);
    if (!data || data.isAdmin || !(n > 0) || !form.date) return null;
    const room = Math.max(0, data.weekly_hours - sumWeek(weekOf(form.date)));
    const over = Math.max(0, Math.round((n - room) * 100) / 100);
    return over > 0 ? { within: Math.round((n - over) * 100) / 100, over } : null;
  }, [form, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthEntries = data ? entries.filter((e) => e.work_date.startsWith(data.month)) : [];
  const approved = monthEntries.filter((e) => e.status === "approved").reduce((t, e) => t + Number(e.hours), 0);
  const awaiting = monthEntries.filter((e) => e.status === "pending").reduce((t, e) => t + Number(e.hours), 0);
  const monthDate = data ? d(`${data.month}-01`) : new Date();
  const invoiceDay = format(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1), "d MMM");

  if (loading) return <div className={className}><div className="ssr-zone py-10 text-center text-sm text-recessive">Loading hours…</div></div>;

  // An admin can switch hourly work on; a member without it never gets here.
  if (!data?.setup) {
    if (!accountId) return null;
    return (
      <div className={className}>
        <Zone title="Hours">
          <div className="ssr-tile flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <p className="text-sm text-recessive">Not paid by the hour. Set it up and they get an Hours page to log their time.</p>
            <button disabled={busy} onClick={() => act({ action: "hours-settings", weekly_hours: 8 }, "Hours set up — 8 h a week")}
              className="rounded bg-gold/20 px-3 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40">Set up hourly work · 8 h a week</button>
          </div>
        </Zone>
      </div>
    );
  }

  const left = Math.max(0, data.weekly_hours - weekUsed);
  return (
    <div className={className}>
      <Zone title={`${accountId ? "Hours · this week" : "This week"} · ${format(d(data.week.from), "EEE d")} – ${format(d(data.week.to), "EEE d MMM")}`}>
        <div className="ssr-tile flex flex-wrap items-center gap-5 px-5 py-4">
          <Ring used={weekUsed} of={data.weekly_hours} />
          <div>
            <p className="font-serif text-strong" style={{ fontSize: 22, lineHeight: 1 }}>
              {Math.round(weekUsed * 100) / 100}<span className="text-recessive" style={{ fontSize: 13 }}> / {h(data.weekly_hours)}</span>
            </p>
            <p className="text-label mt-1">{left > 0 ? `${h(left)} left this week` : "Weekly hours reached"}</p>
          </div>
          {data.isAdmin && (
            <div className="ml-auto flex flex-wrap items-center gap-4 border-l border-white/10 pl-4">
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-recessive">Weekly hours</span>
                <button className="grid h-6 w-6 place-items-center rounded bg-white/5 text-standard hover:bg-white/10 disabled:opacity-40" disabled={busy || data.weekly_hours <= 0}
                  onClick={() => act({ action: "hours-settings", weekly_hours: Math.max(0, data.weekly_hours - 1) }, "Weekly hours updated")} title="One hour fewer"><Minus className="h-3 w-3" /></button>
                <span className="w-7 text-center text-sm tabular-nums text-standard">{data.weekly_hours}</span>
                <button className="grid h-6 w-6 place-items-center rounded bg-gold/20 text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40" disabled={busy}
                  onClick={() => act({ action: "hours-settings", weekly_hours: data.weekly_hours + 1 }, "Weekly hours updated")} title="One hour more"><Plus className="h-3 w-3" /></button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-recessive">£
                <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
                  onBlur={() => { const r = rate === "" ? null : Number(rate); if (r !== data.hourly_rate) act({ action: "hours-settings", hourly_rate: r }, "Rate updated"); }}
                  className="w-14 rounded border border-white/10 bg-black/25 px-1.5 py-0.5 text-sm tabular-nums text-standard focus:outline-none focus:border-[#C9A96A]/50" placeholder="18" />
                / h</label>
            </div>
          )}
        </div>
        {data.isAdmin && <p className="mt-2.5 text-[9px] uppercase tracking-[0.16em] text-[#ecd39c]/80">Only you see and change the weekly hours and rate · hours above them come to you</p>}

        {weekEntries.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {weekEntries.map((e) => (
              <div key={e.id} className="ssr-tile flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-recessive">{format(d(e.work_date), "EEE d MMM")}</span>
                <span className="w-12 shrink-0 tabular-nums text-strong">{h(Number(e.hours))}</span>
                <span className="min-w-0 flex-1 truncate text-standard" title={e.note ?? ""}>{e.note || "—"}</span>
                <Chip e={e} />
                {(e.status === "pending" || data.isAdmin) && (
                  <button disabled={busy} title="Remove this entry" onClick={() => act({ action: "hours-cancel", entry_id: e.id }, "Removed")}
                    className="text-white/25 hover:text-[#F0544C] disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </Zone>

      {!data.isAdmin && (
        <Zone title="Log hours">
          <div className="ssr-tile grid gap-3 px-4 py-4 sm:grid-cols-[150px_100px_1fr]">
            <label className="flex flex-col gap-1.5"><span className="text-[9px] uppercase tracking-[0.18em] text-white/40">Date</span>
              <input type="date" max={today()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="h-9 rounded-md border border-white/10 bg-black/25 px-2.5 text-sm text-standard focus:outline-none focus:border-[#C9A96A]/50" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-[9px] uppercase tracking-[0.18em] text-white/40">Hours</span>
              <input type="number" min={0.25} max={24} step={0.25} value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                className="h-9 rounded-md border border-white/10 bg-black/25 px-2.5 text-sm tabular-nums text-standard focus:outline-none focus:border-[#C9A96A]/50" placeholder="2.5" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-[9px] uppercase tracking-[0.18em] text-white/40">What you did</span>
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={500}
                className="h-9 rounded-md border border-white/10 bg-black/25 px-2.5 text-sm text-standard focus:outline-none focus:border-[#C9A96A]/50" placeholder="Outreach to 12 practices, 2 meetings booked" /></label>
            <div className="flex items-center justify-between gap-4 sm:col-span-3">
              <span className="text-xs leading-relaxed text-[#e8b98a]">
                {preview && (preview.within > 0
                  ? `This goes over your ${h(data.weekly_hours)} that week: ${h(preview.within)} go through, the other ${h(preview.over)} go to Fred for approval.`
                  : `Your ${h(data.weekly_hours)} that week are used: these ${h(preview.over)} go to Fred for approval.`)}
              </span>
              <button disabled={busy || !(Number(form.hours) > 0) || !form.date}
                onClick={async () => { const r = await act({ action: "hours-log", date: form.date, hours: Number(form.hours), note: form.note }, "Hours logged"); if (r) setForm({ date: today(), hours: "", note: "" }); }}
                className="h-9 shrink-0 rounded-md bg-gold/20 px-4 text-[10px] uppercase tracking-[0.2em] text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40">Log hours</button>
            </div>
          </div>
        </Zone>
      )}

      {data.isAdmin && data.pending.length > 0 && (
        <Zone title={`Pending requests · ${data.pending.length}`}>
          <div className="flex flex-col gap-2">
            {data.pending.map((e) => (
              <div key={e.id} className="ssr-tile flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-standard">{format(d(e.work_date), "EEE d MMM yyyy")} · <span className="text-[#e8b98a]">{h(Number(e.hours))} over the week</span></p>
                  {e.note && <p className="truncate text-xs text-recessive">“{e.note}”</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button className="inline-flex items-center gap-1 rounded bg-gold/20 px-2.5 py-1 text-xs text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40" disabled={busy}
                    onClick={() => act({ action: "hours-review", entry_id: e.id, decision: "approved" }, "Approved")}><Check className="h-3 w-3" /> Approve</button>
                  <button className="inline-flex items-center gap-1 rounded bg-white/5 px-2.5 py-1 text-xs text-standard hover:bg-white/10 disabled:opacity-40" disabled={busy}
                    onClick={() => act({ action: "hours-review", entry_id: e.id, decision: "declined" }, "Declined")}><X className="h-3 w-3" /> Decline</button>
                </div>
              </div>
            ))}
          </div>
        </Zone>
      )}

      <Zone title={`${format(monthDate, "MMMM")} · invoiced on ${invoiceDay}`}>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="ssr-tile px-4 py-3.5"><p className="font-serif text-strong" style={{ fontSize: 19 }}>{h(approved)}</p><p className="text-label mt-1.5">Approved</p></div>
          <div className="ssr-tile px-4 py-3.5"><p className="font-serif text-strong" style={{ fontSize: 19 }}>{h(awaiting)}</p><p className="text-label mt-1.5">{data.isAdmin ? "Awaiting you" : "Awaiting approval"}</p></div>
          <div className="ssr-tile px-4 py-3.5"><p className="font-serif text-strong" style={{ fontSize: 19 }}>{data.hourly_rate != null ? money(approved * data.hourly_rate) : "—"}</p>
            <p className="text-label mt-1.5">{data.hourly_rate != null ? `At ${money(data.hourly_rate)} / h` : "Rate not set"}</p></div>
        </div>
      </Zone>
    </div>
  );
}
