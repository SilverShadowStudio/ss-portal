import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DirectorSheet, DirectorLauncher, useDirector } from "@/components/admin/sales/DirectorSheet";
import { AdminSidebar } from "./AdminSidebar";
import { cn } from "@/lib/utils";

interface AdminLayoutProps {
  children: ReactNode;
  fullWidth?: boolean;
  noPadding?: boolean;
  /** Opt-in: render children inside the redesigned gradient panel (dark-only
   *  layered look). Pages that don't set this are rendered exactly as before. */
  panel?: boolean;
  /** Extra class on the .ssr-panel surface — e.g. "ssr-panel--client" to share
   *  the British-Racing-Green client theme on client-related admin pages. */
  panelClassName?: string;
}

function DirectorDock() {
  const { isOpen, open, close } = useDirector();
  return (
    <>
      <DirectorLauncher onClick={open} />
      <DirectorSheet open={isOpen} onClose={close} />
    </>
  );
}

export function AdminLayout({ children, fullWidth = false, noPadding = false, panel = false, panelClassName }: AdminLayoutProps) {
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem("ss-admin-sidebar-expanded");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("ss-admin-sidebar-expanded", String(expanded));
  }, [expanded]);

  const { pathname } = useLocation();
  const onDirectorPage = pathname.startsWith("/admin/sales/director");

  return (
    <div className={cn("min-h-screen", panel ? "ssr-shell" : "bg-background")}>
      <AdminSidebar expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />
      <main className={cn("min-h-screen transition-all duration-300", expanded ? "ml-64" : "ml-20")}>
        {panel ? (
          <div className="ssr-panelwrap">
            <div className={cn("ssr-panel", panelClassName)}>{children}</div>
          </div>
        ) : (
          <div className={cn(noPadding ? "" : "py-10", fullWidth || noPadding ? "px-8" : "mx-auto max-w-7xl px-8", noPadding && "!p-0")}>
            {children}
          </div>
        )}
      </main>

      {/* The Director, reachable from any admin page. Hidden on its own page —
          a launcher for the thing you're already looking at is just noise. */}
      {!onDirectorPage && <DirectorDock />}
    </div>
  );
}
