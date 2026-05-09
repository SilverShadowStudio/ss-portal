import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CircleUser,
  LayoutDashboard,
  Inbox,
  GanttChart,
  Layers,
  FolderOpen,
  Settings,
  ShoppingBag,
  Maximize2,
  Minimize2,
  Sun,
  Moon,
  ArrowRightFromLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems: Array<{ path: string; label: string; icon: LucideIcon }> = [
  { path: "/dashboard",  label: "Overview",   icon: LayoutDashboard },
  { path: "/timeline",   label: "Timeline",   icon: GanttChart },
  { path: "/delivery",   label: "Deliveries", icon: Inbox },
  { path: "/portfolio",  label: "Portfolio",  icon: Layers },
  { path: "/orders",     label: "Orders",     icon: ShoppingBag },
];

interface ClientSidebarProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function ClientSidebar({ expanded = true, onToggleExpand }: ClientSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOnSubMenuPage = location.pathname === "/documents" || location.pathname === "/account";

  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setMenuOpen(true);
  };
  const scheduleClose = () => {
    if (isOnSubMenuPage) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), 5000);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => { if (isOnSubMenuPage) setMenuOpen(true); }, [isOnSubMenuPage]);

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
    await signOut();
    navigate("/auth");
  };

  const sidebarWidth = expanded ? "w-[220px]" : "w-20";

  // ── Mobile bottom tab bar ─────────────────────────────────────────────────

  const MobileTabBar = () => (
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
        const isActive = location.pathname === item.path;
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => {
              if (item.path === "/timeline") {
                window.dispatchEvent(new CustomEvent("timeline:scroll-to-now"));
              }
            }}
            className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all"
            style={{
              color: isActive ? "hsl(var(--gold))" : "hsl(var(--sidebar-foreground) / 0.4)",
            }}
          >
            <Icon
              className="transition-all"
              strokeWidth={isActive ? 2 : 1.5}
              style={{ width: 20, height: 20 }}
            />
            <span
              className="font-sans uppercase"
              style={{
                fontSize: 8,
                letterSpacing: "0.18em",
                lineHeight: 1,
                opacity: isActive ? 1 : 0.7,
              }}
            >
              {item.label}
            </span>
            {isActive && (
              <span
                className="absolute bottom-0 rounded-full"
                style={{
                  width: 3,
                  height: 3,
                  background: "hsl(var(--gold))",
                  marginBottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
                }}
              />
            )}
          </Link>
        );
      })}
      {/* Account */}
      <button
        type="button"
        onClick={() => navigate("/account")}
        className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all"
        style={{
          color: isOnSubMenuPage
            ? "hsl(var(--gold))"
            : "hsl(var(--sidebar-foreground) / 0.4)",
        }}
      >
        <CircleUser strokeWidth={1.5} style={{ width: 20, height: 20 }} />
        <span
          className="font-sans uppercase"
          style={{ fontSize: 8, letterSpacing: "0.18em", lineHeight: 1, opacity: 0.7 }}
        >
          More
        </span>
      </button>
    </nav>
  );

  // ── Desktop sidebar ───────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile tab bar */}
      <MobileTabBar />

      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className={cn(
          "hidden md:flex fixed left-0 top-0 z-50 h-screen flex-col bg-sidebar items-start px-6 pt-12 pb-8",
          sidebarWidth,
        )}
      >
        {/* Logo */}
        <div className={cn(expanded ? "mb-16 px-2" : "mb-12")}>
          <Link to="/dashboard" className="block transition-opacity hover:opacity-70">
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
          </Link>
        </div>

        {/* Navigation */}
        <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-1" : "items-center gap-2 w-full")}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;

              const link = (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => {
                    if (item.path === "/timeline") {
                      window.dispatchEvent(new CustomEvent("timeline:scroll-to-now"));
                    }
                  }}
                  className={cn(
                    "relative flex items-center font-sans uppercase whitespace-nowrap transition-all border-l-2",
                    expanded ? "w-full pl-6 pr-3 py-2.5" : "w-full justify-center py-2.5",
                    isActive
                      ? "text-sidebar-foreground border-[hsl(var(--gold))]"
                      : "text-sidebar-foreground/45 hover:text-sidebar-foreground border-transparent",
                  )}
                  style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 500 }}
                >
                  {expanded ? (
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                      {item.label}
                    </span>
                  ) : (
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  )}
                </Link>
              );

              if (expanded) return link;
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12} className="text-[10px] uppercase tracking-[0.18em]">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </nav>

        {/* Account */}
        <div
          className={cn("group/account pt-4 relative", expanded ? "w-full" : "w-full")}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          onFocus={openMenu}
          onBlur={scheduleClose}
        >
          {/* Hover-revealed stack */}
          <div className="pointer-events-none absolute left-0 right-0 bottom-full overflow-hidden">
            <div className="flex flex-col">
              {(() => {
                const items: Array<{
                  label: string;
                  icon: LucideIcon;
                  onClick: () => void;
                  active?: boolean;
                  separatorAfter?: boolean;
                }> = [
                  { label: "Documents", icon: FolderOpen, onClick: () => navigate("/documents"), active: location.pathname === "/documents" },
                  { label: "Settings", icon: Settings, onClick: () => navigate("/account"), active: location.pathname === "/account", separatorAfter: true },
                  { label: expanded ? "Compact" : "Expand", icon: expanded ? Minimize2 : Maximize2, onClick: () => onToggleExpand?.() },
                  { label: theme === "dark" ? "Light mode" : "Dark mode", icon: theme === "dark" ? Sun : Moon, onClick: toggleTheme, separatorAfter: true },
                  { label: "Log off", icon: ArrowRightFromLine, onClick: handleSignOut },
                ];

                return items.map((it, idx) => (
                  <div key={it.label} className="contents">
                    <button
                      type="button"
                      onClick={it.onClick}
                      title={expanded ? undefined : it.label}
                      className={cn(
                        "pointer-events-auto transition-all duration-300 ease-out font-sans uppercase whitespace-nowrap text-left border-l-2",
                        it.active
                          ? "translate-y-0 opacity-100 text-sidebar-foreground border-[hsl(var(--gold))]"
                          : cn(
                              "border-transparent text-sidebar-foreground/45 hover:text-sidebar-foreground",
                              menuOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                            ),
                        "flex items-center",
                        expanded ? "w-full pl-6 pr-3 py-2.5" : "w-full justify-center py-2.5",
                      )}
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.12em",
                        fontWeight: 500,
                        transitionDelay: `${(items.length - 1 - idx) * 40}ms`,
                      }}
                    >
                      {expanded ? (
                        <span className="flex items-center gap-3">
                          <it.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                          {it.label}
                        </span>
                      ) : (
                        <it.icon className="h-5 w-5" strokeWidth={1.5} />
                      )}
                    </button>
                    {it.separatorAfter && (
                      <div
                        aria-hidden
                        className={cn(
                          "pointer-events-none transition-all duration-300 ease-out",
                          menuOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
                          expanded ? "mx-4 my-2" : "mx-3 my-2",
                        )}
                        style={{
                          height: 1,
                          background: "hsl(var(--border) / 0.4)",
                          transitionDelay: `${(items.length - 1 - idx) * 40}ms`,
                        }}
                      />
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Account row */}
          <button
            type="button"
            className={cn(
              "flex items-center transition-all w-full",
              expanded ? "gap-3 px-4 py-3" : "justify-center py-3",
            )}
            title={expanded ? undefined : "Account"}
          >
            {expanded ? (
              <>
                <CircleUser className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <div className="text-left min-w-0">
                  <p className="text-[13px] font-medium text-foreground leading-tight whitespace-normal break-words">
                    {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Account"}
                  </p>
                  {profile?.company && (
                    <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mt-1 whitespace-normal break-words">
                      {profile.company}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <CircleUser className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
