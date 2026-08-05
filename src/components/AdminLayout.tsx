import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DirectorSheet, DirectorLauncher, useDirector, DIRECTOR_WIDTH } from "@/components/admin/sales/DirectorSheet";
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
  const { isOpen: directorOpen } = useDirector();

  return (
    <div className={cn("min-h-screen", panel ? "ssr-shell" : "bg-background")}>
      <AdminSidebar expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />
      <main
        className="min-h-screen"
        style={{
          // The Director takes the sidebar's place and the page steps aside for
          // it — both stay live and clickable, which an overlay can't do.
          marginLeft: directorOpen ? DIRECTOR_WIDTH + 12 : undefined,
          transition: "margin-left var(--duration-deliberate) var(--ease-signature)",
        }}
      >
      <div className={cn(directorOpen ? "" : expanded ? "ml-64" : "ml-20", "transition-all duration-300")}>
        {panel ? (
          <div className="ssr-panelwrap">
            <div className={cn("ssr-panel", panelClassName)}>{children}</div>
          </div>
        ) : (
          <div className={cn(noPadding ? "" : "py-10", fullWidth || noPadding ? "px-8" : "mx-auto max-w-7xl px-8", noPadding && "!p-0")}>
            {children}
          </div>
        )}
      </div>
      </main>

      {/* The Director, reachable from any admin page. Hidden on its own page —
          a launcher for the thing you're already looking at is just noise. */}
      {!onDirectorPage && <DirectorDock />}
    </div>
  );
}
