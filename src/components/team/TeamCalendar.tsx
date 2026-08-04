import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format, getDaysInMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Check, X, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// ── Types mirroring the team-calendar edge function `get` response ────────────
type LeaveKind = "holiday" | "unavailable";
type LeaveStatus = "pending" | "approved" | "declined";
interface LeaveDay { id: string; date: string; kind: LeaveKind; fraction: number; status: LeaveStatus; note: string | null }
/** What a freelancer actually did on a day — from the Airtable day logs. */
interface WorkEntry { role: string; project: string; qty: number | null; unit: string }
interface CalData {
  accountId: string;
  accountName: string | null;
  employmentType: string | null;
  isAdmin: boolean;
  year: number;
  workStartDate: string | null;
  workPattern: "airtable" | "weekdays";
  workedDays: { date: string; fraction: number; entries?: WorkEntry[] }[];
  bankHolidays: { date: string; name: string }[];
  leave: LeaveDay[];
  allowance: number;
  taken: number;
  remaining: number;
}

const GOLD_BRIGHT = "#ecd39c";
// Day-type colours: holidays blue, worked days yellow. Both get the same tint
// strength so a holiday reads as a full day, not a gap.
const HOLIDAY = "#59AEF8";           // paid + bank holiday — blue, hsl(208, 92%, 66%)
const HOLIDAY_RGB = "89,174,248";
const WORKED = GOLD_BRIGHT;          // worked days — yellow
const WORKED_RGB = "236,211,156";    // #ecd39c
// TODAY. Deliberately outside the state palette (yellow worked / blue holiday /
// grey unavailable) so "today" never reads as a status — a warm crimson, clearly
// red rather than orange so it can't be mistaken for the gold. Defined ONCE here
// and used by both the employee and freelancer calendars (they're the same
// component), so changing this one line changes both.
const TODAY = "#F0544C";
const TODAY_RGB = "240,84,76";
// Earliest year any calendar shows. Nothing before this exists in Airtable.
const MIN_YEAR = 2026;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function fractionLabel(f: number): string {
  if (f >= 1) return "";
  if (f === 0.5) return "½";
  return String(f);
}

export function TeamCalendar({ accountId, className, onLoaded }: {
  accountId?: string;
  className?: string;
  /** Fires once the calendar knows who this is — lets the page word its header
   *  for an employee vs a freelancer. */
  onLoaded?: (info: { employmentType: string | null }) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<CalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Calendars start in 2026 — there's no worked-day history in Airtable before
  // that, so earlier years would only ever render empty. Land on the current
  // year (clamped to the floor), and let future years run on freely.
  const [year, setYear] = useState(() => Math.max(MIN_YEAR, new Date().getFullYear()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("team-calendar", {
        body: { action: "get", account_id: accountId, year },
      });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      setData(res as CalData);
      onLoaded?.({ employmentType: (res as CalData)?.employmentType ?? null });
    } catch (e) {
      toast({ title: "Could not load calendar", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [accountId, year, toast, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const workedMap = useMemo(() => {
    const m = new Map<string, number>();
    data?.workedDays.forEach((w) => m.set(w.date, w.fraction));
    return m;
  }, [data]);
  // What was done on each worked day, for the hover detail.
  const workDetailMap = useMemo(() => {
    const m = new Map<string, WorkEntry[]>();
    data?.workedDays.forEach((w) => { if (w.entries?.length) m.set(w.date, w.entries); });
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
  const employeePattern = data?.workPattern === "weekdays";
  // Only employees have paid holiday. Freelancers (modellers, scene managers,
  // photographers) have worked days + days they've marked not available.
  const isEmployee = data?.employmentType === "employee";
  // Round: summing fractions like 0.938 + 0.813 leaks float artefacts
  // (77.49000000000001). Two decimals, and drop a trailing ".00".
  const workedCount = useMemo(() => {
    const total = (data?.workedDays ?? []).reduce((s, w) => s + (Number(w.fraction) || 1), 0);
    return Number(total.toFixed(2)).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  }, [data?.workedDays]);
  const now = new Date();
  const todayIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

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
          {/* Paid holiday is an EMPLOYEE benefit. Freelancers get a worked-days
              summary instead — their calendar is worked days + days they've
              blocked out as not available. */}
          {isEmployee ? (
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
                <button className="grid h-6 w-6 place-items-center rounded bg-white/5 text-standard hover:bg-white/10 disabled:opacity-40" disabled={busy}
                  onClick={() => act({ action: "set-allowance", account_id: accountId, year, allowance: Math.max(0, data.allowance - 1) }, "Allowance updated")}
                  title="Reduce allowance"><Minus className="h-3 w-3" /></button>
                <span className="w-7 text-center tabular-nums text-standard text-sm">{data.allowance}</span>
                <button className="grid h-6 w-6 place-items-center rounded bg-gold/20 text-[#ecd39c] hover:bg-gold/30 disabled:opacity-40" disabled={busy}
                  onClick={() => act({ action: "set-allowance", account_id: accountId, year, allowance: data.allowance + 1 }, "Allowance updated")}
                  title="Add a day to their allowance"><Plus className="h-3 w-3" /></button>
              </div>
            )}
          </div>
          ) : (
            <div className="ssr-tile px-5 py-4">
              <p className="font-serif text-strong" style={{ fontSize: 22, lineHeight: 1 }}>{workedCount}</p>
              <p className="text-label mt-1">Days worked · {year}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent"
              disabled={year <= Math.max(MIN_YEAR, data?.workStartDate ? Number(data.workStartDate.slice(0, 4)) : MIN_YEAR)}
              onClick={() => setYear((y) => Math.max(MIN_YEAR, y - 1))}><ChevronLeft className="h-4 w-4" /></button>
            <span className="font-serif text-strong" style={{ fontSize: 18, minWidth: 56, textAlign: "center" }}>{year}</span>
            <button className="grid h-8 w-8 place-items-center rounded text-standard hover:bg-white/5" onClick={() => setYear((y) => y + 1)}><ChevronRight className="h-4 w-4" /></button>
            {year !== now.getFullYear() && (
              <button className="rounded px-2.5 py-1 text-xs text-recessive hover:bg-white/5 hover:text-standard" onClick={() => setYear(Math.max(MIN_YEAR, now.getFullYear()))}>This year</button>
            )}
          </div>
        </div>

        <Legend isEmployee={isEmployee} />
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
                    onClick={() => act({ action: "review", request_id: l.id, decision: "approved" }, "Approved")}><Check className="h-3 w-3" /> Approve</button>
                  <button className="inline-flex items-center gap-1 rounded bg-white/5 px-2.5 py-1 text-xs text-standard hover:bg-white/10 disabled:opacity-40" disabled={busy}
                    onClick={() => act({ action: "review", request_id: l.id, decision: "declined" }, "Declined")}><X className="h-3 w-3" /> Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year planner: 12 vertical month columns, day 01 on top */}
      <div className="ssr-zone">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-px w-6 bg-gold-muted" />
          <h2 className="text-label">Year planner · {year}</h2>
        </div>

        {loading && !data ? (
          <div className="ssr-tile grid place-items-center py-20"><BrandLoader /></div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2" style={{ minWidth: 12 * 104 }}>
              {MONTHS.map((monthName, m) => {
                const days = getDaysInMonth(new Date(year, m, 1));
                return (
                  <div key={m} className="flex-1" style={{ minWidth: 96 }}>
                    <div className="mb-1.5 text-center font-serif text-strong" style={{ fontSize: 13 }}>{monthName.slice(0, 3)}</div>
                    <div className="flex flex-col gap-[3px]">
                      {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                        const dateIso = isoOf(year, m, d);
                        const dow = new Date(year, m, d).getDay();
                        return (
                          <DayRow
                            key={d}
                            dayNum={d}
                            dowLabel={DOW[dow]}
                            weekend={dow === 0 || dow === 6}
                            fullDate={format(new Date(year, m, d), "EEEE d MMMM yyyy")}
                            isToday={dateIso === todayIso}
                            isPast={dateIso < todayIso}
                            beforeStart={data?.workStartDate ? dateIso < data.workStartDate : false}
                            bankHoliday={bankMap.get(dateIso)}
                            worked={workedMap.get(dateIso)}
                            workDetail={workDetailMap.get(dateIso)}
                            employeePattern={employeePattern}
                            isEmployee={isEmployee}
                            leave={leaveMap.get(dateIso)}
                            isAdmin={isAdmin}
                            busy={busy}
                            onSet={(kind, fraction) => act({ action: "request", days: [{ date: dateIso, kind, fraction }] }, isAdmin ? "Added" : "Requested")}
                            onCancel={(id) => act({ action: "cancel", request_id: id }, "Removed")}
                            onReview={(id, decision) => act({ action: "review", request_id: id, decision }, decision === "approved" ? "Approved" : "Declined")}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
      <circle cx="28" cy="28" r={R} fill="none" stroke={HOLIDAY} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 28 28)" />
    </svg>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend({ isEmployee }: { isEmployee: boolean }) {
  const items: { label: string; color: string; kind?: "dashed" | "hollow" }[] = [
    { label: "Worked", color: WORKED },
    // Paid holiday is employee-only — freelancers never see that key.
    ...(isEmployee ? [{ label: "Paid holiday", color: HOLIDAY }] : []),
    { label: "Not available", color: "#6b6b6b" },
    // Swatches match what the grid actually renders for each state.
    // Bank holidays are employee-only, so freelancers never see that key either.
    ...(isEmployee ? [{ label: "Bank holiday", color: HOLIDAY, kind: "hollow" as const }] : []),
    // Freelancers can never have a pending row: their only option is
    // "not available", which is approved on the spot.
    ...(isEmployee ? [{ label: "Pending", color: HOLIDAY, kind: "dashed" as const }] : []),
  ];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map(({ label, color, kind }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{
            background: kind ? "transparent" : color,
            border: kind ? `1px ${kind === "dashed" ? "dashed" : "solid"} ${color}` : "none",
          }} />
          <span className="text-xs text-recessive">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── One day row in a month column ─────────────────────────────────────────────
function DayRow(props: {
  dayNum: number; dowLabel: string; weekend: boolean; fullDate: string;
  isToday: boolean; isPast: boolean; beforeStart: boolean; bankHoliday?: string; worked?: number; workDetail?: WorkEntry[]; employeePattern: boolean; isEmployee: boolean;
  leave?: { holiday?: LeaveDay; unavailable?: LeaveDay };
  isAdmin: boolean; busy: boolean;
  onSet: (kind: LeaveKind, fraction: number) => void;
  onCancel: (id: string) => void;
  onReview: (id: string, decision: "approved" | "declined") => void;
}) {
  const { dayNum, dowLabel, weekend, fullDate, isToday, isPast, beforeStart, bankHoliday, worked, workDetail, employeePattern, leave, isAdmin, busy } = props;

  // Before this person joined the studio: an empty, non-interactive placeholder.
  if (beforeStart) {
    return (
      <div className="flex items-center rounded pl-1.5" style={{ height: 19, opacity: 0.18 }} title={`${fullDate} — before start date`}>
        <span className="tabular-nums" style={{ fontSize: 10.5, width: 15, color: "var(--text-recessive)" }}>{String(dayNum).padStart(2, "0")}</span>
      </div>
    );
  }

  const holiday = leave?.holiday;
  const unavailable = leave?.unavailable;
  const activeLeave = holiday ?? unavailable;

  const derivedWorked = worked != null
    ? worked
    : (employeePattern && isPast && !weekend && !bankHoliday && !(holiday?.status === "approved") && !(unavailable?.status === "approved"))
      ? 1 : undefined;

  // Defaults (a plain working/available day).
  let bg = "rgba(18,15,26,0.32)";
  let numColor = "var(--text-standard)";
  let sideLabel = dowLabel;
  let sideColor = weekend ? "var(--text-recessive)" : "var(--text-label)";
  let marker: ReactNode = null;
  let leftAccent = "transparent";
  let dashed = false;
  let noCell = false; // bank holiday → no tile, just the panel background behind it

  if (bankHoliday) {
    noCell = true; numColor = HOLIDAY; sideLabel = "Bank holiday"; sideColor = HOLIDAY;
  } else if (holiday?.status === "approved") {
    // Same treatment as a worked day (tinted fill + left accent + dot), in the
    // paid-holiday blue rather than gold — a holiday is a full day, not a gap.
    bg = `rgba(${HOLIDAY_RGB},0.24)`; leftAccent = `rgba(${HOLIDAY_RGB},0.9)`;
    marker = <span style={{ fontSize: 9, color: HOLIDAY }}>{holiday.fraction < 1 ? fractionLabel(holiday.fraction) : "●"}</span>;
  } else if (holiday?.status === "pending") {
    dashed = true; leftAccent = HOLIDAY;
    marker = <span style={{ fontSize: 9, color: HOLIDAY }}>{holiday.fraction < 1 ? fractionLabel(holiday.fraction) : "○"}</span>;
  } else if (unavailable?.status === "approved") {
    bg = "rgba(107,107,107,0.30)"; numColor = "#c2bcb2"; sideLabel = "Not available"; sideColor = "#a49d92";
  } else if (unavailable?.status === "pending") {
    bg = "rgba(107,107,107,0.16)"; dashed = true; leftAccent = "#8a8378"; numColor = "#c2bcb2"; sideLabel = "Not available"; sideColor = "#a49d92";
  } else if (derivedWorked != null && derivedWorked > 0) {
    // Dimmer fill than holidays — worked days are the common case and shouldn't
    // shout; the left accent + dot still carry the colour.
    bg = `rgba(${WORKED_RGB},0.10)`; leftAccent = `rgba(${WORKED_RGB},0.9)`;
    marker = <span style={{ fontSize: 9, color: WORKED }}>{derivedWorked < 1 ? (fractionLabel(derivedWorked) || derivedWorked) : "●"}</span>;
  } else if (weekend) {
    bg = "rgba(18,15,26,0.14)"; numColor = "var(--text-recessive)";
  }

  // Today takes the silver accent and a soft ring, and brightens its number —
  // legible whatever state the day is in, without pretending to be one.
  if (isToday) { leftAccent = TODAY; numColor = TODAY; }

  // A day that has already passed can't be set — neither a freelancer marking
  // themselves unavailable nor an employee booking time off. (Admins previously
  // bypassed this.) An admin can still open a past day that already has an entry,
  // to correct or remove it.
  const clickable = !bankHoliday && (!isPast || (isAdmin && !!activeLeave));

  const todayRing = isToday && !noCell ? `, inset 0 0 0 1px rgba(${TODAY_RGB},0.45)` : "";
  const boxShadow = noCell
    ? "none"
    : (dashed
        ? `inset 2px 0 0 ${leftAccent}, inset 0 0 0 1px ${holiday ? `rgba(${HOLIDAY_RGB},0.65)` : "rgba(138,131,120,0.45)"}`
        : leftAccent !== "transparent" ? `inset 2px 0 0 ${leftAccent}` : "inset 0 1px 0 rgba(255,255,255,0.03)"
      ) + todayRing;

  const row = (
    <div
      className={`flex items-center gap-1.5 rounded pl-1.5 pr-1 ${clickable ? "cursor-pointer hover:brightness-125" : ""}`}
      style={{ height: 19, background: noCell ? "transparent" : bg, boxShadow }}
      title={bankHoliday ? `${fullDate} · ${bankHoliday}` : fullDate}
    >
      <span className="tabular-nums shrink-0" style={{ fontSize: 10.5, width: 15, color: numColor }}>{String(dayNum).padStart(2, "0")}</span>
      <span className="truncate" style={{ fontSize: 8.5, color: sideColor, letterSpacing: sideLabel.length > 4 ? "0.01em" : "0.04em" }}>{sideLabel}</span>
      {marker && <span className="ml-auto flex items-center shrink-0">{marker}</span>}
    </div>
  );

  // Hover detail: what was actually logged that day (role + project + time).
  // Wraps the row so it works whether or not the day is clickable.
  const withHover = (node: ReactNode) =>
    workDetail?.length ? (
      <HoverCard openDelay={120} closeDelay={60}>
        <HoverCardTrigger asChild>{node}</HoverCardTrigger>
        <HoverCardContent align="start" className="w-60">
          <p className="mb-2 font-serif text-strong" style={{ fontSize: 13 }}>{fullDate}</p>
          <div className="space-y-2">
            {workDetail.map((e, i) => (
              <div key={i}>
                <p className="text-xs" style={{ color: WORKED }}>{e.role}</p>
                {e.project && <p className="text-xs text-standard truncate">{e.project}</p>}
                {e.qty != null && (
                  <p className="text-[11px] text-recessive">
                    {e.qty} {e.unit === "days" ? (e.qty === 1 ? "day" : "days") : "hrs"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>
    ) : node;

  if (!clickable) return withHover(row);

  return (
    <Popover>
      <PopoverTrigger asChild>{withHover(row)}</PopoverTrigger>
      <PopoverContent className="w-56 border-white/10 bg-[#1b1720] p-3" align="start">
        <p className="mb-2 font-serif text-strong" style={{ fontSize: 14 }}>{fullDate}</p>
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
            {/* Freelancers aren't requesting anything — they're letting us know. */}
            <p className="text-xs text-recessive mb-1">
              {isAdmin ? "Add for this person" : props.isEmployee ? "Request this day" : "Mark this day"}
            </p>
            {/* Paid holiday is employee-only; freelancers can only block days out. */}
            {props.isEmployee && (
              <>
                <button disabled={busy} className="w-full rounded bg-gold/20 px-2 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/30 text-left" onClick={() => props.onSet("holiday", 1)}>Paid holiday — full day</button>
                <button disabled={busy} className="w-full rounded bg-gold/10 px-2 py-1.5 text-xs text-[#ecd39c] hover:bg-gold/20 text-left" onClick={() => props.onSet("holiday", 0.5)}>Paid holiday — half day</button>
              </>
            )}
            <button disabled={busy} className="w-full rounded bg-white/5 px-2 py-1.5 text-xs text-standard hover:bg-white/10 text-left" onClick={() => props.onSet("unavailable", 1)}>Not available</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
