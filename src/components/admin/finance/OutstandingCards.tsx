import { formatCurrency } from "@/lib/finance";
import { cn } from "@/lib/utils";

// Muted, dark-theme-friendly semantic dots (kept subtle against the gold palette).
const DOT_POSITIVE = "bg-[#84b594]"; // sage — money owed to you / net in your favour
const DOT_NEGATIVE = "bg-[#c98a6a]"; // soft amber-red — money you owe / net against you
const DOT_NEUTRAL = "bg-foreground/30";

interface OutstandingCardsProps {
  /** Accounts receivable — owed to you. */
  receivable: number;
  /** Accounts payable — you owe. */
  payable: number;
}

export function OutstandingCards({ receivable, payable }: OutstandingCardsProps) {
  const net = receivable - payable;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card title="Owed to you" sub="Accounts receivable" value={receivable} dot={DOT_POSITIVE} />
      <Card title="You owe" sub="Accounts payable" value={payable} dot={DOT_NEGATIVE} />
      <Card
        title="Net position"
        sub="Receivable − payable"
        value={net}
        dot={net > 0.005 ? DOT_POSITIVE : net < -0.005 ? DOT_NEGATIVE : DOT_NEUTRAL}
      />
    </div>
  );
}

function Card({
  title,
  sub,
  value,
  dot,
}: {
  title: string;
  sub: string;
  value: number;
  dot: string;
}) {
  const zero = Math.abs(value) < 0.005;
  return (
    <div className="ssr-tile p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{title}</p>
      </div>
      <p
        className={cn(
          "ssr-figure",
          zero ? "text-recessive" : "text-strong",
        )}
      >
        {formatCurrency(value)}
      </p>
      <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-foreground/30">{sub}</p>
    </div>
  );
}
