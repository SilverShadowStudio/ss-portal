import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = { path: string; label: string; abbr: string };

const PARTNERSHIP_NAV: NavItem[] = [
  { path: "/timeline",  label: "Timeline",   abbr: "TL" },
  { path: "/delivery",  label: "Deliveries", abbr: "DL" },
];

const PROJECT_NAV: NavItem[] = [
  { path: "/portfolio", label: "Portfolio",  abbr: "PO" },
];

interface ClientSidebarProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function ClientSidebar({ expanded = true, onToggleExpand }: ClientSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut, accountType } = useAuth();
  const navItems = accountType === 'project' ? PROJECT_NAV : PARTNERSHIP_NAV;
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
  } | null>(null);

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

  const sidebarWidth = expanded ? "w-[220px]" : "w-20";

  const isActive = (path: string) =>
    location.pathname === path || (path !== "/" && location.pathname.startsWith(path));

  // ── Account hover menu items ───────────────────────────────────────────────
  const accountItems: Array<{
    label: string;
    onClick: () => void;
    active?: boolean;
    separatorAfter?: boolean;
  }> = [
    { label: "Overview",   onClick: () => navigate("/dashboard"),  active: location.pathname === "/dashboard" },
    { label: "Orders",     onClick: () => navigate("/orders"),     active: location.pathname === "/orders",     separatorAfter: true },
    { label: "Documents",  onClick: () => navigate("/documents"),  active: location.pathname === "/documents" },
    { label: "Settings",   onClick: () => navigate("/account"),    active: location.pathname === "/account",    separatorAfter: true },
    { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.() },
    { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true },
    { label: "Log off",    onClick: handleSignOut },
  ];

  return (
    <>
      {/* ── Mobile bottom tab bar ──────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
        style={{
          background: "hsl(var(--sidebar-background))",
          borderTop: "1px solid hsl(var(--border) / 0.2)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          height: "calc(56px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center justify-center flex-1 h-full transition-all"
              style={{ color: active ? "hsl(var(--gold))" : "hsl(var(--sidebar-foreground) / 0.4)" }}
            >
              <span className="font-sans uppercase" style={{ fontSize: 8, letterSpacing: "0.18em" }}>{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={openMenu}
          className="flex flex-col items-center justify-center flex-1 h-full transition-all"
          style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}
        >
          <span className="font-sans uppercase" style={{ fontSize: 8, letterSpacing: "0.18em" }}>Account</span>
        </button>
      </nav>

      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex fixed left-0 top-0 z-50 h-screen flex-col border-r border-border bg-sidebar transition-all duration-300",
          expanded ? "items-start p-8" : "items-center py-6",
          sidebarWidth,
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

        {/* Main nav */}
        <TooltipProvider delayDuration={0}>
          <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-2" : "items-center gap-1 w-full")}>
            {navItems.map((item) => {
              const active = isActive(item.path);
              const link = (
                <div key={item.path} className="relative w-full">
                  {active && !expanded && (
                    <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
                  )}
                  <Link
                    to={item.path}
                    className={cn(
                      "relative group flex items-center transition-all duration-300 ease-out whitespace-nowrap font-sans uppercase",
                      expanded ? "w-full pl-5 pr-3 py-3.5" : "h-11 w-12 justify-center mx-auto rounded-lg",
                      active
                        ? expanded ? "text-[hsl(var(--gold))]" : "text-gold"
                        : cn("text-sidebar-foreground/50 hover:text-sidebar-foreground/80", !expanded && "hover:bg-muted/40"),
                    )}
                    style={expanded ? { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 } : undefined}
                    title={expanded ? undefined : item.label}
                  >
                    {expanded && active && (
                      <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
                    )}
                    {expanded ? (
                      <span>{item.label}</span>
                    ) : (
                      <span className="text-[9px] font-medium uppercase tracking-[0.12em]">
                        {item.abbr}
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
                      <p className="text-[11px] font-medium text-foreground/70 leading-tight whitespace-normal break-words" style={{ letterSpacing: "0.02em" }}>
                        {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Account"}
                      </p>
                      {profile?.company && (
                        <p className="text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]/50 mt-1 whitespace-normal break-words">
                          {profile.company}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <p className="text-[9px] font-medium text-foreground/40 uppercase tracking-[0.12em] leading-tight text-center">
                        {profile?.first_name
                          ? `${profile.first_name[0]}${profile?.last_name?.[0] ?? ""}`.toUpperCase()
                          : "··"}
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
    </>
  );
}
