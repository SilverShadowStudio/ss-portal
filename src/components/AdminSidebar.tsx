import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNewClientsCount } from "@/hooks/useNewClientsCount";
import { useDueOverheadsCount } from "@/hooks/useDueOverheadsCount";
import {
  LayoutDashboard, CalendarDays, Users2, UserPlus, Activity,
  FileText, Landmark, ScrollText, TrendingUp, HandCoins, Repeat, FileCheck2,
  Settings, LogOut, ChevronsLeft, ChevronsRight, Target,
} from "lucide-react";
import { Sidebar, type SidebarNavSection, type SidebarAccountMenuItem } from "./Sidebar";

// Admin sidebar — grouped by audience.
//   Group 1: Overview + Timeline (overview).
//   Group 2: Clients (clickable top-level) + their indented sub-routes.
//   Group 3: Team (clickable top-level) + their indented sub-routes.
//   Group 4: Finance (non-clickable label) + its indented sub-routes.
// Sections are separated by a 1px rule rendered by Sidebar.tsx.
const SECTIONS: SidebarNavSection[] = [
  {
    items: [
      { path: "/admin",          label: "Overview",  Icon: LayoutDashboard, matchActive: (p) => p === "/admin" },
      { path: "/admin/sales",    label: "Sales",     Icon: Target          },
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
      // Documents now live inline on each team member's card (Team page).
      { path: "/admin/team",               label: "Team",       Icon: UserPlus, matchActive: (p) => p === "/admin/team" },
      { path: "/admin/team/invoices",      label: "Invoices",   Icon: Landmark, indent: true },
      { path: "/admin/production-tracker", label: "Tracker",    Icon: Activity, indent: true },
    ],
  },
  {
    title: "Finance",
    items: [
      { path: "/admin/finance/pnl",         label: "P&L",         Icon: TrendingUp, indent: true },
      { path: "/admin/finance/reconcile",   label: "Reconcile",   Icon: Landmark,   indent: true },
      { path: "/admin/finance/reconciliation", label: "Reconciliation", Icon: FileCheck2, indent: true },
      { path: "/admin/finance/freelancers", label: "Debts",       Icon: HandCoins,  indent: true },
      { path: "/admin/finance/recurring",   label: "Recurring",   Icon: Repeat,     indent: true },
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
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
  } | null>(null);
  const newClientsCount = useNewClientsCount();
  const dueOverheadsCount = useDueOverheadsCount();

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

  // Attach the live badges: new-clients on Clients, due-overheads on Expenses.
  const sections: SidebarNavSection[] = SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.path === "/admin/clients") {
        return { ...item, badgeCount: newClientsCount };
      }
      if (item.path === "/admin/finance/pnl") {
        return { ...item, badgeCount: dueOverheadsCount };
      }
      return item;
    }),
  }));

  const accountMenuItems: SidebarAccountMenuItem[] = [
    { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.(), separatorAfter: true, Icon: expanded ? ChevronsLeft : ChevronsRight },
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
