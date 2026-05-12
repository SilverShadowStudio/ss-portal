# Silvershadow Studio — Client Portal (ss-portal)

## What this is

A dual-portal web application for Silvershadow Studio, a London-based CGI and architectural visualisation studio. Two user types:

- **Admin** (Fred + studio team) — manage clients, projects, scenes, rounds, invoices, orders, Dropbox sync
- **Client** (design studios) — view renders, submit corrections, approve rounds, sign agreements, confirm orders

Two commercial models:
- **Partnership/Subscription** — Lane-based (dedicated production capacity, monthly subscription)
- **Project** — Per-quotation, per-scene delivery

## Architecture decisions

- **Softr** stays for Kieran's internal production portal — do not touch it, ever
- **Airtable** stays as Kieran's source of truth — the portal syncs to it, never replaces it
- Two portals: client-facing (this repo) + production (Kieran's Softr)
- Supabase is owned by Fred's personal account — no dependency on Lovable

### Two-database design (intentional and permanent)

Supabase (Postgres) and Airtable coexist by design and serve different purposes:

- **Supabase** — authentication, RLS, client-facing data (projects, scenes, rounds, assets, orders, invoices, agreements, activity log)
- **Airtable** — Kieran's production team workflow (task assignment, modeller tracking, scene status, deadlines). Kieran owns this entirely.

Automatic outbound sync is in place: Supabase DB triggers on `scene_rounds` fire `net.http_post` calls to the `airtable-auto-sync` edge function whenever a round is created, a status changes, or instructions are submitted. The sync is one-way (portal → Airtable) for these events. Inbound sync (Airtable → portal) uses the existing manual `pull-status` action in `airtable-sync` and the Dropbox webhook for file arrivals.

## Kieran — critical context

Kieran is Production Director. He built and maintains the entire Softr portal himself — 25+ blocks, views per user group (management/scene managers/modellers/clients), conditional logic, permissions. He is the only person who touches it.

The new portal replaces only the client-facing layer. Clients previously logged into Softr; they will now log into this portal. Everything else Kieran does in Softr is unchanged.

The handshake between the two worlds is Airtable: when Kieran updates a task status in Airtable, the client sees it in the portal automatically via the sync.

Kieran's stated concern: "My concern with using something configured with AI is we don't ultimately know how it works or how to fix it." This is legitimate. Keep the Airtable sync simple, well-documented, and debuggable by a non-engineer.

Rules:
- Never ask Kieran to do anything in the portal codebase — all requests go through Fred
- Never suggest replacing or augmenting Softr unless Kieran explicitly asks for it
- Never suggest migrating away from Airtable
- If Kieran ever wants his own admin view inside this portal, build it to his exact spec without touching anything he does in Softr

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
- Resend (transactional email — `RESEND_API_KEY` set in Supabase secrets, `silvershadowstudio.com` domain verified, DNS records applied via Squarespace)

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
      AdminDashboard.tsx        # Admin studio overview — Dropbox + Airtable status strips, activity log preview
      AdminClients.tsx          # Client management — ghost circle left, clock/connections right,
                                #   last 10 sessions with start/end/duration
      AdminProjects.tsx         # Project + scene + round management (main admin workhorse)
      AdminOrders.tsx           # Create and manage orders
      AdminScenes.tsx           # Scene management
      AdminFinance.tsx          # Invoices and finance
      AdminTimeline.tsx         # Production timeline
      AdminBatchUpload.tsx      # Bulk render upload
      AdminActivity.tsx          # Full activity log — badge filters by event type + date range, 2000 row limit
      AdminSettings.tsx          # Admin settings — profile, password, Dropbox connection, Airtable config
      AdminProductionTracker.tsx # /admin/production-tracker — live Airtable model status
                                 # via airtable-list-models edge function (cached 5 min)
                                 # Status dots + plain labels (emoji stripped), modeller names,
                                 # deadline, cost, budgeted hours, search + status filter

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
                                   # Admin enters project_code + scene_code (e.g. CP107, SC05);
                                   # edge function resolves full folder path by prefix search
      DropboxConnectionStatus.tsx  # Dropbox connected/disconnected strip — shows "Last file updated X ago"
                                   # from round_assets.created_at, or "No files received yet"
      AirtableConnectionStatus.tsx # Airtable connected/error strip — record count + cache time
      AirtableSyncPanel.tsx        # Per-scene push-scene / pull-status UI
      ActivityLogPreview.tsx       # Dashboard preview of last N activity log entries
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
    activityLog.ts         # logActivity() helper + ACTION_LABELS map + ActivityAction type
                           # Pass actorRole: "admin" explicitly in all admin-only call sites —
                           # do not rely on the DB lookup for admin detection
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
                                # Parses round number from filename (R01, R02…), restricted to
                                # VS_Visuals subfolder only
    dropbox-scan-visuals/       # Scans VS_Visuals folder, returns highest version per round
                                # Takes project_code + scene_code (e.g. CP107, SC05); resolves
                                # full folder path via prefix search. Detects Dropbox Business
                                # team namespace and sets Dropbox-API-Path-Root header automatically
    airtable-sync/              # Bidirectional Airtable sync — manual admin actions (see Airtable section)
    airtable-auto-sync/         # Automatic outbound sync — called by DB triggers, not admin actions
                                # Events: round_created, status_changed, instructions_submitted
                                # Also sends Resend email to fred@ + kieran@ on each event
                                # Deploy: npx supabase functions deploy airtable-auto-sync --no-verify-jwt
    airtable-list-models/       # Lists all rows from the Models table (cached 5 min, admin-only)
    accept-agreement/           # Sign client agreement, generate PDF
    admin-create-client/        # Create client account + send invite or provision
    admin-impersonate-client/   # Ghost mode token
    download-invoice-pdf/       # Generate invoice PDF
    send-transactional-email/   # Template-based email via queue — uses LOVABLE_API_KEY (no longer valid)
                                # For internal notifications use airtable-auto-sync (Resend) instead

  migrations/              # Applied in filename order via Supabase Management API
                           # All migrations up to 20260512000001_airtable_auto_sync_triggers.sql are applied
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
| `scene_rounds` | Rounds per scene — `instructions` (client brief text), status: `pending` / `in_production` / `client_review` / `awaiting_review` / `approved` / `delivered`; also `delivery_due_at TIMESTAMPTZ` |
| `round_assets` | Render files per round (Supabase storage or Dropbox path) |
| `round_uploads` | Client briefing files uploaded via NewRoundModal — `scene_id`, `category`, `file_name`, `storage_path` (bucket: `round-uploads`) |
| `activity_log` | Immutable record of production-critical actions — `actor_name`, `actor_role`, `action`, `description`, plus optional `project_id/name`, `scene_id/name`, `round_number` |
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
- `20260512000001_airtable_auto_sync_triggers.sql` — three `pg_net` triggers on `scene_rounds`: `airtable_round_created` (INSERT), `airtable_status_changed` (UPDATE when status changes), `airtable_instructions_submitted` (UPDATE when instructions set/changed). Each calls `net.http_post()` async to `airtable-auto-sync`.

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

### Setting up a scene for Dropbox sync

In DropboxVisualsPanel, enter only the short codes — `project_code` (e.g. `CP107`) and `scene_code` (e.g. `SC05`). The `dropbox-scan-visuals` edge function resolves the full folder path by searching for a folder whose name starts with `CP107_` inside `/00_Production/PRD01_Client-Projects/`, then `SC05_` inside that. All matching is case-insensitive. The admin never needs to know or type the full folder name.

### Team namespace (Dropbox Business)

The Dropbox account is a Business team account. All files live in the team namespace, not the personal root. The `dropbox-scan-visuals` and `dropbox-webhook` functions detect this by calling `/2/users/get_current_account` on startup, reading `root_info.root_namespace_id`, and passing a `Dropbox-API-Path-Root` header on every subsequent API call. Without this header, all path operations return `path/not_found`.

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

## Activity log

All production-critical actions are recorded in the `activity_log` table. The full log is at `/admin/activity` (badge filters + date range). A preview appears on the admin dashboard via `ActivityLogPreview`.

### Events tracked

| Action | Logged by | Actor role |
|---|---|---|
| `project_created` | AdminProjects | admin |
| `project_archived` | ArchiveProjectDialog | admin |
| `project_restored` | AdminProjects | admin |
| `scene_created` | AdminScenes | admin |
| `round_created` | AdminScenes (Round 01), dropbox-webhook (auto-created rounds) | admin / system |
| `asset_uploaded` | TaskDetail (multi-file upload), AssetUploader | admin |
| `asset_approved` | AssetViewer | client |
| `revision_requested` | AssetViewer | client |
| `client_created` | AdminClients | admin |
| `client_registered` | AuthContext — first login detected | client |
| `client_login` | AuthContext — subsequent logins | client |
| `agreement_signed` | accept-agreement edge function | client |
| `dropbox_file_received` | dropbox-webhook — new file synced | system |

### Actor role reliability

`logActivity()` accepts an optional `actorRole` override. All admin-only call sites pass `actorRole: "admin"` explicitly — this bypasses the `user_roles` DB lookup which can return null under certain timing/RLS conditions. Mixed-context callers (TaskDetail, AssetViewer) rely on the DB lookup. Client login entries always hardcode `actor_role: "client"`. Dropbox/system events hardcode `actor_role: "system"`.

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

- **Client correction flow not built** — client clicks Review on dashboard → full-screen overlay with pins → Submit corrections → creates Round 02 → countdown resets. Currently admin-only round creation.
- **New commission brief flow not built** — 3-step overlay from idle dashboard state.
- **Airtable inbound webhook not set up** — `pull-status` is currently manual only; no automatic sync when Kieran updates Airtable status or deadline. Would need a registered Airtable automation or polling cron.
- **Pre-launch ghost mode test** — ghost as Simon Tomlinson (Winch, `7880c015`) and Marie Soliman (Bergman) and walk through the full client flow.
- **Set `delivery_due_at`** on at least one Winch scene round to test the countdown state on the client dashboard.
- **Stripe** — `STRIPE_SECRET_KEY` not set; invoice checkout won't work.
- **Brief field in Airtable** — Kieran needs to add a single-line or long-text field named exactly `Brief` to the Tasks table in Airtable for instructions sync to work. Until then, `airtable-auto-sync` logs a warning and skips instructions push without failing.
- **Email from address** — `airtable-auto-sync` sends from `portal@silvershadowstudio.com`. Confirm this address is verified as a sender in Resend, or update `FROM_ADDRESS` constant in the function.
- **`send-transactional-email` / `process-email-queue`** — still uses `LOVABLE_API_KEY` which is no longer valid. Client-facing emails (invitations, delivery notices) will not send. These functions are separate from `airtable-auto-sync` and need Resend wired in independently if client emails are required.
