// Shared sidebar primitive used by both AdminSidebar and ClientSidebar.
// The wrappers build the `sections` and `accountMenuItems` config and pass it
// in; this component owns all the visual rendering (shell, logo, item
// rendering, active gold bar, hover-account-menu, mobile bottom-tab-bar).
//
// The hover-account-menu animation block was copied verbatim from the
// per-portal implementations — do not rewrite without a designer's signoff.

import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/ThemeProvider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SB } from "@/lib/sidebarConstants";
import type { LucideIcon } from "lucide-react";

export interface SidebarNavItem {
  path: string;
  label: string;
  Icon: LucideIcon;
  /** Optional numeric badge shown on the item (e.g. new-clients count) */
  badgeCount?: number;
  /** Optional override — by default `current === path` or
   *  `current.startsWith(path + "/")`. Use for items like "/admin" that
   *  must NOT match every sub-route. */
  matchActive?: (currentPath: string) => boolean;
  /** If true, render with deeper left padding to read as a child of the
   *  preceding (parent) item or section header. Expanded mode only. */
  indent?: boolean;
}

export interface SidebarNavSection {
  /** Header label rendered above the items. Omit for headerless top-level rows. */
  title?: string;
  items: SidebarNavItem[];
}

export interface SidebarAccountMenuItem {
  label: string;
  onClick: () => void;
  active?: boolean;
  separatorAfter?: boolean;
  /** Lucide icon shown in compact (collapsed) mode. Expanded mode shows the
   *  text label only; compact mode shows the icon centred with the label as
   *  a tooltip. Items without an Icon fall back to truncated text in compact
   *  mode (legacy behaviour). */
  Icon?: LucideIcon;
}

export interface SidebarProps {
  sections: SidebarNavSection[];
  accountMenuItems: SidebarAccountMenuItem[];
  /** Big text on the expanded account row. */
  accountDisplayName: string;
  /** Small gold sub-label under the account name (e.g. "Admin" or company name). */
  accountSubLabel?: string | null;
  /** Initials shown on the collapsed account row. */
  accountInitials: string;
  /** Render the mobile bottom-tab-bar (client-only). */
  showMobileTabBar?: boolean;
  expanded: boolean;
  onToggleExpand?: () => void;
  /** Optional extra element rendered above the bottom tab bar's account button on mobile. */
  mobileExtraSlot?: ReactNode;
}

function defaultMatchActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === "/admin") return currentPath === "/admin";
  return currentPath === itemPath || currentPath.startsWith(itemPath + "/");
}

export function Sidebar({
  sections,
  accountMenuItems,
  accountDisplayName,
  accountSubLabel,
  accountInitials,
  showMobileTabBar = false,
  expanded,
  onToggleExpand,
}: SidebarProps) {
  void onToggleExpand; // currently only invoked via accountMenuItems
  const location = useLocation();
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [acctMenuOpen, setAcctMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Retained only for the mobile bottom-tab account button (openMenu). The
  // desktop account menu is now a Radix Popover and no longer uses this.
  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setMenuOpen(true);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const sidebarWidth = expanded ? SB.widthExpanded : SB.widthCollapsed;

  const renderItem = (item: SidebarNavItem) => {
    const isActive = item.matchActive
      ? item.matchActive(location.pathname)
      : defaultMatchActive(item.path, location.pathname);
    const showBadge = !!item.badgeCount && item.badgeCount > 0;
    const badgeLabel = (item.badgeCount ?? 0) > 99 ? "99+" : String(item.badgeCount ?? 0);

    const linkEl = (
      <Link
        to={item.path}
        className={cn(
          "relative group flex items-center rounded-lg transition-colors duration-quick whitespace-nowrap font-sans uppercase",
          expanded
            ? cn("w-full pr-3 py-3", item.indent ? "pl-10" : "pl-5")
            : "h-11 w-12 justify-center mx-auto",
          isActive ? "text-strong" : "text-standard hover:text-strong",
          // collapsed keeps a full-box hover; expanded uses the tick-height pill below
          !expanded && "hover:bg-gold/10",
        )}
        style={expanded ? SB.navStyle : undefined}
      >
        {/* Hover highlight — same height as the active tick (h-4), centred */}
        {expanded && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 rounded-md bg-gold/10 opacity-0 transition-opacity duration-quick group-hover:opacity-100"
          />
        )}
        {expanded && isActive && (
          <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--gold))]" />
        )}
        {expanded ? (
          <span className="relative z-10 flex flex-1 items-center justify-between gap-2">
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

  // Flat list of nav items for the mobile bottom-tab-bar.
  const flatItems = sections.flatMap((s) => s.items);

  return (
    <>
      {/* ── Mobile bottom tab bar ────────────────────────────────────── */}
      {showMobileTabBar && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
          style={{
            background: "hsl(var(--sidebar-background))",
            borderTop: "1px solid hsl(var(--border) / 0.2)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            height: "calc(56px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {flatItems.map((item) => {
            const active = item.matchActive
              ? item.matchActive(location.pathname)
              : defaultMatchActive(item.path, location.pathname);
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
      )}

      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside
        className={cn(
          showMobileTabBar ? "hidden md:flex" : "flex",
          "fixed left-0 top-0 z-50 h-screen flex-col border-r border-border bg-sidebar transition-all duration-standard",
          expanded ? "items-start p-8" : "items-center py-6",
          sidebarWidth,
        )}
      >
        {/* Logo */}
        <div className={cn(expanded ? `${SB.logoMarginExpanded} px-4 mt-[10px]` : SB.logoMarginCollapsed)}>
          <a href="https://www.silvershadowstudio.com" target="_blank" rel="noopener noreferrer" className="block transition-smooth hover:opacity-80">
            {expanded ? (
              <img
                src="https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png"
                alt="Silver Shadow Studio"
                className="h-7 w-auto object-contain"
                style={{ filter: theme === "dark" ? "brightness(0) invert(1)" : "brightness(0)" }}
              />
            ) : (
              <img src={ssIcon} alt="Silvershadow" className="h-6 w-6 shrink-0 brightness-0 dark:invert" />
            )}
          </a>
        </div>

        {/* Main nav */}
        <TooltipProvider delayDuration={0}>
          <nav
            className={cn(
              "flex flex-1 flex-col overflow-y-auto",
              expanded ? "w-full mt-[5px]" : "items-center w-full gap-1",
            )}
          >
            {sections.map((section, sIdx) => (
              <div
                key={section.title ?? `unsectioned-${sIdx}`}
                className={cn(
                  "w-full",
                  !expanded && sIdx > 0 && "mt-2",
                )}
              >
                {expanded && sIdx > 0 && (
                  <hr
                    aria-hidden
                    className="mx-6 my-4 border-0"
                    style={{ borderTop: "1px solid var(--divider)" }}
                  />
                )}
                {expanded && section.title && (
                  <div
                    className="font-sans uppercase text-sidebar-foreground/50 select-none pr-3 py-3 pl-5"
                    style={SB.navStyle}
                  >
                    {section.title}
                  </div>
                )}
                <div className={cn(expanded ? "flex flex-col gap-2" : "flex flex-col items-center gap-1")}>
                  {section.items.map((item) => renderItem(item))}
                </div>
              </div>
            ))}
          </nav>
        </TooltipProvider>

        {/* Account — hover the name to reveal an independent popover menu.
            Replaces the old inline animated stack with a Radix Popover so the
            menu floats free of the sidebar. The mobile bottom-tab path (which
            still calls openMenu) is untouched. */}
        <div className="w-full pt-4">
          <Popover open={acctMenuOpen} onOpenChange={setAcctMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center rounded-lg transition-colors hover:bg-gold/10",
                  expanded ? "gap-3 px-5 py-3" : "justify-center py-3",
                )}
              >
                {expanded ? (
                  <div className="min-w-0 text-left">
                    <p className={SB.accountNameClass} style={{ ...SB.accountNameStyle, color: "var(--text-standard)" }}>
                      {accountDisplayName}
                    </p>
                    {accountSubLabel && (
                      <p className={`text-[8.5px] uppercase tracking-[0.24em] text-[hsl(var(--gold))]${SB.accountSubOpacity} mt-1 whitespace-normal break-words`}>
                        {accountSubLabel}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className={SB.accountInitialsClass}>{accountInitials}</p>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="end"
              sideOffset={6}
              className="w-52 rounded-xl border-0 bg-[#211c26] p-1.5 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.75)]"
            >
              <div className="flex flex-col">
                {accountMenuItems.map((it) => (
                  <div key={it.label}>
                    <button
                      type="button"
                      onClick={() => { it.onClick(); setAcctMenuOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-sans uppercase transition-colors",
                        it.active
                          ? "bg-gold/10 text-strong"
                          : "text-standard hover:bg-gold/10 hover:text-strong",
                      )}
                      style={SB.menuItemStyle}
                    >
                      {it.Icon && <it.Icon style={{ width: 15, height: 15 }} strokeWidth={1.5} />}
                      <span>{it.label}</span>
                    </button>
                    {it.separatorAfter && <div className="mx-2 my-1 h-px bg-border/40" />}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
    </>
  );
}
