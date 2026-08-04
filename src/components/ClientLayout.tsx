import { ReactNode, useState, useEffect } from "react";
import { ClientSidebar } from "./ClientSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface ClientLayoutProps {
  children: ReactNode;
  fullWidth?: boolean;
  /** Opt-in: render children inside the redesigned gradient panel (three-tier
   *  Page → Section → Tile system), matching the admin portal. */
  panel?: boolean;
}

export function ClientLayout({ children, fullWidth = false, panel = false }: ClientLayoutProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem("ss-sidebar-expanded");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("ss-sidebar-expanded", String(expanded));
  }, [expanded]);

  // Best-effort reservation-expiry sweep on portal load (non-blocking).
  // Waits for the session: the function requires a signed-in caller, and
  // supabase-js restores the session asynchronously, so firing on bare mount
  // would 401 into the empty catch and skip the sweep for that page load.
  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke("expire-reservations").catch(() => {});
  }, [user]);

  return (
    <div className={cn("min-h-screen", panel ? "ssr-shell" : "bg-background")}>
      <ClientSidebar expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />

      <main className={cn("min-h-screen transition-all duration-300", expanded ? "md:ml-64" : "md:ml-20")}>
        {panel ? (
          <div className="ssr-panelwrap pb-24 md:pb-4">
            <div className="ssr-panel ssr-panel--client">{children}</div>
          </div>
        ) : (
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
        )}
      </main>
    </div>
  );
}
