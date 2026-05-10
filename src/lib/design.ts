/**
 * Silvershadow Studio — Shared Design Constants
 *
 * Single source of truth for every styling decision that must be
 * consistent across the client portal and the admin panel.
 *
 * Rules:
 * - Colours reference CSS variables only (never hardcoded hex).
 * - Sizes are in Tailwind classes where possible, raw px/rem otherwise.
 * - Any change here automatically affects both sides.
 */

// ── Typography ────────────────────────────────────────────────────────────────

export const FONT = {
  serif:      "font-serif",
  sans:       "font-sans",
} as const;

export const LABEL = {
  // 9px uppercase, wide tracking, muted — used for section eyebrows everywhere
  eyebrow:    "font-sans text-[9px] uppercase tracking-[0.28em] text-foreground/40",
  // 10px uppercase, moderate tracking — used for button text
  button:     "font-sans text-[10px] uppercase tracking-[0.26em]",
  // 11px regular — used for secondary metadata
  meta:       "font-sans text-[11px] text-foreground/40",
} as const;

// ── Spacing ───────────────────────────────────────────────────────────────────

export const PAGE = {
  // Standard page padding (desktop)
  paddingX:   "px-8 md:px-12",
  // Top padding below header
  paddingTop: "pt-10",
  // Max content width
  maxWidth:   "max-w-5xl",
} as const;

// ── Borders and separators ────────────────────────────────────────────────────

export const BORDER = {
  // Standard card/section border
  default:    "border border-border/60",
  // Subtle row separator
  row:        "border-t border-border/30",
  // Gold accent border
  gold:       "border border-gold/40",
} as const;

// ── Surface backgrounds ───────────────────────────────────────────────────────

export const SURFACE = {
  // Default card — slightly above background
  card:       "bg-card",
  // Hover state on rows
  rowHover:   "hover:bg-foreground/[0.03] transition-colors",
  // Active/selected state
  active:     "bg-foreground/[0.05]",
  // Muted secondary surface
  muted:      "bg-muted/40",
} as const;

// ── Status dots ───────────────────────────────────────────────────────────────

export const STATUS = {
  active:     "bg-emerald-500",
  warning:    "bg-amber-400",
  error:      "bg-red-500",
  muted:      "bg-foreground/20",
  gold:       "bg-gold",
} as const;

// ── Button styles ─────────────────────────────────────────────────────────────

export const BTN = {
  // Primary filled button
  primary:    "bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-40 transition-opacity",
  // Ghost/text button
  ghost:      "font-sans uppercase text-foreground/40 hover:text-foreground transition-colors",
  // Destructive
  danger:     "font-sans uppercase text-destructive hover:text-destructive/80 transition-colors",
  // Standard height
  height:     "h-[42px]",
  // Standard padding
  paddingX:   "px-6",
} as const;

// ── Radius ────────────────────────────────────────────────────────────────────

export const RADIUS = {
  // We never use rounded-full on buttons. All rounded corners are subtle.
  sm:   "rounded-sm",    // 2px
  md:   "rounded",       // 4px
  card: "rounded-sm",    // cards use minimal radius
} as const;

// ── Sidebar ───────────────────────────────────────────────────────────────────

export const SIDEBAR = {
  // Nav item text — inactive
  navInactive:  "font-sans uppercase text-[9px] tracking-[0.22em] text-foreground/35",
  // Nav item text — active
  navActive:    "font-sans uppercase text-[9px] tracking-[0.22em] text-gold",
  // Icon size in nav
  iconSize:     { width: 20, height: 20 } as React.CSSProperties,
  // Bottom account area
  accountText:  "font-sans text-[10px] uppercase tracking-[0.18em] text-foreground/40",
} as const;

// ── Transitions ───────────────────────────────────────────────────────────────

export const TRANSITION = {
  default:  "transition-all duration-200",
  fast:     "transition-all duration-100",
  colors:   "transition-colors duration-200",
} as const;

// ── Gold ambient glow (used on delivery page) ─────────────────────────────────

export const GLOW = {
  gold:  "radial-gradient(ellipse 60% 40% at 50% 100%, hsl(var(--gold) / 0.12) 0%, transparent 70%)",
  green: "radial-gradient(ellipse 60% 40% at 50% 100%, hsl(142 71% 45% / 0.08) 0%, transparent 70%)",
} as const;
