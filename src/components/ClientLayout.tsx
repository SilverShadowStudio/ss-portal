import { ReactNode, useState, useEffect } from "react";
import { ClientSidebar } from "./ClientSidebar";
import { NotificationBell } from "./NotificationBell";
import { ReservationBasket } from "./client/ReservationBasket";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ClientLayoutProps {
  children: ReactNode;
  fullWidth?: boolean;
}

export function ClientLayout({ children, fullWidth = false }: ClientLayoutProps) {
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem("ss-sidebar-expanded");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("ss-sidebar-expanded", String(expanded));
  }, [expanded]);

  // Best-effort reservation-expiry sweep on portal load (non-blocking).
  useEffect(() => {
    supabase.functions.invoke("expire-reservations").catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ClientSidebar expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />
      <NotificationBell />
      <ReservationBasket />

      <main className={cn("min-h-screen transition-all duration-300", expanded ? "md:ml-64" : "md:ml-20")}>
        <div
          className={cn(
            // Desktop: standard padding
            "py-10",
            fullWidth ? "px-8" : "mx-auto max-w-6xl px-8",
            // Mobile: smaller padding, extra bottom for tab bar
            "md:py-10 py-8 px-5 md:px-8",
            "pb-24 md:pb-10",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
