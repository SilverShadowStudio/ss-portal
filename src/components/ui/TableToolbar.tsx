// Shared table furniture — the studio standard for EVERY data table:
//   • TableToolbar  — the filter row (search + relevant filter selects)
//   • TableSearch   — underline search field (gold focus underline)
//   • TableFilterSelect — underline dropdown, same language
//   • SortTh        — sortable header cell for hand-rolled <table>s
// Pairs with useTableSort. Keep numbers right-aligned + tabular-nums.
import { Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/hooks/useTableSort";

export function TableToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-8", className)}>{children}</div>;
}

/** The clear affordance, portal-wide.
 *
 *  An 18px hairline cross in dark red. The stroke is 0.8 on a 24 viewBox so the
 *  drawn line stays the same 0.6px hairline it was at 9px — doubling the glyph
 *  without halving the stroke would have thickened it, which is the opposite of
 *  what was asked for.
 *
 *  Always mounted (never conditionally rendered) so it can fade rather than
 *  appear, and marked `peer` so the red underline in TableSearch can react to
 *  its hover without any JS. */
export function SearchClear({
  show, onClear, className, size = 18,
}: { show: boolean; onClear: () => void; className?: string; size?: number }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Clear search"
      aria-hidden={!show}
      onClick={onClear}
      className={cn(
        "peer flex shrink-0 items-center justify-center text-[#9E2B35] transition-all duration-200 ease-out",
        show ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
        className,
      )}
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={0.8 * (18 / size)}
           strokeLinecap="round" style={{ height: size, width: size }}>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function TableSearch({
  value, onChange, placeholder = "SEARCH", width = "w-[220px]",
}: { value: string; onChange: (v: string) => void; placeholder?: string; width?: string }) {
  return (
    <div className={cn("group relative flex items-center gap-2.5 pb-[7px]", width)}>
      <Search className="h-3.5 w-3.5 shrink-0 text-[#C9A96A]/55 transition-colors duration-300 group-focus-within:text-[#C9A96A]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }}
        placeholder={placeholder}
        className="w-full border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-0"
      />
      <SearchClear show={value.length > 0} onClear={() => onChange("")} />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
      {/* Gold arrives from the left on focus. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
      {/* Red arrives from the right when the cross is hovered — mirrored, and
          painted last so it sits over the gold. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-right scale-x-0 bg-[#9E2B35] transition-transform duration-500 ease-out peer-hover:scale-x-100" />
    </div>
  );
}

export function TableFilterSelect({
  value, onChange, options, width = "w-[160px]",
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; width?: string }) {
  return (
    <div className={cn("group relative pb-[7px]", width)}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-auto rounded-none border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 focus:ring-0 focus:ring-offset-0 [&>svg]:text-[#C9A96A]/60 [&>svg]:opacity-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
    </div>
  );
}

/** Sortable header cell for hand-rolled <table>s.
 *
 *  Column TITLES always sit left, portal-wide, whatever the column contains —
 *  the header is a label for the column, not a sample of its values. `align` is
 *  kept so existing call sites don't need editing, but it no longer moves the
 *  label; numeric CELLS stay right-aligned so their digits still line up. */
export function SortTh({
  id, label, activeKey, dir, onClick, align = "left",
}: { id: string; label: string; activeKey: string | null; dir: SortDir; onClick: (id: string) => void; align?: "left" | "right" | "center" }) {
  const active = activeKey === id;
  return (
    <th
      onClick={() => onClick(id)}
      className={cn(
        "px-4 py-3 text-[9px] uppercase tracking-[0.2em] font-normal cursor-pointer select-none transition-colors text-left",
        active ? "text-gold" : "text-white/40 hover:text-white/70",
      )}
    >
      {label}
      {active && <span aria-hidden className="ml-1">{dir === "asc" ? "▴" : "▾"}</span>}
    </th>
  );
}
