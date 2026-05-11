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
- **Deploy**: Vercel auto-deploys on push to `main` via SSH from Mac Pro

## Stack

- React 18 + TypeScript + Vite 5
- Tailwind CSS 3
- Framer Motion (animations)
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Vercel (hosting)
- Dropbox API (render delivery)
- Airtable API (Kieran's production tracker)

## Supabase

- Project ID: `oodhsoiwnqxcimzmzick`
- URL: `https://oodhsoiwnqxcimzmzick.supabase.co`
- Owned by Fred's personal Supabase account (fred@silvershadowstudio.com)
- Access token: stored in your password manager (Supabase dashboard → Account → Access tokens)
- Deploy edge functions: `SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt`
- Connection hardcoded directly in `src/integrations/supabase/client.ts` (Vercel env vars not used)

## Key environment variables (Vercel)

```
VITE_SUPABASE_URL=https://oodhsoiwnqxcimzmzick.supabase.co
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

SSH keys are configured on the Mac Pro — `git push` works without a password prompt.

## Project structure

```
src/
  pages/
    Index.tsx              # Client dashboard — focused single-state view (what needs attention now)
    Portfolio.tsx          # Client portfolio — projects + scenes
    Timeline.tsx           # Client timeline / Gantt
    Delivery.tsx           # Client delivery page
    Orders.tsx             # Client orders confirmation
    Documents.tsx          # Client documents hub (agreement + invoices)
    Contract.tsx           # Client agreement signing
    Auth.tsx               # Login page
    admin/
      AdminDashboard.tsx   # Admin studio overview — Dropbox + Airtable status strips, activity log
      AdminClients.tsx     # Client management — ghost mode, Dropbox/Airtable connection status, last 10 sessions
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
    GhostModeBanner.tsx    # Banner shown when admin is viewing as a client (fixed layout — no sidebar shift)

    admin/
      DropboxVisualsPanel.tsx      # Scans Dropbox VS_Visuals folder for a scene, shows highest version per round
      DropboxConnectionStatus.tsx  # Dropbox connected/disconnected strip with relative time
      AirtableConnectionStatus.tsx # Airtable connected/error strip — shows record count + cache time
      AirtableSyncPanel.tsx        # Push/pull Airtable sync per scene
      ClientActivityPanel.tsx      # Client session history
      SceneCard.tsx                # Scene summary card
      InvoiceFormDialog.tsx        # Create invoice dialog
      AssetUploader.tsx            # Upload renders to Supabase storage

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
      client.ts            # Supabase client — values hardcoded, exports SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
      types.ts             # Generated database types

supabase/
  functions/               # Deno edge functions
    dropbox-oauth-start/   # Initiates Dropbox OAuth
    dropbox-oauth-callback/ # Handles Dropbox OAuth callback — redirects to portal.silvershadowstudio.com
    dropbox-api/           # get-thumbnail, get-temporary-link, connection-status
    dropbox-webhook/       # Auto-sync on Dropbox file changes
    dropbox-scan-visuals/  # Scans VS_Visuals folder, returns highest version per round
    airtable-sync/         # Bidirectional Airtable sync (push-scene, push-status, pull-status, get-config, set-config, get-fields, probe-records)
    airtable-list-models/  # Lists all rows from the Models table (cached, admin-only)
    accept-agreement/      # Sign client agreement, generate PDF
    admin-create-client/   # Create client account + send invite or provision
    admin-impersonate-client/ # Ghost mode token
    download-invoice-pdf/  # Generate invoice PDF
    send-transactional-email/ # Email sending

  migrations/              # Applied in filename order via Supabase Management API
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
| `scene_rounds` | Rounds per scene (status: `pending`, `in_production`, `client_review`, `awaiting_review`, `approved`, `delivered`; also has `delivery_due_at`) |
| `round_assets` | Render files per round (Supabase storage or Dropbox path) |
| `lane_tasks` | Subscription lane tasks (delivery_status: `in_production`, `delivered`) |
| `subscriptions` | Lane subscriptions |
| `orders` | Project orders (status: `pending_acceptance`, `accepted`, etc.) |
| `invoices` | Invoices |
| `agreements` | Signed client agreements |
| `dropbox_connections` | Dropbox OAuth tokens |
| `client_activity` | Session tracking (kind: `session_start`, `session_end`) |
| `app_settings` | Key-value config store — `airtable_field_config` key holds Airtable field mapping |
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

## Airtable sync

Kieran's production tracker lives in Airtable. The portal syncs bidirectionally via the `airtable-sync` edge function.

**Base ID**: `appyidJqOmdNB8WUd`
**Table**: `Tasks` (table ID `tbleHaU9DxHyvixdL`)

**Field mapping** (stored in `app_settings.airtable_field_config`, editable via set-config):

| Config key | Airtable field | Notes |
|---|---|---|
| `field_scene_name` | `Task name` | Primary field (singleLineText) |
| `field_status` | `Status` | singleSelect with emoji-prefixed values |
| `field_delivery_date` | `Deadline` | dateTime → stored as `scene_rounds.delivery_due_at` |
| `field_project_name` | _(blank)_ | Linked records — not writable as text |
| `field_portal_scene_id` | _(blank)_ | No free-text ID field exists; portal stores Airtable record ID in `scenes.airtable_record_id` |

**Status values** — actual Airtable single-select options have emoji prefixes. Pull matching uses substring so the logic is resilient to emoji changes:

| Airtable value | Portal status |
|---|---|
| `🔴 TO DO` | `pending` |
| `🟡 IN PROGRESS` | `in_production` |
| `🔵 REVIEW` | `awaiting_review` |
| `🟢 DONE` | `approved` |

**Actions on `airtable-sync`**:
- `push-scene` — creates/updates a Task row in Airtable, stores returned record ID in `scenes.airtable_record_id`
- `push-status` — writes portal round status to Airtable (maps to emoji value)
- `pull-status` — reads Status + Deadline from Airtable, updates `scene_rounds.status` and `scene_rounds.delivery_due_at`
- `get-config` / `set-config` — read/write the field mapping from `app_settings`
- `get-fields` — calls Airtable metadata API, returns all tables + field names (useful for debugging)
- `probe-records` — fetches raw records from the configured table (useful for inspecting actual field values)

The `airtable-list-models` function is separate — it reads from the **Models** table (`tbls6j4jyNifFyucU`), not Tasks. Used by the admin Production Tracker table.

**Verified**: push-scene + pull-status round-trip confirmed working (record `recCTevx1HCoPQqA1` created for "Entrance" scene, `🔴 TO DO` → `pending` mapped correctly).

## Ghost mode

Admin can view the portal as any client. Enter via:
- Clients page — click the ghost icon on the left of each client row
- `enterGhostMode({ userId, name })` from AuthContext

Ghost mode banner renders above the client layout without shifting the sidebar (fixed positioning).

## Vercel routing

`vercel.json` has a catch-all rewrite so all routes serve `index.html` (required for client-side React Router):
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

## Known pending issues

- Email provider not configured — `send-transactional-email` uses a `LOVABLE_API_KEY` that is no longer valid. Delivery notifications and client invitations will not send. Needs Resend or similar wired in.
- Stripe not configured — `STRIPE_SECRET_KEY` not set; invoice checkout won't work.

## Clients in database

| Company | Contact | account_id |
|---------|---------|-----------|
| Lürssen (Aqualuce Limited) | John Roberts | dd85fe7a-1117-4379-b3f6-9ffef651f081 |
| Winch Design | Simon Tomlinson | 7880c015-84ce-4273-8815-c97b9f74a74a |
| Bergman Design House | Marie Soliman | (check DB) |
| Silvershadow Studio | Fred Colomb | a09b2cdd-2c98-4415-a58d-ec6420d69bd6 |
