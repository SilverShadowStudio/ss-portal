import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SB } from "@/lib/sidebarConstants";
import {
  LayoutDashboard, CalendarDays, Users2, UserPlus, Activity,
  FileText, Package, Landmark, FolderOpen, ScrollText, Receipt, TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem { path: string; label: string; Icon: LucideIcon }
interface NavSection { title?: string; items: NavItem[] }

// Sidebar structure — section headers are non-interactive eyebrow labels;
// items under each are always visible. Sections without a title sit as
// top-level rows (Clients).
const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { path: "/admin",          label: "Dashboard", Icon: LayoutDashboard },
      { path: "/admin/timeline", label: "Timeline",  Icon: CalendarDays    },
    ],
  },
  {
    items: [
      { path: "/admin/clients", label: "Clients", Icon: Users2 },
    ],
  },
  {
    title: "Production",
    items: [
      { path: "/admin/orders",              label: "Orders",  Icon: Package  },
      { path: "/admin/production-tracker",  label: "Tracker", Icon: Activity },
    ],
  },
  {
    title: "Operations",
    items: [
      { path: "/admin/team/contracts", label: "Contracts", Icon: FileText   },
      { path: "/admin/documents",      label: "Documents", Icon: FolderOpen },
      { path: "/admin/team",           label: "Team",      Icon: UserPlus   },
    ],
  },
  {
    title: "Finance",
    items: [
      { path: "/admin/quotes",           label: "Quotes",   Icon: ScrollText },
      { path: "/admin/invoices",         label: "Invoices", Icon: Landmark   },
      { path: "/admin/finance/expenses", label: "Expenses", Icon: Receipt    },
      { path: "/admin/finance/pnl",      label: "P&L",      Icon: TrendingUp },
    ],
  },
];

function isItemActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === "/admin") return currentPath === "/admin";
  return currentPath === itemPath || currentPath.startsWith(itemPath + "/");
}

interface AdminSidebarProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function AdminSidebar({ expanded = false, onToggleExpand }: AdminSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
  } | null>(null);
  const newClientsCount = useNewClientsCount();

  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setMenuOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), 5000);
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

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

  const sidebarWidth = expanded ? SB.widthExpanded : SB.widthCollapsed;

  const accountItems: Array<{
    label: string;
    onClick: () => void;
    active?: boolean;
    separatorAfter?: boolean;
  }> = [
    { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.() },
    { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true },
    { label: "Settings", onClick: () => navigate("/admin/settings"), active: location.pathname.startsWith("/admin/settings"), separatorAfter: true },
    { label: "Log off", onClick: handleSignOut },
  ];

  const renderItem = (item: NavItem, indented: boolean) => {
    const isActive = isItemActive(item.path, location.pathname);
    const showBadge = item.path === "/admin/clients" && newClientsCount > 0;
    const badgeLabel = newClientsCount > 99 ? "99+" : String(newClientsCount);

    const linkEl = (
      <Link
        to={item.path}
        className={cn(
          "relative group flex items-center transition-colors duration-quick whitespace-nowrap font-sans uppercase",
          expanded
            ? cn("w-full pr-3 py-3", indented ? "pl-8" : "pl-5")
            : "h-11 w-12 justify-center mx-auto rounded-lg",
          isActive
            ? expanded ? "text-[hsl(var(--gold))]" : "text-gold"
            : cn(
                "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                !expanded && "hover:bg-muted/40",
              ),
        )}
        style={expanded ? SB.navStyle : undefined}
      >
        {expanded && isActive && (
          <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
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
          <span className="relative shrink-0 flex items-center justify-center">
            <item.Icon style={{ width: 15, height: 15 }} strokeWidth={1.5} />
            {showBadge && (
              <span className="absolute -right-3 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold leading-none text-background ring-2 ring-sidebar">
                {badgeLabel}
              </span>
            )}
          </span>
        )}
      </Link>
    );

    return (
      <div key={item.path} className="relative w-full">
        {isActive && !expanded && (
          <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
        )}
        {!expanded ? (
          <Tooltip>
            <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={12} className={SB.tooltipClass}>{item.label}</TooltipContent>
          </Tooltip>
        ) : linkEl}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-standard",
        expanded ? "items-start p-8" : "items-center py-6",
        sidebarWidth
      )}
    >
      {/* Logo */}
      <div className={cn(expanded ? `${SB.logoMarginExpanded} px-4` : SB.logoMarginCollapsed)}>
        <a href="https://www.silvershadowstudio.com" target="_blank" rel="noopener noreferrer" className="block transition-smooth hover:opacity-80">
          {expanded ? (
            <img
              src="https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png"
              alt="Silvershadow Studio"
              className="h-7 w-auto object-contain"
              style={{ filter: theme === "dark" ? "brightness(0) invert(1)" : "brightness(0)" }}
            />
          ) : (
            <img src={ssIcon} alt="Silvershadow" className="h-6 w-6 shrink-0 brightness-0 dark:invert" />
          )}
        </a>
      </div>

      {/* Main navigation */}
      <TooltipProvider delayDuration={0}>
        <nav
          className={cn(
            "flex flex-1 flex-col overflow-y-auto",
            expanded ? "w-full" : "items-center w-full gap-1",
          )}
        >
          {SECTIONS.map((section, sIdx) => (
            <div
              key={section.title ?? `unsectioned-${sIdx}`}
              className={cn(
                "w-full",
                expanded
                  ? section.title ? "mt-6 first:mt-0" : "mt-3 first:mt-0"
                  : sIdx > 0 ? "mt-2" : "",
              )}
            >
              {expanded && section.title && (
                <p
                  className="px-5 mb-2 font-sans uppercase text-sidebar-foreground/45 select-none"
                  style={{ fontSize: 9, letterSpacing: "0.28em" }}
                >
                  {section.title}
                </p>
              )}
              <div className={cn(expanded ? "flex flex-col" : "flex flex-col items-center gap-1")}>
                {section.items.map((item) => renderItem(item, expanded && !!section.title))}
              </div>
            </div>
          ))}
        </nav>
      </TooltipProvider>

      {/* Account — hover to reveal menu */}
      <div
        className={cn("group/account pt-4 relative", "w-full")}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onFocus={openMenu}
        onBlur={scheduleClose}
      >
        {/* Animated stack above account row */}
        <div className="pointer-events-none absolute left-0 right-0 bottom-full overflow-hidden">
          <div className="flex flex-col">
            {accountItems.map((it, idx) => (
              <div key={it.label} className="contents">
                <button
                  type="button"
                  onClick={it.onClick}
                  title={expanded ? undefined : it.label}
                  className={cn(
                    "relative pointer-events-auto transition-all duration-standard font-sans uppercase whitespace-nowrap text-left",
                    it.active
                      ? "translate-y-0 opacity-100 text-[hsl(var(--gold))]"
                      : cn(
                          "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                          menuOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                        ),
                    "flex items-center w-full pl-5 pr-3 py-3.5",
                  )}
                  style={{
                    ...SB.menuItemStyle,
                    transitionDelay: `${(accountItems.length - 1 - idx) * 40}ms`,
                  }}
                >
                  {it.active && (
                    <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
                  )}
                  <span>{it.label}</span>
                </button>
                {it.separatorAfter && (
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none transition-all duration-standard",
                      menuOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
                    )}
                    style={{
                      ...SB.separatorStyle,
                      transitionDelay: `${(accountItems.length - 1 - idx) * 40}ms`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Account row */}
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center transition-all w-full",
                  expanded ? "gap-3 px-5 py-3" : "justify-center py-3",
                )}
              >
                {expanded ? (
                  <div className="text-left min-w-0">
                    <p className={SB.accountNameClass} style={SB.accountNameStyle}>
                      {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || user?.user_metadata?.full_name || "Admin"}
                    </p>
                    <p className={`text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]${SB.accountSubOpacity} mt-1`}>Admin</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <p className={SB.accountInitialsClass}>
                      {profile?.first_name
                        ? `${profile.first_name[0]}${profile?.last_name?.[0] ?? ""}`.toUpperCase()
                        : "AD"}
                    </p>
                  </div>
                )}
              </button>
            </TooltipTrigger>
            {!expanded && (
              <TooltipContent side="right" sideOffset={12} className={SB.tooltipClass}>
                Account
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </aside>
  );
}
