import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import {
  LayoutDashboard, CalendarDays, Users2, UserPlus, Activity,
  FileText, Landmark, ScrollText, Receipt, TrendingUp,
  Settings, Sun, Moon, LogOut, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { Sidebar, type SidebarNavSection, type SidebarAccountMenuItem } from "./Sidebar";

// Admin sidebar — grouped by audience.
//   Group 1: Dashboard + Timeline (overview).
//   Group 2: Clients (clickable top-level) + their indented sub-routes.
//   Group 3: Team (clickable top-level) + their indented sub-routes.
//   Group 4: Finance (non-clickable label) + its indented sub-routes.
// Sections are separated by a 1px rule rendered by Sidebar.tsx.
const SECTIONS: SidebarNavSection[] = [
  {
    items: [
      { path: "/admin",          label: "Dashboard", Icon: LayoutDashboard, matchActive: (p) => p === "/admin" },
      { path: "/admin/timeline", label: "Timeline",  Icon: CalendarDays    },
    ],
  },
  {
    items: [
      { path: "/admin/clients",   label: "Clients",    Icon: Users2 },
      { path: "/admin/documents", label: "Agreements", Icon: FileText,   indent: true },
      { path: "/admin/quotes",    label: "Quotes",     Icon: ScrollText, indent: true },
      { path: "/admin/invoices",  label: "Invoices",   Icon: Landmark,   indent: true },
    ],
  },
  {
    items: [
      // Team's own listing page; matchActive excludes sub-routes so /admin/team/contracts
      // doesn't dual-highlight Team and Agreements.
      { path: "/admin/team",               label: "Team",       Icon: UserPlus, matchActive: (p) => p === "/admin/team" },
      { path: "/admin/team/contracts",     label: "Agreements", Icon: FileText, indent: true },
      { path: "/admin/team/invoices",      label: "Invoices",   Icon: Landmark, indent: true },
      { path: "/admin/production-tracker", label: "Tracker",    Icon: Activity, indent: true },
    ],
  },
  {
    title: "Finance",
    items: [
      { path: "/admin/finance/pnl",      label: "P&L",      Icon: TrendingUp, indent: true },
      { path: "/admin/finance/expenses", label: "Expenses", Icon: Receipt,    indent: true },
    ],
  },
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
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
  } | null>(null);
  const newClientsCount = useNewClientsCount();

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  // Attach the live new-clients badge to the Clients item.
  const sections: SidebarNavSection[] = SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.path === "/admin/clients"
        ? { ...item, badgeCount: newClientsCount }
        : item,
    ),
  }));

  const accountMenuItems: SidebarAccountMenuItem[] = [
    { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.(), Icon: expanded ? ChevronsLeft : ChevronsRight },
    { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true, Icon: theme === "dark" ? Sun : Moon },
    { label: "Settings", onClick: () => navigate("/admin/settings"), active: location.pathname.startsWith("/admin/settings"), separatorAfter: true, Icon: Settings },
    { label: "Log off", onClick: handleSignOut, Icon: LogOut },
  ];

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    "Admin";

  const initials = profile?.first_name
    ? `${profile.first_name[0]}${profile?.last_name?.[0] ?? ""}`.toUpperCase()
    : "AD";

  return (
    <Sidebar
      sections={sections}
      accountMenuItems={accountMenuItems}
      accountDisplayName={displayName}
      accountSubLabel="Admin"
      accountInitials={initials}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
}
