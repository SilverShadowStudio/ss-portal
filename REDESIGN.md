# Redesign conventions — dark-only layered look

The rules every page must follow as it is brought into the new design. **Styling
only** — never change content, data, wiring, routing, or font sizes. Roll out one
page at a time, each reviewed on a Vercel preview before merge.

## The three tiers (mandatory on every page)

Fred's naming. Every page is built from exactly these nested levels, always all
three — data is never allowed to sit loose on a Section:

- **(backdrop) Ground + sidebar** — one uniform `#1b1b1b` (dark `--background`
  and `--sidebar-background`). No vertical divider on the sidebar.
- **1 · Page** — the gradient panel holding all page content, with the page
  name eyebrow at the top. Layout `panel` prop → `.ssr-panel`. Violet gradient
  `#352d42 → #3c2e4f → #201b1f → #17151a`, rounded, soft float shadow, **no
  highlight rim**, left edge flush to the sidebar.
- **2 · Section** — a brighter zone grouping related information; one per group.
  `.ssr-zone`, tone only (no border, no highlight), each with a gold-hairline +
  `text-label` title.
- **3 · Tile** — the darker zone that **every** individual piece of information
  or data lives in, *inside* a Section. `.ssr-tile` — translucent dark composited
  over the Page gradient, bevelled. **Data always goes in a Tile, never loose on
  a Section.**

## Rules

1. **Every zone/card has a title** — a gold hairline (`h-px w-6 bg-gold-muted`) +
   an uppercase `text-label` heading. Examples: At a Glance · Activity Log ·
   Quick Actions · Connections.
2. **Page name (eyebrow)** sits centred between the panel top and the first card:
   panel `padding-top` == the eyebrow's bottom margin (currently 32px). This is
   set on `.ssr-panel`, so it is inherited by every panel page.
3. **Gold** = `#d3b47c` (the `--gold` token). Bright accents — the page-name
   eyebrow and accent chips — use `#ecd39c`.
4. **Accent chips and action buttons** use the gold-fill treatment: `bg-gold/20`,
   text `#ecd39c`, **no border trim**, rounded — identical to the CLIENT badge in
   the activity log. Never leave a highlight/button grey.
5. **Dark-only.** Light mode is removed; do not reintroduce a theme toggle.
6. **Fonts and sizes never change** from the live app's existing type scale
   (Cinzel `text-4xl` metric numbers, `text-label` 12px, nav 11px, etc.).

## Scope notes

- The redesign classes are all prefixed `.ssr-*` and additive — they touch
  nothing outside their selectors.
- `--gold` and the two background tokens are global (all pages), which is
  intentional for a consistent dark-only look.
- The shared `<Button>` default is unchanged; gold-fill is applied per-instance
  until/unless a global button restyle is decided.
