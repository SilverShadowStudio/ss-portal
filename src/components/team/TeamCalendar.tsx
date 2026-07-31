import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameMonth, isWeekend, startOfMonth, startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Check, X, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ── Types mirroring the team-calendar edge function `get` response ────────────
type LeaveKind = "holiday" | "unavailable";
type LeaveStatus = "pending" | "approved" | "declined";
interface LeaveDay { id: string; date: string; kind: LeaveKind; fraction: number; status: LeaveStatus; note: string | null }
interface CalData {
  accountId: string;
  accountName: string | null;
  employmentType: string | null;
  isAdmin: boolean;
  year: number;
  workPattern: "airtable" | "weekdays";
  workedDays: { date: string; fraction: number }[];
  bankHolidays: { date: string; name: string }[];
  leave: LeaveDay[];
  allowance: number;
  taken: number;
  remaining: number;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const GOLD = "#d3b47c";
const GOLD_BRIGHT = "#ecd39c";

function fractionLabel(f: number): string {
  if (f >= 1) return "";
  if (f === 0.5) return "½";
  return String(f);
}

export function TeamCalendar({ accountId, className }: { accountId?: string; className?: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<CalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [allowanceDraft, setAllowanceDraft] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("team-calendar", {
        body: { action: "get", account_id: accountId, year },
      });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      setData(res as CalData);
    } catch (e) {
      toast({ title: "Could not load calendar", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [accountId, year, toast]);

  useEffect(() => { load(); }, [load]);

  // Keep the visible month inside the loaded year.
  useEffect(() => { setCursor((c) => (c.getFullYear() === year ? c : startOfMonth(new Date(year, 0, 1)))); }, [year]);

  const workedMap = useMemo(() => {
    const m = new Map<string, number>();
    data?.workedDays.forEach((w) => m.set(w.date, w.fraction));
    return m;
  }, [data]);
  const bankMap = useMemo(() => {
    const m = new Map<string, string>();
    data?.bankHolidays.forEach((b) => m.set(b.date, b.name));
    return m;
  }, [data]);
  const leaveMap = useMemo(() => {
    const m = new Map<string, { holiday?: LeaveDay; unavailable?: LeaveDay }>();
    data?.leave.forEach((l) => {
      const e = m.get(l.date) ?? {};
      e[l.kind] = l;
      m.set(l.date, e);
    });
    return m;
  }, [data]);

  const isAdmin = data?.isAdmin ?? false;
  const todayIso = iso(new Date());

  // Grid: full weeks (Mon–Sun) spanning the visible month.
  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  async function act(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("team-calendar", { body: { ...body, account_id: accountId } });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      if (okMsg) toast({ title: okMsg });
      await load();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.leave.filter((l) => l.status === "pending") ?? [];

  return (
    <div className={className}>
      {/* Header: name + allowance ring + year nav */}
      <div className="ssr-zone mb-4">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-px w-6 bg-gold-muted" />
          <h2 className="text-label">{accountId ? (data?.accountName ?? "Team member") : "My calendar"}</h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-6">
          {/* Allowance countdown */}
          <div className="ssr-tile flex items-center gap-5 px-5 py-4">
            <AllowanceRing remaining={data?.remaining ?? 0} allowance={data?.allowance ?? 20} />
            <div>
              <p className="font-serif text-strong" style={{ fontSize: 22, lineHeight: 1 }}>
                {data ? data.remaining : "—"}<span className="text-recessive" style={{ fontSize: 13 }}> / {data?.allowance ?? 20}</span>
              </p>
              <p className="text-label mt-1">Paid holiday left · {year}</p>
              {data && data.taken > 0 && (
                <p className="text-xs text-recessive mt-0.5">{data.taken} day{data.taken !== 1 ? "s" : ""} taken</p>
              )}
            </div>
            {isAdmin && data && (
              <div className="ml-2 flex items-center gap-1 border-l border-white/10 pl-4">
                <span className="text-xs text-recessive mr-1">Allowance</span>
                <button
                  className="grid h-6 w-6 place-items-center rounded bg-white/5 text-standard hover:bg-white/10 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => act({ action: "set-allowance", account_id: accountId, allowance: Math.max(0, (allowanceDraft ?? data.allowance) - 1) }, "Allowance updated")
                    .then(() => setAllowanceDraft(null))}
                  title="Reduce allowance"
                ><Minus className="h-3 w-3" /></button>
                <span className="w-7 text-center tabular-nums text-standard text-sm">{allowanceDraft ?? data.allowance}</span>
                <button
                  className="grid h-6 w-6 place-items-center rounded bg-gold/20 text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => act({ action: "set-allowance", account_id: accountId, allowance: (allowanceDraft ?? data.allowance) + 1 }, "Allowance updated")
                    .then(() => setAllowanceDraft(null))}
                  title="Add a day to their allowance"
                ><Plus className="h-3 w-3" /></button>
              </div>
            )}
          </div>

          {/* Year nav */}
          <div className="flex items-center gap-2">
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5" onClick={() => setYear((y) => y - 1)}><ChevronLeft className="h-4 w-4" /></button>
            <span className="font-serif text-strong" style={{ fontSize: 18, minWidth: 56, textAlign: "center" }}>{year}</span>
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5" onClick={() => setYear((y) => y + 1)}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <Legend />
      </div>

      {/* Admin: pending approvals */}
      {isAdmin && pending.length > 0 && (
        <div className="ssr-zone mb-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Pending requests · {pending.length}</h2>
          </div>
          <div className="flex flex-col gap-2">
            {pending.slice().sort((a, b) => a.date.localeCompare(b.date)).map((l) => (
              <div key={l.id} className="ssr-tile flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-standard">{format(new Date(l.date + "T00:00:00"), "EEE d MMM yyyy")}</span>
                  <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-recessive">
                    {l.kind === "holiday" ? `Holiday${l.fraction < 1 ? " · ½ day" : ""}` : "Not available"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button className="inline-flex items-center gap-1 rounded bg-gold/20 px-2.5 py-1 text-xs text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40" disabled={busy}
                    onClick={() => act({ action: "review", request_id: l.id, decision: "approved" }, "Approved")}>
                    <Check className="h-3 w-3" /> Approve
                  </button>
                  <button className="inline-flex items-center gap-1 rounded bg-white/5 px-2.5 py-1 text-xs text-standard hover:bg-white/10 disabled:opacity-40" disabled={busy}
                    onClick={() => act({ action: "review", request_id: l.id, decision: "declined" }, "Declined")}>
                    <X className="h-3 w-3" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month grid */}
      <div className="ssr-zone">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="font-serif text-strong" style={{ fontSize: 20 }}>{format(cursor, "MMMM")}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5" onClick={() => setCursor((c) => addMonths(c, -1))} disabled={cursor.getMonth() === 0}><ChevronLeft className="h-4 w-4" /></button>
            <button className="rounded px-2.5 py-1 text-xs text-recessive hover:bg-white/5 hover:text-standard" onClick={() => { const n = new Date(); setYear(n.getFullYear()); setCursor(startOfMonth(n)); }}>Today</button>
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5" onClick={() => setCursor((c) => addMonths(c, 1))} disabled={cursor.getMonth() === 11}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {loading && !data ? (
          <div className="ssr-tile grid place-items-center py-20"><BrandLoader /></div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="text-center text-label" style={{ fontSize: 10 }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {gridDays.map((d) => (
                <DayCell
                  key={iso(d)}
                  date={d}
                  inMonth={isSameMonth(d, cursor)}
                  isToday={iso(d) === todayIso}
                  isPast={iso(d) < todayIso}
                  weekend={isWeekend(d)}
                  bankHoliday={bankMap.get(iso(d))}
                  worked={workedMap.get(iso(d))}
                  employeePattern={data?.workPattern === "weekdays"}
                  leave={leaveMap.get(iso(d))}
                  isAdmin={isAdmin}
                  busy={busy}
                  onSet={(kind, fraction) => act({ action: "request", days: [{ date: iso(d), kind, fraction }] }, isAdmin ? "Added" : "Requested")}
                  onCancel={(id) => act({ action: "cancel", request_id: id }, "Removed")}
                  onReview={(id, decision) => act({ action: "review", request_id: id, decision }, decision === "approved" ? "Approved" : "Declined")}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Allowance ring ────────────────────────────────────────────────────────────
function AllowanceRing({ remaining, allowance }: { remaining: number; allowance: number }) {
  const pct = allowance > 0 ? Math.max(0, Math.min(1, remaining / allowance)) : 0;
  const R = 22, C = 2 * Math.PI * R;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      <circle cx="28" cy="28" r={R} fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 28 28)" />
    </svg>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  const items: [string, string][] = [
    ["Worked", GOLD],
    ["Paid holiday", GOLD_BRIGHT],
    ["Not available", "#6b6b6b"],
    ["Bank holiday", "#8a8378"],
    ["Pending", "transparent"],
  ];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{
            background: color === "transparent" ? "transparent" : color,
            border: color === "transparent" ? `1px dashed ${GOLD}` : "none",
            opacity: label === "Bank holiday" || label === "Not available" ? 0.6 : 1,
          }} />
          <span className="text-xs text-recessive">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Day cell ──────────────────────────────────────────────────────────────────
function DayCell(props: {
  date: Date; inMonth: boolean; isToday: boolean; isPast: boolean; weekend: boolean;
  bankHoliday?: string; worked?: number; employeePattern: boolean;
  leave?: { holiday?: LeaveDay; unavailable?: LeaveDay };
  isAdmin: boolean; busy: boolean;
  onSet: (kind: LeaveKind, fraction: number) => void;
  onCancel: (id: string) => void;
  onReview: (id: string, decision: "approved" | "declined") => void;
}) {
  const { date, inMonth, isToday, isPast, weekend, bankHoliday, worked, employeePattern, leave, isAdmin, busy } = props;
  const dayNum = date.getDate();
  const holiday = leave?.holiday;
  const unavailable = leave?.unavailable;
  const activeLeave = holiday ?? unavailable;

  // Derived worked fraction: freelancer → Airtable; employee → weekday if past &
  // not a bank holiday / approved absence.
  const derivedWorked = worked != null
    ? worked
    : (employeePattern && isPast && !weekend && !bankHoliday && !(holiday?.status === "approved") && !(unavailable?.status === "approved"))
      ? 1 : undefined;

  // Cell appearance.
  let bg = "rgba(18,15,26,0.35)";
  let ring = "transparent";
  let numColor = inMonth ? "var(--text-standard)" : "var(--text-recessive)";
  let strike = false;
  let cornerFrac = "";
  let dash = false;

  if (bankHoliday) { bg = "rgba(138,131,120,0.14)"; numColor = "#8a8378"; strike = true; }
  else if (holiday?.status === "approved") { bg = "rgba(211,180,124,0.26)"; numColor = "#f4e6c9"; cornerFrac = fractionLabel(holiday.fraction); }
  else if (holiday?.status === "pending") { dash = true; cornerFrac = fractionLabel(holiday.fraction); }
  else if (unavailable?.status === "approved") { bg = "rgba(107,107,107,0.20)"; numColor = "#9a938a"; strike = true; }
  else if (unavailable?.status === "pending") { dash = true; strike = true; }
  else if (derivedWorked != null && derivedWorked > 0) { bg = "rgba(211,180,124,0.10)"; }
  else if (weekend) { bg = "rgba(18,15,26,0.18)"; numColor = "var(--text-recessive)"; }

  if (isToday) ring = GOLD;

  const clickable = !bankHoliday && (isAdmin || !isPast);

  const cell = (
    <div
      className={`relative aspect-square rounded-lg p-1.5 transition-colors ${clickable ? "cursor-pointer hover:brightness-125" : ""} ${!inMonth ? "opacity-45" : ""}`}
      style={{ background: bg, boxShadow: dash ? `inset 0 0 0 1.5px ${GOLD}` : ring !== "transparent" ? `inset 0 0 0 1.5px ${ring}` : "inset 0 1px 0 rgba(255,255,255,0.03)", ...(dash ? { boxShadow: `inset 0 0 0 1.5px ${GOLD}`, borderStyle: "dashed" } : {}) }}
      title={bankHoliday ?? undefined}
    >
      <span className="tabular-nums" style={{ fontSize: 12, color: numColor, textDecoration: strike ? "line-through" : "none", opacity: strike ? 0.8 : 1 }}>{dayNum}</span>
      {/* worked fraction / marker */}
      {derivedWorked != null && derivedWorked > 0 && !holiday && !unavailable && !bankHoliday && (
        <span className="absolute bottom-1 right-1.5" style={{ fontSize: 9, color: GOLD }}>
          {derivedWorked < 1 ? (fractionLabel(derivedWorked) || derivedWorked) : "●"}
        </span>
      )}
      {cornerFrac && <span className="absolute bottom-1 right-1.5" style={{ fontSize: 9, color: GOLD_BRIGHT }}>{cornerFrac}</span>}
      {activeLeave?.status === "pending" && <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full" style={{ background: GOLD }} />}
    </div>
  );

  if (!clickable) return cell;

  return (
    <Popover>
      <PopoverTrigger asChild>{cell}</PopoverTrigger>
      <PopoverContent className="w-56 border-white/10 bg-[#1b1720] p-3" align="center">
        <p className="mb-2 font-serif text-strong" style={{ fontSize: 14 }}>{format(date, "EEEE d MMMM")}</p>

        {activeLeave ? (
          <div className="space-y-2">
            <p className="text-xs text-recessive">
              {activeLeave.kind === "holiday" ? `Paid holiday${activeLeave.fraction < 1 ? " · half day" : ""}` : "Marked not available"}
              {" · "}
              <span className={activeLeave.status === "approved" ? "text-[#ecd39c]" : activeLeave.status === "declined" ? "text-rose-400" : "text-standard"}>{activeLeave.status}</span>
            </p>
            {isAdmin && activeLeave.status === "pending" && (
              <div className="flex gap-1.5">
                <button disabled={busy} className="flex-1 rounded bg-gold/20 px-2 py-1 text-xs text-[#ecd39c] hover:bg-gold/30" onClick={() => props.onReview(activeLeave.id, "approved")}>Approve</button>
                <button disabled={busy} className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-standard hover:bg-white/10" onClick={() => props.onReview(activeLeave.id, "declined")}>Decline</button>
              </div>
            )}
            <button disabled={busy} className="w-full rounded bg-white/5 px-2 py-1 text-xs text-standard hover:bg-white/10" onClick={() => props.onCancel(activeLeave.id)}>
              {isAdmin ? "Remove" : "Cancel request"}
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-recessive mb-1">{isAdmin ? "Add for this person" : "Request this day"}</p>
            <button disabled={busy} className="w-full rounded bg-gold/20 px-2 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/30 text-left" onClick={() => props.onSet("holiday", 1)}>Paid holiday — full day</button>
            <button disabled={busy} className="w-full rounded bg-gold/10 px-2 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/20 text-left" onClick={() => props.onSet("holiday", 0.5)}>Paid holiday — half day</button>
            <button disabled={busy} className="w-full rounded bg-white/5 px-2 py-1.5 text-xs text-standard hover:bg-white/10 text-left" onClick={() => props.onSet("unavailable", 1)}>Not available</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
