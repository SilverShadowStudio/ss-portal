import { useEffect, useState, useCallback } from "react";
import { ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/invoiceUtils";
import { VAT_RATE } from "@/lib/roundPricing";

interface ReservedRow {
  id: string;
  round_fee: number | null;
  reservation_expires_at: string | null;
  booking_group_id: string | null;
  scenes: { name: string | null; projects: { name: string | null } | null } | null;
}

interface Group {
  id: string;
  count: number;
  sceneName: string | null;
  projectName: string | null;
  net: number;
  gross: number;
  expiry: string | null;
}

/** Fires after a booking is reserved so the basket refreshes without a reload. */
export const RESERVATIONS_CHANGED_EVENT = "ss-reservations-changed";

export function ReservationBasket() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);

  const fetchReservations = useCallback(async () => {
    if (!user) { setGroups([]); return; }
    const { data } = await supabase
      .from("scene_rounds")
      .select("id, round_fee, reservation_expires_at, booking_group_id, scenes(name, projects(name))")
      .eq("status", "reserved");
    const rows = (data || []) as unknown as ReservedRow[];
    const byGroup = new Map<string, Group>();
    for (const r of rows) {
      const key = r.booking_group_id;
      if (!key) continue;
      const fee = Number(r.round_fee) || 0;
      const existing = byGroup.get(key);
      if (existing) {
        existing.count += 1;
        existing.net += fee;
        existing.gross = existing.net * (1 + VAT_RATE);
      } else {
        byGroup.set(key, {
          id: key,
          count: 1,
          sceneName: r.scenes?.name ?? null,
          projectName: r.scenes?.projects?.name ?? null,
          net: fee,
          gross: fee * (1 + VAT_RATE),
          expiry: r.reservation_expires_at,
        });
      }
    }
    setGroups(Array.from(byGroup.values()));
  }, [user]);

  useEffect(() => {
    fetchReservations();
    const onChange = () => fetchReservations();
    window.addEventListener(RESERVATIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RESERVATIONS_CHANGED_EVENT, onChange);
  }, [fetchReservations]);

  // Hidden entirely when there are no reservations.
  if (groups.length === 0) return null;

  const fmtExpiry = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="fixed right-16 top-6 z-40 flex h-10 w-10 items-center justify-center text-gold transition-smooth hover:opacity-80"
          aria-label="Reserved bookings"
        >
          <ShoppingBag className="h-4 w-4" strokeWidth={1.5} />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-sans text-[9px] font-semibold text-background">
            {groups.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="font-sans uppercase tracking-[0.18em] text-[10px] text-foreground/60">
          Reserved bookings
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.id} className="px-3 py-3 border-b border-border/30 last:border-b-0">
              <p className="font-serif text-foreground" style={{ fontSize: 13 }}>
                {g.count} round{g.count === 1 ? "" : "s"}
                {(g.projectName || g.sceneName) && (
                  <span className="text-foreground/60">
                    {"  ·  "}{[g.projectName, g.sceneName].filter(Boolean).join(" — ")}
                  </span>
                )}
              </p>
              <p className="mt-1 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                Reserved until {fmtExpiry(g.expiry)}
              </p>
              <p className="mt-1 font-sans tabular-nums text-foreground/70" style={{ fontSize: 11 }}>
                {formatCurrency(g.net, "GBP")} net · {formatCurrency(g.gross, "GBP")} inc VAT
              </p>
            </div>
          ))}
        </div>
        <div className="px-3 py-3">
          <p className="mb-2 font-sans text-foreground/45" style={{ fontSize: 10, lineHeight: 1.5 }}>
            Payment is required by the expiry date to confirm production.
          </p>
          <button
            type="button"
            disabled
            className="w-full bg-gold/40 px-4 py-2 font-sans uppercase text-[10px] tracking-[0.22em] text-background/80 cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            Pay now
          </button>
          <p className="mt-1.5 text-center font-sans uppercase text-foreground/35" style={{ fontSize: 8, letterSpacing: "0.18em" }}>
            Coming next
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
