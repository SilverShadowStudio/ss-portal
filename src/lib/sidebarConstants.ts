// Shared visual constants for AdminSidebar and ClientSidebar.
// AdminSidebar is the source of truth. Edit here; both sidebars inherit.

export const SB = {
  widthExpanded:        "w-64",
  widthCollapsed:       "w-20",
  logoMarginExpanded:   "mb-12",
  logoMarginCollapsed:  "mb-6",

  // Expanded nav item inline style
  navStyle: { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 },

  // Collapsed nav abbreviation
  abbrClass: "text-[9px] font-medium uppercase tracking-[0.12em]",

  // Tooltip label
  tooltipClass: "text-[10px] uppercase tracking-[0.18em]",

  // Account row — expanded name
  accountNameClass:
    "text-[12px] font-medium text-foreground leading-tight whitespace-normal break-words",
  accountNameStyle: { letterSpacing: "0.02em" },

  // Account row — expanded sub (role / company)
  accountSubOpacity: "/55",   // appended to text-[hsl(var(--gold))]

  // Account row — collapsed initials
  accountInitialsClass:
    "text-[9px] font-medium text-foreground/40 uppercase tracking-[0.12em] leading-tight text-center",

  // Hover-menu item inline style (base — caller adds transitionDelay)
  menuItemStyle: { fontSize: 11, letterSpacing: "0.24em", fontWeight: 500 },

  // Separator between hover-menu groups
  separatorStyle: {
    height: 1,
    margin: "8px 20px",
    background: "hsl(var(--border) / 0.4)",
  },
} as const;
