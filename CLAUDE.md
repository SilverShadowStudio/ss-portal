# Silvershadow Studio — Client Portal (ss-portal)

## What this is

A dual-portal web application for Silvershadow Studio, a London-based CGI and architectural visualisation studio. Two user types:

- **Admin** (Fred + studio team) — manage clients, projects, scenes, rounds, invoices, orders, Dropbox sync
- **Client** (design studios) — view renders, submit corrections, approve rounds, sign agreements, confirm orders

Two commercial models:
- **Partnership/Subscription** — Lane-based (dedicated production capacity, monthly subscription)
- **Project** — Per-quotation, per-scene delivery

## Architecture decisions

- **Softr** stays for Kieran's internal production portal — do not touch it
- **Airtable** stays as Kieran's source of truth — the portal syncs to it, never replaces it
- Two portals: client-facing (this repo) + production (Kieran's Softr)
- Supabase is owned by Fred's personal account — no dependency on Lovable

## Live

- **URL**: https://portal.silvershadowstudio.com
- **Repo**: github.com/SilverShadowStudio/ss-portal (private)
- **Deploy**: Vercel auto-deploys on push to `main` (~30s)

## Stack

- React 18 + TypeScript + Vite 5
- Tailwind CSS 3
- Framer Motion (animations)
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Vercel (hosting)
- Dropbox API (render delivery)
- Airtable API (Kieran's production tracker)

## Supabase

- **Project ID**: `oodhsoiwnqxcimzmzick`
- **URL**: `https://oodhsoiwnqxcimzmzick.supabase.co`
- Owned by Fred's personal Supabase account (fred@silvershadowstudio.com)
- Access token: stored in your password manager (Supabase dashboard → Account → Access tokens)
- Deploy edge functions: `SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt`
- Connection is hardcoded in `src/integrations/supabase/client.ts` — Vercel env vars are not used (they were previously injected by Lovable's integration and caused conflicts)

## Git / Deploy workflow

```bash
cd ~/code/ss-portal
git add .
git commit -m "description"
git push origin main
# Vercel deploys automatically
```

**Critical — no co-author lines**: Co-author trailer lines in commits cause Vercel to reject deployments. Never use `--co-author` or Claude's default co-author footer.

**Git identity must be set**:
```bash
git config user.name "Fred Colomb"
git config user.email "fred@silvershadowstudio.com"
```

**SSH keys**: Configured on both machines — push works without a password prompt.
- Mac Pro: `fc1` (primary dev machine, `/Users/fc1/code/ss-portal`)
- MacBook: `fc2`

## Vercel routing

`vercel.json` at repo root has a catch-all rewrite for React Router (SPA):
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Without this, direct URL navigation (e.g. `/admin/clients`) returns 404.

## Project structure

```
src/
  pages/
    Index.tsx              # Client dashboard — single state machine (see below)
    Portfolio.tsx          # Client portfolio — projects + scenes
    Timeline.tsx           # Client timeline / Gantt
    Delivery.tsx           # Client delivery page
    Orders.tsx             # Client orders confirmation (Uber-style flow)
    Documents.tsx          # Client documents hub (agreement + invoices)
    Contract.tsx           # Client agreement signing (SSS-CA-v2.0)
    Auth.tsx               # Login page
    admin/
      AdminDashboard.tsx   # Admin studio overview — Dropbox + Airtable status strips, activity log
      AdminClients.tsx     # Client management — ghost circle left, clock/connections right,
                           #   last 10 sessions with start/end/duration
      AdminProjects.tsx    # Project + scene + round management (main admin workhorse)
      AdminOrders.tsx      # Create and manage orders
      AdminScenes.tsx      # Scene management
      AdminFinance.tsx     # Invoices and finance
      AdminTimeline.tsx    # Production timeline
      AdminBatchUpload.tsx # Bulk render upload

  components/
    AdminSidebar.tsx       # Admin sidebar — text-only nav, animated hover-reveal account menu
    ClientSidebar.tsx      # Client sidebar — same structure and hover-reveal as AdminSidebar
                           # Main nav: Portfolio / Timeline / Deliveries
                           # Account hover: Overview / Orders / --- / Documents / Settings / --- / Expand / Theme / --- / Logout
    AdminLayout.tsx        # Admin page wrapper
    ClientLayout.tsx       # Client page wrapper
    GhostModeBanner.tsx    # Fixed-position banner when admin views as client; sidebar offsets by banner height

    admin/
      DropboxVisualsPanel.tsx      # Scans Dropbox VS_Visuals folder, shows highest version per round
      DropboxConnectionStatus.tsx  # Dropbox connected/disconnected strip with relative time
      AirtableConnectionStatus.tsx # Airtable connected/error strip — record count + cache time
      AirtableSyncPanel.tsx        # Per-scene push-scene / pull-status UI
      ClientActivityPanel.tsx      # Client session history (removed from AdminClients, still exists)
      SceneCard.tsx                # Scene summary card
      InvoiceFormDialog.tsx        # Create invoice dialog
      AssetUploader.tsx            # Upload renders to Supabase storage

    client/
      TaskDetail.tsx       # Round detail view — upload zone, Dropbox panel, Airtable panel
                           # Props: roundId, sceneId, projectId, isAdmin, onUploaded
      AssetViewer.tsx      # Full render viewer with pin/annotation tools
      PinChat.tsx          # Per-pin comment thread
      LaneCard.tsx         # Subscription lane card

    ui/
      SmartImage.tsx       # Image with Dropbox temporary link support

  lib/
    design.ts              # SHARED DESIGN CONSTANTS — always import from here, never hardcode
                           # Both sidebars and all layout components use this
                           # Exports: LABEL, PAGE, BORDER, SURFACE, STATUS, BTN, RADIUS, SIDEBAR, TRANSITION, GLOW
    agreementTerms.ts      # Client Agreement v2.0 content (SSS-CA-v2.0, 14 clauses)
    activityLog.ts         # Logging helper
    reviewWindow.ts        # Deliver round and start review window
    clientActivity.ts      # Client session tracking (session_start / session_end / page_view)

  contexts/
    AuthContext.tsx        # Auth + ghost mode. enterGhostMode({ userId, name })

  integrations/
    supabase/
      client.ts            # Supabase client — values hardcoded, exports SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
      types.ts             # Generated database types

supabase/
  functions/               # Deno edge functions (deployed with npx supabase functions deploy)
    dropbox-oauth-start/        # Initiates Dropbox OAuth
    dropbox-oauth-callback/     # Handles callback — redirects to portal.silvershadowstudio.com
    dropbox-api/                # get-thumbnail, get-temporary-link, connection-status
    dropbox-webhook/            # Auto-sync on Dropbox file changes (webhook registered)
    dropbox-scan-visuals/       # Scans VS_Visuals folder, returns highest version per round
    airtable-sync/              # Bidirectional Airtable sync (see Airtable section below)
    airtable-list-models/       # Lists all rows from the Models table (cached 5 min, admin-only)
    accept-agreement/           # Sign client agreement, generate PDF
    admin-create-client/        # Create client account + send invite or provision
    admin-impersonate-client/   # Ghost mode token
    download-invoice-pdf/       # Generate invoice PDF
    send-transactional-email/   # Email sending (currently broken — see pending issues)

  migrations/              # Applied in filename order via Supabase Management API
                           # All migrations up to 20260511000001_scene_rounds_airtable.sql are applied
```

## Client dashboard — state machine (Index.tsx)

Single focused view. Shows exactly one state per client at a time:

1. **delivered** — new renders just delivered, countdown to review deadline
2. **countdown** — review window open, time remaining
3. **review** — client is in review (pins / corrections)
4. **order** — pending order to confirm
5. **idle** — nothing active; new commission brief CTA

## Design system

### Colours
- Background: `#151517` — `hsl(240 5% 9%)` (cool near-neutral dark)
- Sidebar: `#111113` — `hsl(240 5% 7%)` (slightly darker)
- Gold: `hsl(36 35% 57%)` via CSS var `--gold`
- All colours via CSS variables — never hardcode hex

### Typography
- Headings: Cinzel (serif), `font-serif`
- Body/UI: Arial/sans, `font-sans`
- Nav labels: 11px uppercase, `tracking-[0.24em]`
- Eyebrow labels: 9px uppercase, `tracking-[0.28em]`, `text-foreground/40`

### Rules
- No `rounded-full` buttons
- No bullet points in UI copy
- No emojis in UI
- No bold in prose
- Gold for active states and key highlights only
- Sharp rectangular components (`rounded-sm` at most)
- All design tokens in `src/lib/design.ts` — import from there, never hardcode

## Database key tables

| Table | Purpose |
|-------|---------|
| `accounts` | Client accounts |
| `account_members` | User ↔ account links |
| `projects` | Projects (`project_code`, `project_slug`) |
| `scenes` | Scenes (`scene_code`, `scene_slug`, `airtable_record_id`) |
| `scene_rounds` | Rounds per scene — status: `pending` / `in_production` / `client_review` / `awaiting_review` / `approved` / `delivered`; also `delivery_due_at TIMESTAMPTZ` |
| `round_assets` | Render files per round (Supabase storage or Dropbox path) |
| `lane_tasks` | Subscription lane tasks (`delivery_status`: `in_production` / `delivered`) |
| `subscriptions` | Lane subscriptions |
| `orders` | Project orders (status: `pending_acceptance`, `accepted`, etc.) |
| `invoices` | Invoices |
| `agreements` | Signed client agreements (SSS-CA-v2.0) |
| `dropbox_connections` | Dropbox OAuth tokens |
| `client_activity` | Session tracking (`kind`: `session_start` / `session_end` / `page_view`) |
| `app_settings` | Key-value config — `airtable_field_config` key holds Airtable field mapping |
| `user_roles` | Admin role assignments |

### Migrations applied (in order)
All up to and including:
- `20260509000001_account_type.sql`
- `20260509000002_orders_table.sql`
- `20260510000001_airtable_sync.sql`
- `20260510000002_production_codes.sql`
- `20260511000001_scene_rounds_airtable.sql` — adds `delivery_due_at` to `scene_rounds`, adds `awaiting_review` to status constraint

## Dropbox

Connected and working. Webhook registered for auto-sync on file changes.

### File naming convention
```
/00_Production/PRD01_Client-Projects/CP107_Charles-Street/SC05_Facade/VS_Visuals/
CP107-SC05-VS_R01_01.jpg
  CP107 = project_code  (projects table)
  SC05  = scene_code    (scenes table)
  VS    = visual type   (portal only shows VS_ files)
  R01   = round number
  01    = version number (app shows highest version per round)
```

Set `project_code`, `project_slug`, `scene_code`, `scene_slug` on each project/scene via the DropboxVisualsPanel on the round detail page.

## Airtable sync

Kieran's production tracker lives in Airtable. The portal syncs bidirectionally via the `airtable-sync` edge function. Airtable remains Kieran's source of truth.

**Base ID**: `appyidJqOmdNB8WUd`
**Table**: `Tasks` (table ID `tbleHaU9DxHyvixdL`)

The `airtable-list-models` function is separate — it reads from the **Models** table (`tbls6j4jyNifFyucU`) and powers the admin Production Tracker view.

### Field mapping (stored in `app_settings.airtable_field_config`)

| Config key | Airtable field | Type | Notes |
|---|---|---|---|
| `field_scene_name` | `Task name` | singleLineText | Primary field |
| `field_status` | `Status` | singleSelect | Emoji-prefixed values (see below) |
| `field_delivery_date` | `Deadline` | dateTime | Stored as `scene_rounds.delivery_due_at` |
| `field_project_name` | _(blank)_ | — | Linked records — not writable as text |
| `field_portal_scene_id` | _(blank)_ | — | No free-text ID field in Tasks; portal stores Airtable record ID in `scenes.airtable_record_id` instead |

### Status values

Actual Airtable single-select options have emoji prefixes. Pull matching uses substring so logic is resilient to emoji changes. Push writes the exact stored value.

| Airtable value | Portal status |
|---|---|
| `🔴 TO DO` | `pending` |
| `🟡 IN PROGRESS` | `in_production` |
| `🔵 REVIEW` | `awaiting_review` |
| `🟢 DONE` | `approved` |

### Actions on `airtable-sync`

- `push-scene` — creates/updates a Task row in Airtable; stores returned record ID in `scenes.airtable_record_id`
- `push-status` — writes portal round status to Airtable (maps to emoji value)
- `pull-status` — reads Status + Deadline; updates `scene_rounds.status` and `scene_rounds.delivery_due_at`
- `get-config` / `set-config` — read/write field mapping from `app_settings`
- `get-fields` — calls Airtable metadata API, returns all tables + field names (debugging)
- `probe-records` — fetches raw records from configured table (debugging)

**Verified**: push-scene + pull-status round-trip confirmed working. Record `recCTevx1HCoPQqA1` created for "Entrance" scene; `🔴 TO DO` → `pending` mapped correctly.

## Ghost mode

Admin can view the portal as any client:
- Clients page — click the ghost icon on the left of each client row
- `enterGhostMode({ userId, name })` from `AuthContext`

The `GhostModeBanner` is fixed-position at the top. The client sidebar and layout offset by the banner height so nothing is obscured.

## Client Agreement

Version: SSS-CA-v2.0, 14 clauses. Content in `src/lib/agreementTerms.ts`. Replaces all previous agreement versions. Signed agreements stored in `agreements` table, PDF generated via `accept-agreement` edge function.

## Clients in database

| Company | Contact | account_id |
|---------|---------|-----------|
| Lürssen (Aqualuce Limited) | John Roberts | `dd85fe7a-1117-4379-b3f6-9ffef651f081` |
| Winch Design | Simon Tomlinson | `7880c015-84ce-4273-8815-c97b9f74a74a` |
| Bergman Design House | Marie Soliman | (check DB) |
| Silvershadow Studio | Fred Colomb | `a09b2cdd-2c98-4415-a58d-ec6420d69bd6` |

## Pending — must do before first client invite

- **DropboxVisualsPanel not rendering on round page** — `TaskDetail.tsx` still has a debug line showing `isAdmin`/`sceneId`/`projectId`. Remove it once the panel is confirmed working.
- **Client correction flow not built** — client clicks Review on dashboard → full-screen overlay with pins → Submit corrections → creates Round 02 → countdown resets.
- **New commission brief flow not built** — 3-step overlay from idle dashboard state.
- **Airtable webhook not set up** — `pull-status` is currently manual only; no automatic sync when Kieran updates Airtable.
- **Pre-launch ghost mode test** — ghost as Simon Tomlinson (Winch, `7880c015`) and Marie Soliman (Bergman) and walk through the full client flow.
- **Set `delivery_due_at`** on at least one Winch scene round to test the countdown state on the client dashboard.
- **Email provider** — `send-transactional-email` uses a `LOVABLE_API_KEY` that is no longer valid. Delivery notifications and client invitations will not send. Needs Resend or similar wired in.
- **Stripe** — `STRIPE_SECRET_KEY` not set; invoice checkout won't work.
