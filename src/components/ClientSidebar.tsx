import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Inbox, Images, FileText } from "lucide-react";
import { Sidebar, type SidebarNavItem, type SidebarAccountMenuItem } from "./Sidebar";

const PARTNERSHIP_NAV: SidebarNavItem[] = [
  { path: "/timeline",  label: "Timeline",   Icon: CalendarDays },
  { path: "/delivery",  label: "Deliveries", Icon: Inbox        },
];

const PROJECT_NAV: SidebarNavItem[] = [
  { path: "/portfolio", label: "Portfolio",  Icon: Images },
];

const TEAM_NAV: SidebarNavItem[] = [
  { path: "/documents", label: "Documents",  Icon: FileText },
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
  const [profile, setProfile] = useState<{
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    company: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("profiles").select("first_name, last_name, full_name, company").eq("user_id", user.id).maybeSingle(),
      supabase.from("account_members").select("accounts(company_name)").eq("user_id", user.id).maybeSingle(),
    ]).then(([{ data: profileData }, { data: memberData }]) => {
      const accountCompany = (memberData as any)?.accounts?.company_name ?? null;
      setProfile({
        first_name: profileData?.first_name ?? null,
        last_name: profileData?.last_name ?? null,
        full_name: profileData?.full_name ?? null,
        company: profileData?.company ?? accountCompany,
      });
    });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const navItems = accountType === "team"
    ? TEAM_NAV
    : accountType === "project"
    ? PROJECT_NAV
    : PARTNERSHIP_NAV;

  const accountMenuItems: SidebarAccountMenuItem[] = accountType === "team"
    ? [
        { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.() },
        { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true },
        { label: "Log off", onClick: handleSignOut },
      ]
    : [
        // Overview + Orders only apply to the lane-based partnership model.
        // Project clients see Documents and Settings, then the system items.
        ...(accountType === "project"
          ? []
          : [
              { label: "Overview", onClick: () => navigate("/dashboard"), active: location.pathname === "/dashboard" },
              { label: "Orders",   onClick: () => navigate("/orders"),    active: location.pathname === "/orders",   separatorAfter: true },
            ] as SidebarAccountMenuItem[]),
        { label: "Documents",  onClick: () => navigate("/documents"),  active: location.pathname === "/documents" },
        { label: "Settings",   onClick: () => navigate("/account"),    active: location.pathname === "/account",    separatorAfter: true },
        { label: expanded ? "Compact" : "Expand", onClick: () => onToggleExpand?.() },
        { label: theme === "dark" ? "Light mode" : "Dark mode", onClick: toggleTheme, separatorAfter: true },
        { label: "Log off",    onClick: handleSignOut },
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
      accountSubLabel={accountType === "team" ? "Team" : (profile?.company ?? null)}
      accountInitials={initials}
      showMobileTabBar
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
}
