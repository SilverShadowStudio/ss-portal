import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/hooks/useTableSort";

interface SortableThProps {
  id: string;
  label: string;
  activeKey: string | null;
  dir: SortDir;
  onClick: (id: string) => void;
  className?: string;
}

/**
 * Column header for the finance tables. Click to sort asc; click again
 * to flip to desc. Small caret (▴/▾) marks the active column. Text goes
 * gold when active, foreground/40 otherwise.
 */
export function SortableTh({
  id,
  label,
  activeKey,
  dir,
  onClick,
  className,
}: SortableThProps) {
  const active = activeKey === id;
  return (
    <TableHead
      onClick={() => onClick(id)}
      className={cn(
        "text-[9px] uppercase tracking-[0.28em] font-normal cursor-pointer select-none transition-colors",
        active ? "text-gold" : "text-foreground/40 hover:text-standard",
        className,
      )}
    >
      {label}
      {active && (
        <span aria-hidden className="ml-1">
          {dir === "asc" ? "▴" : "▾"}
        </span>
      )}
    </TableHead>
  );
}
