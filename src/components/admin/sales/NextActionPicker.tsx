import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// The follow-up date picker on a lead.
//
// Built rather than borrowed: the grid is the whole surface, so it wears the
// portal's own language — gold for what's chosen, the same green that marks
// today everywhere else, and weekends recessive because a follow-up call is a
// weekday act.

const GREEN = "#8FD9A8";
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => iso(new Date());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Monday-first grid of whole weeks covering the month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;          // Sunday(0) → 6
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  /** Rendered as the trigger — the date as it already appears in the row. */
  children: React.ReactNode;
  disabled?: boolean;
}

export function NextActionPicker({ value, onChange, children, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const anchor = value ? new Date(`${value}T00:00:00`) : new Date();
  const [cursor, setCursor] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const today = todayISO();

  function pick(d: Date) {
    onChange(iso(d));
    setOpen(false);
  }

  function jump(days: number) {
    const d = addDays(new Date(), days);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    pick(d);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Reopen on the month that's actually set, not wherever it was left.
        if (o) {
          const a = value ? new Date(`${value}T00:00:00`) : new Date();
          setCursor(new Date(a.getFullYear(), a.getMonth(), 1));
        }
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="rounded-sm text-left transition-colors hover:text-[#ecd39c] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#C9A96A]/50"
          title="Set the next chase"
        >
          {children}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[286px] rounded-lg border-[#C9A96A]/20 bg-[#1e1a22] p-0 shadow-2xl"
      >
        {/* Month bar */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2.5">
          <button
            type="button" aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-white/40 hover:bg-white/[0.06] hover:text-[#ecd39c]"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <p className="text-[11px] uppercase tracking-[0.18em] text-strong">
            {MONTHS[cursor.getMonth()]} <span className="text-white/40">{cursor.getFullYear()}</span>
          </p>
          <button
            type="button" aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-white/40 hover:bg-white/[0.06] hover:text-[#ecd39c]"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-3 pb-2 pt-3">
          <div className="grid grid-cols-7 gap-y-1">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="pb-1 text-center text-[9px] uppercase tracking-[0.16em] text-white/25">{w}</div>
            ))}

            {days.map((d) => {
              const k = iso(d);
              const outside = d.getMonth() !== cursor.getMonth();
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const selected = value === k;
              const isToday = k === today;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(d)}
                  className="flex h-8 items-center justify-center"
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors ${
                      selected
                        ? "bg-[#C9A96A] font-medium text-[#1a1013]"
                        : outside
                        ? "text-white/15 hover:bg-white/[0.05] hover:text-white/40"
                        : weekend
                        ? "text-white/30 hover:bg-white/[0.06] hover:text-white/70"
                        : "text-white/75 hover:bg-white/[0.08] hover:text-[#ecd39c]"
                    }`}
                    // Today is ringed, never filled — the fill means "chosen",
                    // and today is a fact about the calendar, not a choice.
                    style={!selected && isToday ? { boxShadow: `inset 0 0 0 1px ${GREEN}`, color: GREEN } : undefined}
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* The shortcuts that cover most follow-ups, so the grid is the exception. */}
        <div className="flex items-center gap-4 border-t border-white/[0.07] px-3 py-2.5">
          <button type="button" onClick={() => jump(0)}
            className="text-[10px] uppercase tracking-[0.14em]" style={{ color: GREEN }}>Today</button>
          <button type="button" onClick={() => jump(1)}
            className="text-[10px] uppercase tracking-[0.14em] text-white/45 hover:text-[#ecd39c]">Tomorrow</button>
          <button type="button" onClick={() => jump(7)}
            className="text-[10px] uppercase tracking-[0.14em] text-white/45 hover:text-[#ecd39c]">+1 week</button>
          {value && (
            <button type="button" onClick={() => { onChange(null); setOpen(false); }}
              className="ml-auto text-[10px] uppercase tracking-[0.14em] text-white/30 hover:text-[#F0544C]">Clear</button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
