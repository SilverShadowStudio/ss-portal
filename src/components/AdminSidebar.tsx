import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileText,
  Kanban,
  Receipt,
  ShoppingBag,
  Sun,
  Moon,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  UploadCloud,
} from "lucide-react";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { SIDEBAR, TRANSITION } from "@/lib/design";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { icon: LayoutDashboard, path: "/admin", label: "Dashboard" },
  { icon: Kanban, path: "/admin/timeline", label: "Timeline", rotate: true },
  { icon: Users, path: "/admin/clients", label: "Clients" },
];

const bottomNavItems = [
  { icon: ShoppingBag, path: "/admin/orders", label: "Orders" },
  { icon: Receipt, path: "/admin/invoices", label: "Finance" },
  { icon: FileText, path: "/admin/documents", label: "Documents" },
  { icon: UploadCloud, path: "/admin/batch-upload", label: "Batch Upload" },
];

interface AdminSidebarProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function AdminSidebar({ expanded = false, onToggleExpand }: AdminSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<{ first_name: string | null; last_name: string | null; full_name: string | null; company: string | null } | null>(null);
  const newClientsCount = useNewClientsCount();

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name, company")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/auth");
  };

  const sidebarWidth = expanded ? "w-64" : "w-20";

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-300",
        expanded ? "items-start p-8" : "items-center py-6",
        sidebarWidth
      )}
    >
      {/* Logo */}
      <div className={cn(expanded ? "mb-6 px-4" : "mb-6")}>
        <a href="https://www.silvershadowstudio.com" target="_blank" rel="noopener noreferrer" className="block transition-smooth hover:opacity-80">
          {expanded ? (
            <img
              src="https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png"
              alt="Silvershadow Studio"
              className="h-6 w-auto object-contain"
              style={{ filter: theme === "dark" ? "brightness(0) invert(1)" : "brightness(0)" }}
            />
          ) : (
            <img src={ssIcon} alt="Silvershadow" className="h-6 w-6 shrink-0 brightness-0 dark:invert" />
          )}
        </a>
      </div>

      {/* Navigation */}
      <TooltipProvider delayDuration={0}>
        <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-2" : "items-center gap-1")}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== "/admin" && location.pathname.startsWith(item.path));
            const showBadge = item.path === "/admin/clients" && newClientsCount > 0;
            const badgeLabel = newClientsCount > 99 ? "99+" : String(newClientsCount);
            const link = (
              <div key={item.path} className="relative w-full">
                {isActive && !expanded && (
                  <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
                )}
                <Link
                  to={item.path}
                  className={cn(
                    "relative group flex items-center transition-all duration-300 ease-out whitespace-nowrap font-sans uppercase",
                    expanded
                      ? "w-full pl-5 pr-3 py-3.5"
                      : "h-11 w-12 justify-center mx-auto rounded-lg",
                    isActive
                      ? expanded
                        ? "text-[hsl(var(--gold))]"
                        : "text-gold"
                      : cn(
                          "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                          !expanded && "hover:bg-muted/40",
                        ),
                  )}
                  style={expanded ? { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 } : undefined}
                >
                  {expanded && isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]"
                    />
                  )}
                  {expanded ? (
                    <span className="flex flex-1 items-center justify-between gap-2">
                      <span>{item.label}</span>
                      {showBadge && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gold px-1.5 text-[10px] font-bold leading-none text-background">
                          {badgeLabel}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="relative shrink-0">
                      <item.icon
                        className={cn(
                          "shrink-0 h-5 w-5",
                          (item as any).rotate && "-rotate-90",
                          isActive && "text-gold",
                        )}
                        strokeWidth={1.5}
                      />
                      {showBadge && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold leading-none text-background ring-2 ring-sidebar">
                          {badgeLabel}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </div>
            );
            if (!expanded) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>
      </TooltipProvider>

      {/* Bottom nav items (above account) */}
      <TooltipProvider delayDuration={0}>
        <nav className={cn("flex flex-col", expanded ? "w-full space-y-2 pb-2" : "items-center gap-1 pb-2")}>
          {bottomNavItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== "/admin" && location.pathname.startsWith(item.path));
            const link = (
              <div key={item.path} className="relative w-full">
                {isActive && !expanded && (
                  <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
                )}
                <Link
                  to={item.path}
                  className={cn(
                    "relative group flex items-center transition-all duration-300 ease-out whitespace-nowrap font-sans uppercase",
                    expanded
                      ? "w-full pl-5 pr-3 py-3"
                      : "h-11 w-12 justify-center mx-auto rounded-lg",
                    isActive
                      ? expanded
                        ? "text-[hsl(var(--gold))]"
                        : "text-gold"
                      : cn(
                          "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                          !expanded && "hover:bg-muted/40",
                        ),
                  )}
                  style={expanded ? { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 } : undefined}
                >
                  {expanded && isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]"
                    />
                  )}
                  {expanded ? (
                    <span>{item.label}</span>
                  ) : (
                    <item.icon
                      className={cn("shrink-0 h-5 w-5", isActive && "text-gold")}
                      strokeWidth={1.5}
                    />
                  )}
                </Link>
              </div>
            );
            if (!expanded) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>
      </TooltipProvider>

      {/* Bottom actions — Compact / Theme / Log off */}
      <TooltipProvider delayDuration={0}>
        <div className={cn("flex flex-col", expanded ? "w-full pt-2" : "items-center pt-2 gap-1")}>
          <div
            aria-hidden
            className={cn("mb-3", expanded ? "mx-5" : "w-8")}
            style={{ height: 1, background: "hsl(var(--border) / 0.25)" }}
          />

          {/* Profile name — expanded only */}
          {expanded && (
            <div className="pl-5 pr-3 py-2 mb-1">
              <p className="text-[12px] font-medium text-foreground leading-tight" style={{ letterSpacing: "0.02em" }}>
                {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Admin"}
              </p>
              <p className="text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]/55 mt-1">
                Admin
              </p>
            </div>
          )}

          {/* Compact / Expand */}
          {expanded ? (
            <button
              onClick={onToggleExpand}
              className="w-full flex items-center pl-5 pr-3 py-3 font-sans uppercase text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
              style={{ fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 }}
            >
              <ChevronsLeft size={14} strokeWidth={1.5} className="mr-3 shrink-0" />
              Compact
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleExpand}
                  className="h-11 w-12 flex items-center justify-center mx-auto rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-muted/40 transition-colors"
                >
                  <ChevronsRight size={18} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">Expand</TooltipContent>
            </Tooltip>
          )}

          {/* Light / Dark mode */}
          {expanded ? (
            <button
              onClick={toggleTheme}
              className="w-full flex items-center pl-5 pr-3 py-3 font-sans uppercase text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
              style={{ fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 }}
            >
              {theme === "dark"
                ? <Sun size={14} strokeWidth={1.5} className="mr-3 shrink-0" />
                : <Moon size={14} strokeWidth={1.5} className="mr-3 shrink-0" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="h-11 w-12 flex items-center justify-center mx-auto rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-muted/40 transition-colors"
                >
                  {theme === "dark" ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Log off */}
          {expanded ? (
            <button
              onClick={handleSignOut}
              className="w-full flex items-center pl-5 pr-3 py-3 font-sans uppercase text-rose-500/70 hover:text-rose-500 transition-colors"
              style={{ fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 }}
            >
              <LogOut size={14} strokeWidth={1.5} className="mr-3 shrink-0" />
              Log off
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSignOut}
                  className="h-11 w-12 flex items-center justify-center mx-auto rounded-lg text-rose-500/60 hover:text-rose-500 hover:bg-muted/40 transition-colors"
                >
                  <LogOut size={18} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">Log off</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </aside>
  );
}
