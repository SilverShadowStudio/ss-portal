import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Layers,
  GanttChart,
  Inbox,
  LayoutDashboard,
  ShoppingBag,
  FolderOpen,
  Settings,
  Sun,
  Moon,
  LogOut,
  User,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { SIDEBAR, TRANSITION } from "@/lib/design";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AccountMenuContent, AccountMenuItem, AccountMenuSeparator } from "@/components/account/AccountMenuContent";

// ── Nav items ─────────────────────────────────────────────────────────────────
// Main nav — top 3
const navItems = [
  { icon: Layers,      path: "/portfolio",  label: "Portfolio" },
  { icon: GanttChart,  path: "/timeline",   label: "Timeline",  rotate: true },
  { icon: Inbox,       path: "/delivery",   label: "Deliveries" },
];

// Bottom nav — secondary items
const bottomNavItems = [
  { icon: LayoutDashboard, path: "/dashboard",  label: "Overview" },
  { icon: ShoppingBag,     path: "/orders",     label: "Orders" },
  { icon: FolderOpen,      path: "/documents",  label: "Documents" },
  { icon: Settings,        path: "/account",    label: "Settings" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
    position: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name, company, position")
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
    location.pathname === path ||
    (path !== "/" && location.pathname.startsWith(path));

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
              className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all"
              style={{
                color: active ? "hsl(var(--gold))" : "hsl(var(--sidebar-foreground) / 0.4)",
              }}
            >
              <item.icon
                className="transition-all"
                style={{ width: 20, height: 20 }}
                strokeWidth={1.5}
              />
              <span className="font-sans uppercase" style={{ fontSize: 8, letterSpacing: "0.18em" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        {/* Account tab */}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all"
          style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}
        >
          <User style={{ width: 20, height: 20 }} strokeWidth={1.5} />
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
        <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-2" : "items-center gap-1")}>
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <div key={item.path} className="relative w-full">
                {active && !expanded && (
                  <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
                )}
                <Link
                  to={item.path}
                  className={cn(
                    "relative group flex items-center transition-all duration-300 ease-out whitespace-nowrap font-sans uppercase",
                    expanded
                      ? "w-full pl-5 pr-3 py-3.5"
                      : "h-11 w-12 justify-center mx-auto rounded-lg",
                    active
                      ? expanded ? "text-[hsl(var(--gold))]" : "text-gold"
                      : cn("text-sidebar-foreground/50 hover:text-sidebar-foreground/80", !expanded && "hover:bg-muted/40"),
                  )}
                  style={expanded ? { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 } : undefined}
                  title={item.label}
                >
                  {expanded && active && (
                    <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
                  )}
                  {expanded ? (
                    <span>{item.label}</span>
                  ) : (
                    <item.icon
                      className={cn("shrink-0 h-5 w-5", (item as any).rotate && "-rotate-90", active && "text-gold")}
                      strokeWidth={1.5}
                    />
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Bottom nav */}
        <nav className={cn("flex flex-col", expanded ? "w-full space-y-2 pb-2" : "items-center gap-1 pb-2")}>
          {bottomNavItems.map((item) => {
            const active = isActive(item.path);
            return (
              <div key={item.path} className="relative w-full">
                {active && !expanded && (
                  <div className="absolute -left-[26px] top-1/2 h-6 w-0.5 -translate-y-1/2 bg-gold" />
                )}
                <Link
                  to={item.path}
                  className={cn(
                    "relative group flex items-center transition-all duration-300 ease-out whitespace-nowrap font-sans uppercase",
                    expanded ? "w-full pl-5 pr-3 py-3" : "h-11 w-12 justify-center mx-auto rounded-lg",
                    active
                      ? expanded ? "text-[hsl(var(--gold))]" : "text-gold"
                      : cn("text-sidebar-foreground/50 hover:text-sidebar-foreground/80", !expanded && "hover:bg-muted/40"),
                  )}
                  style={expanded ? { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 } : undefined}
                  title={item.label}
                >
                  {expanded && active && (
                    <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
                  )}
                  {expanded ? (
                    <span>{item.label}</span>
                  ) : (
                    <item.icon
                      className={cn("shrink-0 h-5 w-5", active && "text-gold")}
                      strokeWidth={1.5}
                    />
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Account */}
        <div className={cn("pt-4", expanded ? "w-full" : "")}>
          {expanded && (
            <div aria-hidden className="mb-3" style={{ height: 1, background: "hsl(var(--border) / 0.25)" }} />
          )}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex items-center transition-all duration-300 ease-out",
                  expanded
                    ? "w-full pl-5 pr-3 py-2"
                    : "h-11 w-12 justify-center text-muted-foreground hover:text-foreground rounded-xl"
                )}
                title="Account"
              >
                {expanded ? (
                  <div className="text-left min-w-0">
                    <p className="text-[12px] font-medium text-foreground leading-tight whitespace-normal break-words" style={{ letterSpacing: "0.02em" }}>
                      {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Client"}
                    </p>
                    <p className="text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]/55 mt-1">
                      {profile?.company || ""}
                    </p>
                  </div>
                ) : (
                  <User className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                )}
              </button>
            </PopoverTrigger>
            <AccountMenuContent>
              <AccountMenuItem
                icon={expanded ? <ChevronsLeft size={16} strokeWidth={1.5} /> : <ChevronsRight size={16} strokeWidth={1.5} />}
                label={expanded ? "Compact" : "Expand"}
                onClick={() => { setMenuOpen(false); onToggleExpand?.(); }}
              />
              <AccountMenuItem
                icon={theme === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
                label={theme === "dark" ? "Light mode" : "Dark mode"}
                onClick={() => { setMenuOpen(false); toggleTheme(); }}
              />
              <AccountMenuSeparator />
              <AccountMenuItem
                icon={<LogOut size={16} strokeWidth={2} />}
                label="Log off"
                destructive
                onClick={handleSignOut}
              />
            </AccountMenuContent>
          </Popover>
        </div>
      </aside>
    </>
  );
}
