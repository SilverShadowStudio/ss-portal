# Handoff: Production Timeline (Schedule / Gantt view)

## Overview
A studio production schedule rendered as a horizontally-scrolling Gantt timeline, styled to match the **Silvershadow Studio** dark/gold admin portal. It shows projects → scenes laid out against a weekday calendar (19 May → 24 July 2025), with colored bars marking **Production** and **Feedback** phases per scene. It is intended to live as the **Timeline** view inside the existing Silvershadow portal (same sidebar, same visual language as the Overview screen).

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing the intended look and behavior, **not production code to copy directly**. The HTML is a "Design Component" (`.dc.html`) that uses a small custom template runtime (`support.js`); **do not ship that runtime**. Your task is to **recreate this design in the target codebase's existing environment** (React, Vue, etc.) using its established components, design tokens, and patterns. If the portal already has a sidebar/layout shell, reuse it and build only the timeline content area.

Read `Production Timeline.dc.html` for exact values: the markup between `<x-dc>`…`</x-dc>` is the layout (inline styles), and the `<script data-dc-script>` class holds the data + the logic that computes bar positions. Everything you need is there; this README summarizes it.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and layout. Recreate pixel-accurately using the codebase's existing libraries. The bar-positioning math (below) should be reproduced exactly so bars land on the right dates.

---

## Screens / Views

### Timeline (single view)
- **Purpose**: Studio admin scans which scenes are in production vs. feedback across the summer, grouped by project.
- **Top-level layout**: full-height flex row.
  - **Sidebar**: `288px` fixed width, full height. (Reuse the existing portal sidebar — `Timeline` nav item is the active one: gold `2px` left bar + cream text `#ece6da`; inactive items are muted `#9a9082` / sub-items `#7d756a`.)
  - **Main**: `flex:1`, vertical scroll, padding `40px 48px 64px`.

#### Main content, top to bottom
1. **Eyebrow** — gold `36px × 1px` rule + label `PRODUCTION TIMELINE`, `12px / 500`, letter-spacing `3.5px`, color `#c5a572`.
2. **Title** — `Summer Production Schedule`, Cormorant Garamond `42px / 500`, line-height `1.1`, color `#ece6da`.
3. **Subtitle** — `19 May — 24 July 2025 · 14 scenes · 3 projects`, `13px`, letter-spacing `1px`, color `#8c8478`, margin-top `12px`.
4. **Legend** — flex row, gap `26px`, margin-top `26px`:
   - Production swatch `15×15`, radius `4`, `#4f6c99` + label `PRODUCTION`.
   - Feedback swatch `15×15`, radius `4`, `#a8493c` + label `FEEDBACK`.
   - vertical divider `1×18`, `rgba(197,165,114,0.16)`.
   - Manager dots (`7px` circle) + names: Katerina `#8a76ad`, Fiodor `#4f9aa3`, May `#b0604f`.
   - Legend labels: `11px / 500`, letter-spacing `2px` (phases) / `1.5px` (managers), uppercase, color `#a89e8c`.
5. **Schedule card** — see below.

---

## The Schedule Card (the core component)

Container: `background:#14110d; border:1px solid rgba(197,165,114,0.13); border-radius:16px; overflow:hidden; margin-top:28px`.
Inside it: a single **horizontal scroll** region (`overflow-x:auto; overflow-y:hidden`) wrapping a content block of fixed width **`2046px`** (= `380px` frozen left columns + `1666px` timeline track).

### Geometry constants (reproduce exactly)
- `CELL_W = 34px` — width of one weekday column.
- `N_DAYS = 49` — weekday columns. Track width = `49 × 34 = 1666px`.
- Frozen left zone = `380px` total: **Scene** column `248px` + **Manager** column `132px`.
- Header row height `132px`; group header row `46px`; scene row `38px`.
- A bar/cell's `left = startColumnIndex × 34`. A span of `n` columns has `width = n × 34 − 3` (the `−3` is a gutter).

### Frozen left columns (`position: sticky; left: 0`)
Every row's left block is `position:sticky; left:0` so it stays pinned while the track scrolls horizontally. Give it a solid background to cover scrolling content and a right border `1px solid rgba(197,165,114,0.16)`. Z-index order: header left `7`, group header left `6`, scene-row left `5`.

- **Header left block** (`132px` tall, bg `#171410`): bottom-aligned labels `SCENE` (at `padding-left:34px`, width `248px`) and `MANAGER` (width `132px`) — `11px / 500`, letter-spacing `2.5px`, uppercase, `#8c8478`.
- **Group header left block** (`46px`, bg `#1a1611`): project code in Cormorant `16px / 600` `#d8c39a` + place name Cormorant `15px / 400` `#a89c86`, gap `12px`, padding-left `22px`.
- **Scene-row left block** (`38px`, bg `#14110d`, bottom border `1px solid rgba(197,165,114,0.05)`):
  - Scene name: width `248px`, padding-left `34px`, `12.5px`, color `#cfc7b8`, ellipsis-truncated.
  - Manager: width `132px`, flex row gap `8px` — `7px` colored dot + name `10px / 500`, letter-spacing `1.5px`, uppercase, `#a89e8c`.

### Date header track (`1666px`, flex row of 49 cells)
Each day cell: `width:34px; height:132px`, bottom-aligned, right border `1px solid rgba(197,165,114,0.05)`. **Mondays** get an extra left border `1px solid rgba(197,165,114,0.14)`.
Label inside: **vertical text**, `writing-mode:vertical-rl; transform:rotate(180deg)` (reads bottom-to-top), `10px / 500`, letter-spacing `0.8px`. Mondays colored `#c7a06a` (gold); other days `#8c8478`. Label format: `Mon 19 May`.

The 49 weekdays are generated from **Mon 19 May 2025**, stepping one day, keeping only Mon–Fri, until 49 collected (ends **Thu 24 Jul 2025** — note the last week is partial: Mon 21 – Thu 24 Jul).

### Group header row (track side)
`46px` tall, bg `#1a1611`, padding `0 24px`, containing a `1px` horizontal line with `background:linear-gradient(90deg, rgba(197,165,114,0.20), rgba(197,165,114,0))`.

### Scene row (track side) — the Gantt lane
`position:relative; width:1666px; height:38px`, bottom border `1px solid rgba(197,165,114,0.05)`.
**Grid background** = two stacked repeating gradients:
```css
background-image:
  repeating-linear-gradient(90deg, rgba(197,165,114,0.035) 0 1px, transparent 1px 34px),   /* day lines */
  repeating-linear-gradient(90deg, rgba(197,165,114,0.09)  0 1px, transparent 1px 170px);   /* week lines (5×34) */
```
Bars are **absolutely positioned** children of this lane. Three bar kinds:

| Kind | Purpose | Style |
|---|---|---|
| **band** | phase duration | `top:5px; height:28px; border-radius:5px; z-index:1; left/width per geometry; background:` translucent phase color |
| **cell** | milestone marker (carries the round number) | `top:5px; height:28px; width:31px; border-radius:5px; z-index:3;` solid phase color; flex-centered number, text `#f4efe5`, `13px / 600`; `box-shadow:0 1px 4px rgba(0,0,0,0.35)` |
| **label** | phase name text | `top:12px; z-index:4; left = col×34 + 6;` `9px / 600`, letter-spacing `1.5px`, uppercase, lightened phase color, `white-space:nowrap` |

Production band bg = production color at **alpha 0.20**; feedback band bg = feedback color at **alpha 0.18**. Label colors = phase color **lightened 50% toward white**.

---

## Data model

Three projects → scenes. `manager` drives the dot color. Each scene carries a list of timeline segments.

```
C88 — Walnut Street  (manager: Katerina, dot #8a76ad)
  01 — Kitchen (OWE 1 Round)   round 3, no feedback band
  02 — Garden Room             round 2, with feedback band
  03 — Dining Room             round 2, with feedback band
  04 — Entrance                round 3, no feedback band
  05 — Drawing Room            round 2, with feedback band

C101 — Bleecker Street  (manager: Fiodor, dot #4f9aa3)
  01 — Facade A   (segments)
  02 — Facade B   (segments)
  03 — Facade C   (empty — no segments)
  04 — Entrance   (empty — no segments)

C104 — Ottawa  (manager: May, dot #b0604f)
  01 — Goldenrod Driveway
  02 — Block 5 Courtyard
  03 — Boulevard Street
  04 — River View
  05 — Aerial
  (all five share the same segment pattern)
```

### Segment patterns (column indices are 0-based into the 49 weekdays)
Helpers: `band(startCol, spanCols, color)`, `cell(startCol, number, color)`, `label(startCol, text, color)`.

**C88 scene** `(num, hasFeedback)`:
- `band(1, 19, productionBand)` — production duration
- `cell(1, num, production)` — production milestone
- `label(2, "Production", productionLabel)`
- `cell(20, num, feedback)` — feedback milestone 1
- `cell(25, num, feedback)` — feedback milestone 2
- if `hasFeedback`: `band(26, 13, feedbackBand)` + `label(26, "Feedback", feedbackLabel)`

**C101 scene** (Facade A & B only; C & Entrance are empty):
- `cell(16, 1, production)`
- `label(17, "Production", productionLabel)`
- `cell(19, 1, feedback)`
- `band(20, 18, feedbackBand)`
- `label(20, "Feedback", feedbackLabel)`

**C104 scene** (all five):
- `band(9, 3, productionBand)`, `cell(9, 1, production)`, `label(10, "Production", productionLabel)`
- `cell(12, 1, feedback)`, `band(13, 17, feedbackBand)`, `label(13, "Feedback", feedbackLabel)`
- `band(30, 18, productionBand)`, `cell(30, 2, production)`, `label(31, "Production", productionLabel)`
- `cell(48, 2, feedback)`

---

## Interactions & Behavior
- **Horizontal scroll** on the timeline track; frozen Scene/Manager columns stay pinned (`position: sticky; left:0`). The date header scrolls in sync because it shares the same scroll container.
- **Vertical scroll** is the page/main area.
- No animations, no hover states in the current design (static read-only schedule). If you add interactivity, natural extensions: hover a bar → tooltip with phase + dates; click a scene → detail. Not specified here.
- Custom scrollbar styling (WebKit): track `#0c0a08`, thumb `#2c2620` (radius 6, 2px track-color border), hover `#3c352b`.

## State Management
Read-only render of static data. Needed inputs: the projects/scenes/segments array and the generated date list. The only configurable knobs (exposed as tweaks in the prototype) — make these props/theme values:
- `productionColor` (default `#4f6c99`)
- `feedbackColor` (default `#a8493c`)
- `showPhaseLabels` (default `true`) — toggles the in-bar "Production"/"Feedback" text labels.
Band colors and label colors are **derived** from the two base colors (alpha 0.20 / 0.18 for bands; +50% lightness toward white for labels) — don't hardcode them separately.

## Design Tokens
**Colors**
- Canvas / page bg: `#0c0a08`
- Card bg: `#14110d`
- Sticky header bg: `#171410`; group header bg: `#1a1611`
- Gold accent: `#c5a572`; gold tints used in lines: `rgba(197,165,114, 0.05 / 0.09 / 0.10 / 0.13 / 0.14 / 0.16 / 0.20)`
- Text: primary `#ece6da`, secondary `#cfc7b8`, muted `#a89e8c` / `#8c8478`, faint `#7d756a` / `#6a6258`
- Cormorant headings: `#d8c39a` (codes), serif logo `#ece6da`
- Production `#4f6c99`; Feedback `#a8493c`
- Manager dots: Katerina `#8a76ad`, Fiodor `#4f9aa3`, May `#b0604f`; badge gold `#c5a572` on `#1a140a`

**Typography**
- Display / serif: **Cormorant Garamond** (logo, headings, project codes) — weights 400/500/600.
- UI / sans: **Jost** — weights 300/400/500/600. Labels are uppercase with letter-spacing `1.5–3.5px`.
- Scale: title `42px`, section serif `15–16px`, body `12.5–13px`, labels `9–11px`.

**Spacing / radius / shadow**
- Cell width `34px`; left zone `380px` (`248 + 132`); content width `2046px`.
- Row heights: header `132`, group `46`, scene `38`; bars `28` tall at `top:5`.
- Radii: card `16`, bars `5`, swatches `4`.
- Bar shadow: `0 1px 4px rgba(0,0,0,0.35)`.

## Assets
None — no images or icon files. Sidebar icons in the wider portal (if any) come from the existing app. Fonts load from Google Fonts (Cormorant Garamond + Jost); swap to the codebase's font loading if it self-hosts.

## Files
- `Production Timeline.dc.html` — the design reference (layout in the `<x-dc>` template, data + positioning logic in the script class).
- `support.js` — the prototype's template runtime. **Reference only; do not ship.**
