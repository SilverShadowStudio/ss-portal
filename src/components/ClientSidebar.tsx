import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays, Inbox, Images, FileText, Users, Wallet, Banknote,
  LayoutDashboard, Package, Settings, LogOut, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { Sidebar, type SidebarNavItem, type SidebarAccountMenuItem } from "./Sidebar";

const PARTNERSHIP_NAV: SidebarNavItem[] = [
  { path: "/timeline",  label: "Timeline",   Icon: CalendarDays },
  { path: "/delivery",  label: "Deliveries", Icon: Inbox        },
];

const PROJECT_NAV: SidebarNavItem[] = [
  { path: "/portfolio", label: "Portfolio",  Icon: Images },
];

const TEAM_NAV: SidebarNavItem[] = [
  { path: "/earnings",  label: "Earnings",   Icon: Wallet   },
  { path: "/documents", label: "Documents",  Icon: FileText },
];
// Employees are salaried (payroll), not paid per work — Salary replaces Earnings.
const TEAM_NAV_EMPLOYEE: SidebarNavItem[] = [
  { path: "/documents", label: "Documents",  Icon: FileText },
  { path: "/salary",    label: "Salary",     Icon: Banknote },
];

interface ClientSidebarProps {
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function ClientSidebar({ expanded = true, onToggleExpand }: ClientSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, accountType, employmentType, isClientManager } = useAuth();
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
    role: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("profiles").select("first_name, last_name, full_name, company").eq("user_id", user.id).maybeSingle(),
      supabase.from("account_members").select("accounts(company_name, position, team_role)").eq("user_id", user.id).maybeSingle(),
      // Team members' names live in freelancer_profiles, not profiles.
      supabase.from("freelancer_profiles").select("first_name, last_name, role").eq("user_id", user.id).maybeSingle(),
    ]).then(([{ data: profileData }, { data: memberData }, { data: freelancerData }]) => {
      const acct = (memberData as any)?.accounts;
      // Team members show their position/role under the name — employee position,
      // else invite role, else the freelancer profile role.
      const teamRole = acct?.position || acct?.team_role || (freelancerData as any)?.role || null;
      setProfile({
        first_name: profileData?.first_name ?? freelancerData?.first_name ?? null,
        last_name: profileData?.last_name ?? freelancerData?.last_name ?? null,
        full_name: profileData?.full_name ?? null,
        company: profileData?.company ?? acct?.company_name ?? null,
        role: teamRole,
      });
    });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const navItems = accountType === "team"
    ? (employmentType === "employee" ? TEAM_NAV_EMPLOYEE : TEAM_NAV)
    : accountType === "project"
    ? PROJECT_NAV
    : PARTNERSHIP_NAV;

  const accountMenuItems: SidebarAccountMenuItem[] = accountType === "team"
    ? [
        { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.(), separatorAfter: true, Icon: expanded ? ChevronsLeft : ChevronsRight },
        { label: "Log off", onClick: handleSignOut, Icon: LogOut },
      ]
    : [
        // Overview (dashboard — financials/contractual state), Orders, and
        // Documents are Manager-level surfaces → Managers only (Invitees are
        // also blocked at the route + RLS layers). Team is Managers only.
        // Settings stays for all.
        ...(accountType !== "partnership" || !isClientManager
          ? []
          : ([
              { label: "Overview", onClick: () => navigate("/dashboard"), active: location.pathname === "/dashboard", Icon: LayoutDashboard },
              { label: "Orders", onClick: () => navigate("/orders"), active: location.pathname === "/orders", separatorAfter: true, Icon: Package },
            ] as SidebarAccountMenuItem[])),
        ...(isClientManager
          ? ([{ label: "Documents", onClick: () => navigate("/documents"), active: location.pathname === "/documents", separatorAfter: true, Icon: FileText }] as SidebarAccountMenuItem[])
          : []),
        // Team — Managers of project/partnership accounts only (Invitees never see it).
        ...(isClientManager
          ? ([{ label: "Team", onClick: () => navigate("/team"), active: location.pathname === "/team", Icon: Users }] as SidebarAccountMenuItem[])
          : []),
        { label: "Settings",   onClick: () => navigate("/account"),    active: location.pathname === "/account",    separatorAfter: true, Icon: Settings },
        { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.(), separatorAfter: true, Icon: expanded ? ChevronsLeft : ChevronsRight },
        { label: "Log off",    onClick: handleSignOut, Icon: LogOut },
      ];

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.full_name ||
    "Account";

  const initials = profile?.first_name
    ? `${profile.first_name[0]}${profile?.last_name?.[0] ?? ""}`.toUpperCase()
    : "··";

  return (
    <Sidebar
      sections={[{ items: navItems }]}
      accountMenuItems={accountMenuItems}
      accountDisplayName={displayName}
      accountSubLabel={accountType === "team" ? (profile?.role ?? "Team") : (profile?.company ?? null)}
      accountInitials={initials}
      showMobileTabBar
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
}
