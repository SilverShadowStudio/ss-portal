import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Image,
  FileText,
  Kanban,
  Layers,
  Receipt,
  ShoppingBag,
  Sun,
  Moon,
  LogOut,
  User,
  ChevronsLeft,
  ChevronsRight,
  UploadCloud,
  Activity,
  LineChart,
  Ghost,
} from "lucide-react";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { SIDEBAR, TRANSITION } from "@/lib/design";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AccountMenuContent, AccountMenuItem, AccountMenuSeparator } from "@/components/account/AccountMenuContent";

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
  const [menuOpen, setMenuOpen] = useState(false);
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
      <nav className={cn("flex flex-1 flex-col", expanded ? "w-full space-y-2" : "items-center gap-1")}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== "/admin" && location.pathname.startsWith(item.path));
          const showBadge = item.path === "/admin/clients" && newClientsCount > 0;
          const badgeLabel = newClientsCount > 99 ? "99+" : String(newClientsCount);
          return (
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
                title={item.label}
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
        })}
      </nav>

      {/* Account menu at bottom */}
      {/* Bottom nav items (above account) */}
      <nav className={cn("flex flex-col", expanded ? "w-full space-y-2 pb-2" : "items-center gap-1 pb-2")}>
        {bottomNavItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== "/admin" && location.pathname.startsWith(item.path));
          return (
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
                title={item.label}
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
        })}
      </nav>

      <div className={cn("pt-4", expanded ? "w-full" : "")}>
        {expanded && (
          <div
            aria-hidden
            className="mb-3"
            style={{ height: 1, background: "hsl(var(--border) / 0.25)" }}
          />
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
                    {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.full_name || "Admin"}
                  </p>
                  <p className="text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]/55 mt-1">
                    Admin
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
  );
}
