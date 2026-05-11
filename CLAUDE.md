# Silvershadow Studio — Client Portal (ss-portal)

## What this is

A dual-portal web application for Silvershadow Studio, a London-based CGI and architectural visualisation studio. Two user types:

- **Admin** (Fred + studio team) — manage clients, projects, scenes, rounds, invoices, orders, Dropbox sync
- **Client** (design studios) — view renders, submit corrections, approve rounds, sign agreements, confirm orders

Two commercial models:
- **Partnership/Subscription** — Lane-based (dedicated production capacity, monthly subscription)
- **Project** — Per-quotation, per-scene delivery

## Live

- **URL**: https://portal.silvershadowstudio.com
- **Repo**: github.com/SilverShadowStudio/ss-portal (private)
- **Deploy**: Vercel auto-deploys on push to `main` via SSH

## Stack

- React 18 + TypeScript + Vite 5
- Tailwind CSS 3
- Framer Motion (animations)
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Vercel (hosting)
- Dropbox API (render delivery)
- Airtable API (Kieran's production tracker)

## Supabase

- Project ID: `mapbrwcrldfofoxzywkn`
- URL: `https://mapbrwcrldfofoxzywkn.supabase.co`
- Owned by Lovable's account — access via Lovable Cloud panel or Lovable SQL editor
- Anon key in Vercel environment variables as `VITE_SUPABASE_PUBLISHABLE_KEY`

## Key environment variables (Vercel)

```
VITE_SUPABASE_URL=https://mapbrwcrldfofoxzywkn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGci...
```

## Git / Deploy workflow

```bash
cd ~/code/ss-portal
# make changes
git add .
git commit -m "description"
git push origin main
# Vercel deploys automatically in ~30s
```

**Critical**: Do NOT add co-author lines to commits. They cause Vercel to reject deployments. Set git identity:
```bash
git config user.name "Fred Colomb"
git config user.email "fred@silvershadowstudio.com"
```

## Project structure

```
src/
  pages/
    Index.tsx              # Client dashboard — single focused state (what needs attention now)
    Portfolio.tsx          # Client portfolio — projects + scenes
    Timeline.tsx           # Client timeline / Gantt
    Delivery.tsx           # Client delivery page
    Orders.tsx             # Client orders confirmation
    Documents.tsx          # Client documents hub (agreement + invoices)
    Contract.tsx           # Client agreement signing
    Auth.tsx               # Login page
    admin/
      AdminDashboard.tsx   # Admin studio overview
      AdminClients.tsx     # Client management — ghost mode, connections, last 10 sessions
      AdminProjects.tsx    # Project + scene + round management (main admin workhorse)
      AdminOrders.tsx      # Create and manage orders
      AdminScenes.tsx      # Scene management
      AdminFinance.tsx     # Invoices and finance
      AdminTimeline.tsx    # Production timeline
      AdminBatchUpload.tsx # Bulk render upload

  components/
    AdminSidebar.tsx       # Admin sidebar — text-only nav, hover-reveal account menu
    ClientSidebar.tsx      # Client sidebar — mirrors admin structure exactly
                           # Main nav: Portfolio / Timeline / Deliveries
                           # Account hover menu: Overview / Orders / --- / Documents / Settings / --- / Expand / Theme / --- / Logout
    AdminLayout.tsx        # Admin page wrapper
    ClientLayout.tsx       # Client page wrapper
    GhostModeBanner.tsx    # Banner shown when admin is viewing as a client

    admin/
      DropboxVisualsPanel.tsx   # Scans Dropbox VS_Visuals folder for a scene, shows highest version per round
      DropboxConnectionStatus.tsx # Dropbox connected/disconnected status with relative time
      AirtableSyncPanel.tsx     # Push/pull Airtable sync per scene
      ClientActivityPanel.tsx   # Client session history
      SceneCard.tsx             # Scene summary card
      InvoiceFormDialog.tsx     # Create invoice dialog
      AssetUploader.tsx         # Upload renders to Supabase storage

    client/
      TaskDetail.tsx       # Round detail view — upload zone, Dropbox panel, Airtable panel
                           # Props: roundId, sceneId, projectId, isAdmin, onUploaded
      AssetViewer.tsx      # Full render viewer with pin/annotation tools
      PinChat.tsx          # Per-pin comment thread (Miro replacement)
      LaneCard.tsx         # Subscription lane card

    ui/
      SmartImage.tsx       # Image with Dropbox temporary link support

  lib/
    design.ts              # SHARED DESIGN CONSTANTS — import from here, never hardcode
                           # Used by both sidebars and all components
                           # Contains: LABEL, PAGE, BORDER, SURFACE, STATUS, BTN, RADIUS, SIDEBAR, TRANSITION, GLOW
    agreementTerms.ts      # Client Agreement v2.0 content (SSS-CA-v2.0)
    activityLog.ts         # Logging helper
    reviewWindow.ts        # Deliver round and start review window

  contexts/
    AuthContext.tsx        # Auth + ghost mode. enterGhostMode({ userId, name })

  integrations/
    supabase/
      client.ts            # Supabase client
      types.ts             # Generated database types

supabase/
  functions/               # Deno edge functions
    dropbox-oauth-start/   # Initiates Dropbox OAuth
    dropbox-oauth-callback/ # Handles Dropbox OAuth callback
    dropbox-api/           # get-thumbnail, get-temporary-link
    dropbox-webhook/       # Auto-sync on Dropbox file changes
    dropbox-scan-visuals/  # Scans VS_Visuals folder, returns highest version per round
    airtable-sync/         # Bidirectional Airtable sync (push-scene, pull-status, get-config, set-config)
    accept-agreement/      # Sign client agreement, generate PDF
    admin-create-client/   # Create client account + send invite or provision
    admin-impersonate-client/ # Ghost mode token
    download-invoice-pdf/  # Generate invoice PDF
    send-transactional-email/ # Email sending

  migrations/              # Run in Lovable SQL editor, in filename order
```

## Design system

### Colours (CSS variables in src/index.css)
- Background: `hsl(240 5% 9%)` = `#151517` (cool near-neutral dark)
- Sidebar: `hsl(240 5% 7%)` (slightly darker)
- Gold: `hsl(36 35% 57%)` via `--gold`
- All colours via CSS variables — never hardcode hex

### Typography
- Headings: Cinzel (serif), `font-serif`
- Body/UI: Arial/sans, `font-sans`
- Nav labels: 11px uppercase, tracking-[0.24em]
- Eyebrow labels: 9px uppercase, tracking-[0.28em], text-foreground/40

### Rules
- No rounded-full buttons
- No bullet points in UI copy
- No emojis
- No bold in prose
- Gold used only for active states and key highlights
- Sharp rectangular components (rounded-sm at most)

### Shared constants
Import from `src/lib/design.ts` for any magic value. Both sidebars import from it.

## Database key tables

| Table | Purpose |
|-------|---------|
| `accounts` | Client accounts |
| `account_members` | User ↔ account links |
| `projects` | Projects (has `project_code`, `project_slug`) |
| `scenes` | Scenes (has `scene_code`, `scene_slug`, `airtable_record_id`) |
| `scene_rounds` | Rounds per scene (status: `in_production`, `client_review`, `awaiting_review`, `approved`) |
| `round_assets` | Render files per round (Supabase storage or Dropbox path) |
| `lane_tasks` | Subscription lane tasks (delivery_status: `in_production`, `delivered`) |
| `subscriptions` | Lane subscriptions |
| `orders` | Project orders (status: `pending_acceptance`, `accepted`, etc.) |
| `invoices` | Invoices |
| `agreements` | Signed client agreements |
| `dropbox_connections` | Dropbox OAuth tokens |
| `client_activity` | Session tracking (kind: `session_start`, `session_end`) |
| `app_settings` | Key-value config store (Airtable field mappings etc.) |
| `user_roles` | Admin role assignments |

## Dropbox file naming convention

```
/00_Production/PRD01_Client-Projects/CP107_Charles-Street/SC05_Facade/VS_Visuals/
CP107-SC05-VS_R01_01.jpg
  CP107 = project_code (on projects table)
  SC05  = scene_code (on scenes table)
  VS    = visual type (portal only shows VS files)
  R01   = round number
  01    = version (app shows highest version per round)
```

Set `project_code`, `project_slug`, `scene_code`, `scene_slug` on each project/scene via the DropboxVisualsPanel on the round detail page.

## Ghost mode

Admin can view the portal as any client. Enter via:
- Clients page — click the ghost icon circle on the left of each client row
- `enterGhostMode({ userId, name })` from AuthContext

## Known pending issues

- DropboxVisualsPanel not rendering on round page — investigate TaskDetail.tsx, confirm isAdmin/sceneId/projectId are truthy at runtime
- Airtable sync needs Kieran's field names (scenes table name, status values, delivery date field)
- Two migrations still need running if not already applied:
  - `20260510000001_airtable_sync.sql`
  - `20260510000002_production_codes.sql`
- Debug line in TaskDetail.tsx showing isAdmin/sceneId/projectId — remove once Dropbox panel issue resolved

## Clients in database

| Company | Contact | account_id |
|---------|---------|-----------|
| Lürssen (Aqualuce Limited) | John Roberts | dd85fe7a-1117-4379-b3f6-9ffef651f081 |
| Winch Design | Simon Tomlinson | 7880c015-84ce-4273-8815-c97b9f74a74a |
| Bergman Design House | Marie Soliman | (check DB) |
| Silvershadow Studio | Fred Colomb | a09b2cdd-2c98-4415-a58d-ec6420d69bd6 |
