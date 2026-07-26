import { ReactNode, useState, useEffect } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { cn } from "@/lib/utils";

interface AdminLayoutProps {
  children: ReactNode;
  fullWidth?: boolean;
  noPadding?: boolean;
  /** Opt-in: render children inside the redesigned gradient panel (dark-only
   *  layered look). Pages that don't set this are rendered exactly as before. */
  panel?: boolean;
}

export function AdminLayout({ children, fullWidth = false, noPadding = false, panel = false }: AdminLayoutProps) {
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem("ss-admin-sidebar-expanded");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("ss-admin-sidebar-expanded", String(expanded));
  }, [expanded]);

  return (
    <div className={cn("min-h-screen", panel ? "ssr-shell" : "bg-background")}>
      <AdminSidebar expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />
      <main className={cn("min-h-screen transition-all duration-300", expanded ? "ml-64" : "ml-20")}>
        {panel ? (
          <div className="ssr-panelwrap">
            <div className="ssr-panel">{children}</div>
          </div>
        ) : (
          <div className={cn(noPadding ? "" : "py-10", fullWidth || noPadding ? "px-8" : "mx-auto max-w-7xl px-8", noPadding && "!p-0")}>
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
