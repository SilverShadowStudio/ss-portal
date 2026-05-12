import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { path: "/admin",                       label: "Dashboard", abbr: "DA" },
  { path: "/admin/timeline",              label: "Timeline",  abbr: "TL" },
  { path: "/admin/clients",               label: "Clients",   abbr: "CL" },
  { path: "/admin/production-tracker",    label: "Tracker",   abbr: "TR" },
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
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

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

  const accountItems: Array<{
    label: string;
    onClick: () => void;
    active?: boolean;
    separatorAfter?: boolean;
  }> = [
    { label: "Orders",       onClick: () => navigate("/admin/orders"),       active: location.pathname.startsWith("/admin/orders") },
    { label: "Finance",      onClick: () => navigate("/admin/invoices"),     active: location.pathname.startsWith("/admin/invoices") },
    { label: "Documents",    onClick: () => navigate("/admin/documents"),    active: location.pathname.startsWith("/admin/documents") },
    { label: "Batch Upload", onClick: () => navigate("/admin/batch-upload"), active: location.pathname.startsWith("/admin/batch-upload") },
    { label: "Settings",    onClick: () => navigate("/admin/settings"),     active: location.pathname.startsWith("/admin/settings"),     separatorAfter: true },
    { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.() },
    { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true },
    { label: "Log off",      onClick: handleSignOut },
  ];

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

      {/* Main navigation */}
      <TooltipProvider delayDuration={0}>
        <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-2" : "items-center gap-1 w-full")}>
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
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
                      ? expanded ? "text-[hsl(var(--gold))]" : "text-gold"
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
                    <span className="relative shrink-0 flex items-center justify-center">
                      <span className="text-[9px] font-medium uppercase tracking-[0.12em]">
                        {item.abbr}
                      </span>
                      {showBadge && (
                        <span className="absolute -right-3 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold leading-none text-background ring-2 ring-sidebar">
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
                    "relative pointer-events-auto transition-all duration-300 ease-out font-sans uppercase whitespace-nowrap text-left",
                    it.active
                      ? "translate-y-0 opacity-100 text-[hsl(var(--gold))]"
                      : cn(
                          "text-sidebar-foreground/50 hover:text-sidebar-foreground/80",
                          menuOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                        ),
                    "flex items-center w-full pl-5 pr-3 py-3.5",
                  )}
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.24em",
                    fontWeight: 500,
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
                      "pointer-events-none transition-all duration-300 ease-out",
                      menuOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
                    )}
                    style={{
                      height: 1,
                      margin: "2px 20px",
                      background: "hsl(var(--border) / 0.4)",
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
                    <p className="text-[12px] font-medium text-foreground leading-tight whitespace-normal break-words" style={{ letterSpacing: "0.02em" }}>
                      {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Admin"}
                    </p>
                    <p className="text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]/55 mt-1">Admin</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <p className="text-[9px] font-medium text-foreground/40 uppercase tracking-[0.12em] leading-tight text-center">
                      {profile?.first_name
                        ? `${profile.first_name[0]}${profile?.last_name?.[0] ?? ""}`.toUpperCase()
                        : "AD"}
                    </p>
                  </div>
                )}
              </button>
            </TooltipTrigger>
            {!expanded && (
              <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">
                Account
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </aside>
  );
}
