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
- Stripe (payment processing — account live, secrets set in Supabase; see Stripe section)

## Supabase

- **Project ID**: `oodhsoiwnqxcimzmzick`
- **URL**: `https://oodhsoiwnqxcimzmzick.supabase.co`
- Owned by Fred's personal Supabase account (fred@silvershadowstudio.com)
- Access token: stored in your password manager (Supabase dashboard → Account → Access tokens)
- Deploy edge functions: `SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt`
- Connection is hardcoded in `src/integrations/supabase/client.ts` — Vercel env vars are not used (they were previously injected by Lovable's integration and caused conflicts)
- **OTP expiry**: extended to 604800 seconds (7 days) via Supabase Auth settings API — invitation links are valid for 7 days

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
    SetPassword.tsx        # Password setup from invite link — reads URL hash for
                           # Supabase error params (otp_expired → expired message,
                           # other error → invalid link message), shows clean UI
                           # before the spinner so errors are never hidden
    Auth.tsx               # Login page
    admin/
      AdminDashboard.tsx        # Admin studio overview — Dropbox + Airtable status strips, activity log preview
      AdminClients.tsx          # Client management — ghost circle left, clock/connections right,
                                #   last 10 sessions with start/end/duration
                                #   Add Client dialog includes email signature parser (Anthropic API)
                                #   and 3-letter client code chip suggestions
      AdminProjects.tsx         # Project + scene + round management (main admin workhorse)
      AdminOrders.tsx           # Create and manage orders
      AdminScenes.tsx           # Scene management
      AdminFinance.tsx          # Invoices and finance
      AdminInvoices.tsx         # Invoices + Quotations tabs
      AdminTimeline.tsx         # Production timeline
      AdminBatchUpload.tsx      # Bulk render upload
      AdminActivity.tsx         # Full activity log — badge filters by event type + date range, 2000 row limit
      AdminSettings.tsx         # Admin settings — profile, password, Dropbox connection, Airtable config
      AdminProductionTracker.tsx # /admin/production-tracker — live Airtable model status
                                 # via airtable-list-models edge function (cached 5 min)
      AdminDocuments.tsx        # /admin/documents — three-tab hub:
                                #   Agreements tab: signed agreements list, preview, download
                                #   Design tab: document_design_config editor + preview cards
                                #   Email tab: invitation email configurator + subject line
                                #   (replaces the standalone AdminEmailPreview page)
      AdminClientProfile.tsx    # Client profile — account details, resend invitation button
                                #   (appears only when agreement not yet signed, uses magiclink type)

  components/
    AdminSidebar.tsx       # Admin sidebar — imports shared constants from src/lib/sidebarConstants.ts
                           # "Email Preview" removed from account menu (now in Documents → Email tab)
    ClientSidebar.tsx      # Client sidebar — imports same shared constants, synced with AdminSidebar
    AdminLayout.tsx        # Admin page wrapper
    ClientLayout.tsx       # Client page wrapper
    GhostModeBanner.tsx    # Fixed-position banner when admin views as client; sidebar offsets by banner height

    admin/
      DropboxVisualsPanel.tsx      # Scans Dropbox VS_Visuals folder, shows highest version per round
      DropboxConnectionStatus.tsx  # Dropbox connected/disconnected strip
      AirtableConnectionStatus.tsx # Airtable connected/error strip
      AirtableSyncPanel.tsx        # Per-scene push-scene / pull-status UI
      ActivityLogPreview.tsx       # Dashboard preview of last N activity log entries
      ClientActivityPanel.tsx      # Client session history
      SceneCard.tsx                # Scene summary card
      InvoiceFormDialog.tsx        # Create invoice dialog
      QuotationFormDialog.tsx      # Create quotation dialog — includes deposit % field
                                   # stores deposit_percentage, net_total, gross_total, deposit_amount
      QuotationsTab.tsx            # Quotations list in AdminInvoices
      AssetUploader.tsx            # Upload renders to Supabase storage

    quotations/
      QuotationViewer.tsx  # Full-screen quotation preview dialog — Sign button appears for 'sent'
                           # quotations; clicking opens sign modal, calls sign-quotation edge function,
                           # auto-creates deposit invoice on success
      QuotationDocument.tsx # Client-facing quotation renderer (A4-style HTML)

    client/
      TaskDetail.tsx       # Round detail view — upload zone, Dropbox panel, Airtable panel
      AssetViewer.tsx      # Full render viewer with pin/annotation tools
      PinChat.tsx          # Per-pin comment thread
      LaneCard.tsx         # Subscription lane card

    ui/
      SmartImage.tsx       # Image with Dropbox temporary link support

  lib/
    design.ts              # SHARED DESIGN CONSTANTS — always import from here, never hardcode
    sidebarConstants.ts    # SHARED SIDEBAR CONSTANTS — SB object imported by both AdminSidebar
                           # and ClientSidebar. Single source of truth for widths, nav styles,
                           # account name styles, tooltip styles, separator styles
    agreementTerms.ts      # Client Agreement v2.0 content (SSS-CA-v2.0, 14 clauses)
    activityLog.ts         # logActivity() helper + ACTION_LABELS map + ActivityAction type
    reviewWindow.ts        # Deliver round and start review window
    clientActivity.ts      # Client session tracking (session_start / session_end / page_view)
    invoiceUtils.ts        # lineItemsTotal(), formatCurrency(), generateInvoicePdf()

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
    airtable-sync/              # Bidirectional Airtable sync — manual admin actions
    airtable-auto-sync/         # Automatic outbound sync — called by DB triggers
                                # Also sends Resend email to fred@ + kieran@ on each event
    airtable-list-models/       # Lists all rows from the Models table (cached 5 min, admin-only)
    accept-agreement/           # Sign client agreement, generate PDF (.catch() fix applied)
    admin-create-client/        # Create client account + send invite or provision or resend
                                # Modes: invite (new user), provision (existing), resend (magiclink)
                                # Accepts clientCode (stored on account), uses emailConfig.subject
    admin-impersonate-client/   # Ghost mode token
    download-invoice-pdf/       # Generate invoice PDF
    parse-signature/            # Admin-only — calls Anthropic claude-sonnet-4-20250514 to extract
                                # contact fields from a pasted email signature. Returns JSON with
                                # first_name, last_name, position, company_name, email, country, city.
                                # Requires ANTHROPIC_API_KEY Supabase secret.
    sign-quotation/             # Signs a quotation (status: sent → signed), records signed_by_name
                                # and signed_by_position, auto-creates a deposit invoice (type: deposit)
                                # due 5 days after signing. Caller must be account member or admin.
    stripe-webhook/             # Handles Stripe webhook events — checkout.session.completed marks
                                # invoice paid and records stripe_payment_intent_id. Requires
                                # STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY Supabase secrets.
    create-invoice-checkout/    # Stripe checkout session creator — reads STRIPE_SECRET_KEY;
                                # returns { pending: true } if key not set (graceful degradation)
    preview-email/              # Returns rendered invitation email HTML for preview iframe
    update-email-config/        # GET returns email_invite_config from app_settings;
                                # POST saves it. Config now includes subject field.
    slack-notify/               # Slack notifications (new)
    send-transactional-email/   # Legacy — uses LOVABLE_API_KEY (no longer valid); do not use

    _shared/
      emailTemplates.ts   # buildInviteEmailHtml() — InviteEmailConfig interface now includes
                          # subject?: string field used by admin-create-client for both invite
                          # and resend modes
      pdfUtils.ts         # DocumentDesignConfig type, DESIGN_DEFAULTS, loadDesignConfig() helper
                          # for edge functions that generate PDFs — reads document_design_config
                          # from app_settings at generation time
      brandLogo.ts        # SILVERSHADOW_LOGO_DATA_URL base64 constant

  migrations/              # Applied in filename order via Supabase Management API
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

### Sidebar constants

Both `AdminSidebar` and `ClientSidebar` import from `src/lib/sidebarConstants.ts` (the `SB` object). Do not hardcode sidebar widths, nav font sizes, or account row styles in the sidebar components — always use `SB.*`.

Key values: `SB.widthExpanded = "w-64"`, nav label `fontSize: 11, letterSpacing: "0.24em"`, account name `12px text-foreground`.

## Database key tables

| Table | Purpose |
|-------|---------|
| `accounts` | Client accounts — now includes `client_code TEXT UNIQUE` (3-letter code for quotation numbering) |
| `account_members` | User ↔ account links |
| `projects` | Projects (`project_code`, `project_slug`) |
| `scenes` | Scenes (`scene_code`, `scene_slug`, `airtable_record_id`) |
| `scene_rounds` | Rounds per scene — `instructions`, status, `delivery_due_at` |
| `round_assets` | Render files per round (Supabase storage or Dropbox path) |
| `round_uploads` | Client briefing files |
| `activity_log` | Immutable production-critical actions |
| `lane_tasks` | Subscription lane tasks |
| `subscriptions` | Lane subscriptions |
| `orders` | Project orders |
| `invoices` | Invoices — extended with `quotation_id`, `type` (deposit/balance/standalone), `stripe_payment_intent_id`, `stripe_checkout_url`; also has `invoice_number`, `line_items`, `account_id`, `currency`, `vat_rate`, `subtotal`, `vat_amount` |
| `quotation_documents` | Quotations — `quotation_number`, `line_items`, `deposit_percentage` (default 50), `signed_by_name`, `signed_by_position`, `net_total`, `gross_total`, `deposit_amount`, `signed_at`, status: draft/sent/signed/declined/cancelled |
| `agreements` | Signed client agreements (SSS-CA-v2.0) |
| `client_notifications` | In-app notifications for clients |
| `dropbox_connections` | Dropbox OAuth tokens |
| `client_activity` | Session tracking (`kind`: `session_start` / `session_end` / `page_view`) |
| `app_settings` | Key-value config — `airtable_field_config`, `email_invite_config` (incl. `subject`), `document_design_config` |
| `user_roles` | Admin role assignments |

### Migrations applied (in order)

All up to and including:
- `20260509000001_account_type.sql`
- `20260509000002_orders_table.sql`
- `20260510000001_airtable_sync.sql`
- `20260510000002_production_codes.sql`
- `20260511000001_scene_rounds_airtable.sql`
- `20260512000001_airtable_auto_sync_triggers.sql`
- `20260512000002_dropbox_folder_triggers.sql`
- `20260512000003_projects_dropbox_folder_url.sql`
- `20260512000004_round_uploads_dropbox_url.sql`
- `20260513000001_client_codes.sql` — adds `client_code TEXT UNIQUE` to accounts
- `20260513000002_quotation_enhancements.sql` — adds deposit_percentage, signed_by_name, signed_by_position, net_total, gross_total, deposit_amount to quotation_documents
- `20260513000003_invoice_enhancements.sql` — adds quotation_id, type (deposit/balance/standalone), stripe_payment_intent_id, stripe_checkout_url to invoices
- `20260513000004_document_design_config.sql` — seeds default document_design_config in app_settings

## Client codes

Every client account can have a 3-letter `client_code` (e.g. `WIN` for Winch Design). Used as a prefix for quotation numbers (e.g. `WIN-001`). Set during account creation in the Add Client dialog — the dialog suggests up to 8 codes derived from the company name as clickable chips. Stored in `accounts.client_code`.

## Quotation system

- **Table**: `quotation_documents`
- **Created via**: `QuotationFormDialog` in AdminInvoices
- **Viewed via**: `QuotationViewer` (full-screen dialog) + `QuotationDocument` (A4 HTML renderer)
- **Signing flow**: QuotationViewer shows a gold "Sign" button when status is `sent`. Admin or client clicks it, enters name + position, calls `sign-quotation` edge function which:
  - Sets `status = 'signed'`, records `signed_at`, `signed_by_name`, `signed_by_position`
  - Auto-creates a deposit invoice with `type = 'deposit'`, due 5 days after signing
- **Deposit %**: stored as `deposit_percentage` (default 50). Shown in QuotationFormDialog and reflected in auto-created deposit invoice amount.

## Invoice system

- **Table**: `invoices` (extended, see Database tables above)
- **Types**: `deposit` (auto-created on quotation signing), `balance` (manual), `standalone` (default, legacy)
- **Stripe**: `stripe_checkout_url` stored on invoice when Stripe checkout session created. `stripe_payment_intent_id` stored when webhook fires `checkout.session.completed`.

## Stripe integration

- **Account**: Created for Silvershadow Studio Limited
- **Bank**: Revolut Business — sort code 04-00-75, account 75913542
- **Payout**: weekly automatic on Monday
- **Statement descriptor**: SILVERSHADOW
- **Secrets** (all set in Supabase secrets as of 2026-05-13):
  - `STRIPE_SECRET_KEY` ✓
  - `STRIPE_PUBLISHABLE_KEY` ✓
  - `STRIPE_WEBHOOK_SECRET` ✓
- **Webhook URL** (register in Stripe Dashboard — event: `checkout.session.completed`):
  `https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/stripe-webhook`
- **Edge functions**: `create-invoice-checkout` (existing, gracefully returns `{ pending: true }` if key not set), `stripe-webhook` (handles `checkout.session.completed`)
- **Deploy commands** (run once with your token):
  ```
  SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy sign-quotation --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
  SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy stripe-webhook --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
  SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy admin-create-client --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
  ```

## Document design system

All PDF-generating edge functions read their visual config from `app_settings` key `document_design_config` at generation time via `_shared/pdfUtils.ts → loadDesignConfig()`. Default values:

```json
{
  "background_color": "#EDE8E0",
  "warm_black": "#1A1814",
  "warm_grey": "#8A8070",
  "gold": "#B89A6A",
  "body_font": "Times-Roman",
  "heading_font": "Helvetica-Bold",
  "meta_font": "Helvetica",
  "logo_width": 180,
  "margin_left": 72,
  "margin_right": 72,
  "margin_top": 64,
  "margin_bottom": 80
}
```

Config is editable in the admin at `/admin/documents` → Design tab. Changes affect new PDFs only; existing documents are unaffected.

## Documents admin page (`/admin/documents`)

Three-tab hub replacing the old single-view agreements page and the standalone `/admin/email-preview` page:

- **Agreements tab**: signed agreements list, preview (AgreementViewer), download PDF
- **Design tab**: document_design_config editor (colour pickers, font name inputs, margin numbers) + three preview cards (Quotation, Invoice, Round Instructions) that update reactively
- **Email tab**: full invitation email configurator — subject line, illustration URL, body copy, CTA label/URL, footer text, background colour — with live iframe preview. Saves to `email_invite_config` in app_settings via `update-email-config` edge function. Subject is used by `admin-create-client` for both invite and resend modes.

The `/admin/email-preview` route still exists but is no longer linked from the sidebar (now accessed via Documents → Email).

## Email invite configuration

Stored in `app_settings` key `email_invite_config`. Fields:
- `subject` — email subject line (default: "Your Silvershadow Studio portal is ready.")
- `illustrationUrl`, `bodyCopy`, `ctaLabel`, `ctaUrl`, `footerText`, `backgroundColor`

The `subject` field is read by `admin-create-client` in both `invite` and `resend` modes. Falls back to the default if not set.

## Email signature parser

In the Add Client dialog, admins can paste an email signature into a textarea and click "Parse Signature". This calls the `parse-signature` edge function (admin-only), which sends the text to Anthropic's `claude-sonnet-4-20250514` and returns a JSON object with `first_name`, `last_name`, `position`, `company_name`, `email`, `country`, `city`. Only empty form fields are populated — existing values are never overwritten. Requires `ANTHROPIC_API_KEY` in Supabase secrets.

## Resend invitation

On the admin client profile page (`AdminClientProfile.tsx`), a "RESEND INVITATION →" button appears when the client has not yet signed the agreement (checked against the `agreements` table). Clicking it calls `admin-create-client` with `mode: 'resend'`, which generates a new `magiclink` (not `invite` — that fails with `email_exists` for existing users) and sends the branded invitation email. After success, shows "Invitation sent." at 45% opacity. The button disappears once the client signs.

## /set-password error handling

`SetPassword.tsx` reads the URL hash on load (before any async work). Supabase appends error params to the hash when an invite link is invalid or expired:
- `error_code=otp_expired` → "This invitation link has expired. Please contact Silvershadow Studio to receive a new one."
- Any other `error` → "This link is invalid. Please contact Silvershadow Studio."

Error state renders immediately with no spinner, so clients always see a clear message. The "Return to login" button navigates to `/`.

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

In DropboxVisualsPanel, enter only the short codes — `project_code` (e.g. `CP107`) and `scene_code` (e.g. `SC05`). The `dropbox-scan-visuals` edge function resolves the full folder path by searching for a folder whose name starts with `CP107_` inside `/00_Production/PRD01_Client-Projects/`, then `SC05_` inside that. All matching is case-insensitive.

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

`logActivity()` accepts an optional `actorRole` override. All admin-only call sites pass `actorRole: "admin"` explicitly. Mixed-context callers (TaskDetail, AssetViewer) rely on the DB lookup. Client login entries always hardcode `actor_role: "client"`. Dropbox/system events hardcode `actor_role: "system"`.

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

## Pending

- **Stripe webhook registration**: Register `https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/stripe-webhook` in Stripe Dashboard with event `checkout.session.completed`. Also deploy the three updated edge functions (sign-quotation, stripe-webhook, admin-create-client) — commands in Stripe integration section above.
- **Quotation + invoice PDF generation**: edge functions for generating quotation and invoice PDFs using `_shared/pdfUtils.ts` design config — not yet built.
- **Client-facing quotation and invoice views**: clients can view sent quotations (via `Documents.tsx`) and sign them in-portal; invoice payment via Stripe checkout. Signing works in QuotationViewer but client-side routing to quotations page needs wiring.
- **Client correction flow not built** — client clicks Review on dashboard → full-screen overlay with pins → Submit corrections → creates Round 02 → countdown resets. Currently admin-only round creation.
- **New commission brief flow not built** — 3-step overlay from idle dashboard state.
- **Airtable inbound webhook not set up** — `pull-status` is currently manual only.
- **Pre-launch ghost mode test** — ghost as Simon Tomlinson (Winch) and Marie Soliman (Bergman) and walk through the full client flow.
- **Brief field in Airtable** — Kieran needs to add a `Brief` field to the Tasks table for instructions sync to work.
- **Email from address** — `airtable-auto-sync` sends from `portal@silvershadowstudio.com`. Confirm verified in Resend.
