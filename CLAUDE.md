# Silver Shadow Studio — Client Portal (ss-portal)

## What this is

A dual-portal web application for Silver Shadow Studio, a London-based CGI and architectural visualisation studio. Two user types:

- **Admin** (Fred + studio team) — manage clients, projects, scenes, rounds, invoices, orders, Dropbox sync
- **Client** (design studios) — view renders, submit corrections, approve rounds, sign agreements, confirm orders

Two commercial models:
- **Partnership/Subscription** — Lane-based (dedicated production capacity, monthly subscription)
- **Project** — Per-quotation, per-scene delivery

## Hard rules

- **Never run Supabase migrations or schema changes without Fred's explicit confirmation in this session, even with skip-permissions enabled.**
- **Never ask Fred clarifying questions. Resolve all ambiguity yourself using the most conservative, least-destructive interpretation. Do less rather than more when scope is unclear.**
- **Never delete, rename, or restructure existing code unless the task explicitly requires it. Additions are always preferred over modifications. Modifications are always preferred over deletions.**
- **When multiple approaches exist, always pick the one with the smallest blast radius — the one that is easiest to revert and least likely to break something else.**
- **Never touch files unrelated to the task at hand, even if they look wrong.**
- **Always deploy edge functions from the project root and verify the deploy with `npx supabase functions download <name>` + grep before trusting it.** A `functions deploy` run in the background or without an explicit CWD has twice silently shipped stale source while returning exit 0 and a success message.

## Session Routines

### Startup

1. Launch: `cd ~/code/ss-portal && claude --dangerously-skip-permissions`
2. First command in Claude Code: `cat HANDOFF.md && git status`
3. First prompt: "Summarise the current state in your own words — what's shipped, what's blocked, what's queued. Don't take action yet."

The HANDOFF.md prepended at the end of each session is the source of truth. Read it first, act second.

### Closing

Run these in order, pause between each:

1. **Git status check** — Run `git status`. Surface any uncommitted changes. Don't commit blindly. Ask whether to commit, stash, or leave for next session.

2. **Prepend HANDOFF.md** with a new dated session block at the TOP of the file (don't overwrite existing content). Title: `# Session — [today's date]`

   Sections:
   - **Completed this session** — commits shipped with hash and one-line description
   - **In progress / needs verification** — shipped but not yet browser-tested
   - **Pending** — queued for next session, including deferred work
   - **Decisions made** — meaningful product/architectural decisions
   - **Open questions or things to watch** — known risks, technical debt, gotchas
   - **URGENT next session** — anything that genuinely needs to happen first

   Commit message: `HANDOFF — [date] session: [one-line summary]`. Push to main.

3. **CLAUDE.md promotion review** — Scan today's session for patterns, conventions, or gotchas worth codifying. Report candidate additions. Don't write them yet — let Fred approve which to add.

4. **Final state confirmation** — Run `git status` one last time. Working tree should be clean.

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

## Email deliverability

Invitation, agreement, quotation, and invoice emails all go through the edge-function + Resend pipeline. Three rules keep them aligned with the sender domain and out of corporate filters:

- **Verify links must be on the portal domain, never `*.supabase.co`.** A `/auth/verify` rewrite in `vercel.json` proxies server-side to `https://oodhsoiwnqxcimzmzick.supabase.co/auth/v1/verify`, so the visible link aligns with the `silvershadowstudio.com` sender (DMARC). `buildPortalVerifyUrl(properties, fallback)` in `admin-create-client` composes these from the `generateLink()` response for all three modes (`resend` / `magiclink` / `invite`); it falls back to `action_link` when the token components are missing. The proxy does not cover Supabase's own auth emails (password reset etc.) — those still live on `supabase.co`.
- **Email images are portal-hosted under `public/email-assets/`, never S3 or base64.** `silvershadow-wordmark.png` and `portal-invite-illustration.png` are served from `https://portal.silvershadowstudio.com/email-assets/*` — aligned with the sender domain, edge-cached, Outlook-compatible. `amazonaws.com` hosts get down-ranked by some filters, and `data:` URIs don't render in Outlook desktop `<img>`. The canonical `LOGO_URL` / `illustrationUrl` live in `_shared/emailTemplates.ts`, but four edge functions carry their own `LOGO_URL` copies (`accept-agreement`, `send-quotation-email`, `send-delivery-notification`, `send-invoice-email`) — change all of them together.
- **Sender is `portal@silvershadowstudio.com`.** Known watch item: the Katharine Pooley corporate filter soft-bounces it even after the verify-link + image-host fix. Don't change sender strategy until the Resend webhook is ingesting bounce reasons — otherwise it's guesswork.

## Auth + activity logging

- **Phantom-login guard.** The `SIGNED_IN` handler in `AuthContext.tsx` only inserts a `client_login` row when `auth.users.last_sign_in_at > lastLog.created_at + 10s` (10s skew tolerance). The comparison is against the server-side `last_sign_in_at`, not a local ref, so it also de-dupes synthetic `SIGNED_IN` events across tabs/devices (token refresh, cross-tab storage sync, focus regain). Without it, one continuous tab session logged six phantom logins.
- **`session_end` idempotence.** `useClientActivityTracker.ts` guards `session_end` with a `sessionEndedRef` boolean so it fires at most once per session lifetime — both the `pagehide` and `visibilitychange` beacon paths share the guard. Reset on each new `session_start`.

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

### Calling action-routed edge functions from the frontend

`dropbox-api` (and any edge function that routes via `?action=...` query params) cannot be called with `supabase.functions.invoke` — that method sends a plain POST with no way to append URL query parameters. Use a direct `fetch` call instead:

```ts
const { data: sessionData } = await supabase.auth.getSession();
const token = sessionData?.session?.access_token;
const res = await fetch(
  `${SUPABASE_URL}/functions/v1/dropbox-api?action=search-project-folders`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ query }),
  }
);
```

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are both exported from `src/integrations/supabase/client.ts`.

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

The `/auth/verify` rewrite (added for email deliverability) must be listed **before** this SPA catch-all — Vercel evaluates rewrites in order and the catch-all would otherwise swallow `/auth/verify`. See the Email deliverability section.

## Project structure

```
src/
  pages/
    Index.tsx              # Client dashboard — single state machine (see below)
    Portfolio.tsx          # Client portfolio — projects + scenes
    Timeline.tsx           # Client timeline / Gantt
    Delivery.tsx           # Client delivery page
    Orders.tsx             # Client orders confirmation (Uber-style flow)
    Documents.tsx          # Client documents hub — three tabs: Agreement (sign/view SSS-CA-v2.0),
                           # Quotations (view sent quotations, sign in-portal via QuotationViewer),
                           # Invoices (view invoices, pay via Stripe checkout link)
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
      AdminInvoices.tsx         # Invoices + Quotations + Generator tabs
                                # Generator tab: client selector dropdown (fetches accounts + owner
                                # profile via account_members join) builds iframe src with URL params
                                # (client, address, contact, registration) → public/generator/index.html
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
      AdminClientProfile.tsx    # Client profile — account details (company name, client code,
                                #   account type, building number, street, postcode, city, country,
                                #   registration number), resend invitation button (appears only when
                                #   agreement not yet signed, uses magiclink type)

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
      QuotationFormDialog.tsx      # Create/edit quotation dialog — deposit % field, net/gross/deposit
                                   # totals. Supports three modes: create (draft), edit (any status),
                                   # send (sets status → sent, triggers send-quotation-email).
                                   # Delete action available for draft/declined/cancelled quotations.
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
    airtable-sync-contact/      # Syncs client contact + six address fields into the Airtable Clients
                                # table (stored-id-first via resolveAndStoreCompanyRecordId; additive)
    airtable-sync-project/      # Syncs project into Airtable; reads accounts.airtable_client_id
                                # alongside company_name / account_type
    airtable-find-matching-clients/ # Admin-gated pre-flight duplicate match for Add Client
                                # (suffix-stripping bidirectional name match, returns up to 5)
    accept-agreement/           # Sign client agreement, generate PDF (.catch() fix applied)
    admin-create-client/        # Create client account + send invite or provision or resend
                                # Modes: invite (new user), provision (existing), resend (magiclink)
                                # Accepts clientCode (stored on account), uses emailConfig.subject
    admin-impersonate-client/   # Ghost mode token
    admin-delete-account/       # Admin-gated cascade delete — deletes the account row first (so
                                # account_members cascades), then orphan auth.users; preserves
                                # fred@silvershadowstudio.com; returns deleted/preserved/failed
    admin-generate-manual-invite/ # Admin-gated — builds verify URL + byte-identical invite HTML for
                                # a blocked recipient. No send; returns verify_url + email_html
    download-invoice-pdf/       # Generate invoice PDF
    parse-signature/            # Admin-only — calls Anthropic claude-sonnet-4-20250514 to extract
                                # contact fields from a pasted email signature. Returns JSON with
                                # first_name, last_name, position, company_name, email, country, city.
                                # Requires ANTHROPIC_API_KEY Supabase secret.
                                # Fix applied: response now correctly parsed from streamed JSON.
    send-quotation-email/       # Sends branded quotation email to client when quotation status → sent.
                                # Uses Resend, reads document_design_config for styling, attaches
                                # quotation PDF. Called by QuotationFormDialog on send action.
    send-invoice-email/         # Sends branded invoice email to client with payment link.
                                # Uses Resend. Called manually from invoice actions.
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
    resend-find-email/          # Admin-gated diagnostic — Resend lookup by recipient + time window,
                                # plus endpoint probe. Deployed --no-verify-jwt
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

public/
  generator/             # Standalone invoice generator (static HTML/JS, no React)
    index.html           # Form — client info, bank details, Invoice A (date/VAT/downpayment),
                         # Invoice B (date/net days). Download buttons auto-save all fields to
                         # localStorage then open a hidden iframe to print display.html or display2.html.
                         # Accepts URL params: client, address, contact, registration — pre-fills
                         # form fields, overriding localStorage (set by AdminInvoices client selector).
    display.html         # Invoice A print layout
    display2.html        # Invoice B print layout
    styles.css / styles2.css / form.css
    script.js            # Shared logic: localStorage restore, URL param pre-fill, net days
                         # calculation, item management (add/remove/save), display rendering,
                         # VAT + downpayment totals
    images/
      SS - Logo 2019.svg # Brand logo (copy manually if missing — not in git)
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

## React component patterns

### Dialogs must be mounted unconditionally

`<Dialog open={state}>` only responds to state changes when mounted. If a Dialog is nested inside a conditional block that can unmount it (e.g. `{!selectedClient && (...)}`) then calling `setDialogOpen(true)` sets state but has no mounted consumer — the trigger button appears to do nothing.

**Rule**: Always render Dialog components unconditionally at the component root, outside any conditional render block. Convert `DialogTrigger` buttons to plain `<Button onClick={() => setOpen(true)}>` elements when the trigger and Dialog are in different conditional scopes. This bug has caused at least two wasted diagnostic sessions — treat it as a first suspect whenever a modal button is inert.

## Database key tables

| Table | Purpose |
|-------|---------|
| `accounts` | Client accounts — includes `client_code TEXT UNIQUE` (3-letter code for quotation numbering) and `airtable_client_id TEXT` (canonical hard link to the Airtable Clients record; name lookup is fallback-only) |
| `account_members` | User ↔ account links |
| `projects` | Projects (`project_code`, `project_slug`) |
| `scenes` | Scenes (`scene_code`, `scene_slug`, `airtable_record_id`) |
| `scene_rounds` | Rounds per scene — `instructions`, status, `delivery_due_at`, `buffer_weeks INTEGER DEFAULT 1` (idle gap between delivery and next round start; default 1 = pre-buffer cadence) |
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
- `20260519000003_accounts_airtable_client_id.sql` — adds `airtable_client_id TEXT` + `idx_accounts_airtable_client_id` to accounts
- `20260519000004_round_buffer.sql` — adds `buffer_weeks INTEGER DEFAULT 1` to scene_rounds

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
- **Webhook URL** (registered in Stripe Dashboard — event: `checkout.session.completed`):
  `https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/stripe-webhook`
- **Edge functions**: `create-invoice-checkout` (creates checkout session; returns `{ pending: true }` if key missing), `stripe-webhook` (handles `checkout.session.completed`, marks invoice paid, stores `stripe_payment_intent_id`)
- **Status as of 2026-05-14**: Secrets set, webhook registered, functions deployed. Payment link button visible in invoice table. Actively debugging — added `console.log("Stripe key set:", !!stripeKey)` and catch-block stack logging to `create-invoice-checkout`. Check Supabase Dashboard → Functions → create-invoice-checkout → Logs after triggering from the portal.

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
- `subject` — email subject line (default: "Your Silver Shadow Studio portal is ready.")
- `illustrationUrl`, `bodyCopy`, `ctaLabel`, `ctaUrl`, `footerText`, `backgroundColor`

The `subject` field is read by `admin-create-client` in both `invite` and `resend` modes. Falls back to the default if not set.

## Email signature parser

In the Add Client dialog, admins can paste an email signature into a textarea and click "Parse Signature". This calls the `parse-signature` edge function (admin-only), which sends the text to Anthropic's `claude-sonnet-4-20250514` and returns a JSON object with `first_name`, `last_name`, `position`, `company_name`, `email`, `country`, `city`. Only empty form fields are populated — existing values are never overwritten. Requires `ANTHROPIC_API_KEY` in Supabase secrets.

## Resend invitation

On the admin client profile page (`AdminClientProfile.tsx`), a "RESEND INVITATION →" button appears when the client has not yet signed the agreement (checked against the `agreements` table). Clicking it calls `admin-create-client` with `mode: 'resend'`, which generates a new `magiclink` (not `invite` — that fails with `email_exists` for existing users) and sends the branded invitation email. After success, shows "Invitation sent." at 45% opacity. The button disappears once the client signs.

## Manual invite + clipboard rules

For recipients blocked by corporate mail filters (the system send soft-bounces), the admin can hand-deliver an invite. `AdminClientProfile.tsx` exposes the flow via `ManualInviteModal` + the `admin-generate-manual-invite` edge function.

- **`magiclink`, not `invite`.** Mirrors `admin-create-client`'s resend mode — `invite` 400s for already-registered users, while `magiclink` works for any existing user (it confirms and signs them in on click).
- **HTML is byte-identical to system mail.** `admin-generate-manual-invite` renders with `buildInviteEmailHtml` + `app_settings.email_invite_config` + `loadBrand()` and returns `verify_url` + `email_html` — it does not send (neither Supabase native nor Resend). The admin copies and forwards manually.
- **Clipboard rule (Safari-safe).** Copy-email uses `navigator.clipboard.write([ClipboardItem])` with both `text/html` and `text/plain` blobs **pre-built via `useMemo`**, so the click handler has zero awaits before `.write()` — Safari only accepts the call inside a synchronous user gesture. Fall back to `clipboard.writeText(text)` when `ClipboardItem` is undefined.

## /set-password error handling

`SetPassword.tsx` reads the URL hash on load (before any async work). Supabase appends error params to the hash when an invite link is invalid or expired:
- `error_code=otp_expired` → "This invitation link has expired. Please contact Silver Shadow Studio to receive a new one."
- Any other `error` → "This link is invalid. Please contact Silver Shadow Studio."

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

### Dropbox web URL format

The Dropbox web URL for a folder is `https://www.dropbox.com/home` + `path_display` (e.g. `https://www.dropbox.com/home/00_Production/PRD01_Client-Projects/CP107_Charles-Street`). This is stored in `projects.dropbox_folder_url` and surfaced as a clickable link in the admin UI.

**Caveat**: Still unverified for Business team accounts — personal Dropbox uses `/home` but team accounts may require a namespace-aware path variant. If `/home` resolves incorrectly, the correct format may be `/home/Team%20Space` + path or similar. Verify before surfacing these URLs to clients.

### DB trigger bypass — linked projects and scenes

When onboarding an existing project or scene (one that already has a Dropbox folder), the INSERT-triggered edge functions must not create new folders. The bypass signal is a **non-null `project_code` or `dropbox_folder`** on the INSERT record:

- `dropbox-create-project-folder` — skips if `record.project_code` or `record.dropbox_folder` is set.
- `dropbox-create-scene-folder` — skips if `record.scene_code` or `record.dropbox_folder` is set.

`airtable-sync-project` also honours a pre-set `project_code` rather than auto-incrementing, so Dropbox-onboarded projects (where the code was parsed from the folder name) sync without minting a duplicate code. No migration is required — the pattern relies entirely on the INSERT payload.

## Airtable sync

Kieran's production tracker lives in Airtable. Airtable remains Kieran's source of truth. The portal syncs to it (one-way for round events via `airtable-auto-sync`, bidirectional on demand via `airtable-sync`).

### Airtable schema (canonical)

Source: Q&A between Fred and Kieran, 18 May 2026.

- **Base**: `AIRTABLE_BASE_ID` (Supabase secret).
- **PAT**: `AIRTABLE_PAT` (Supabase secret).

#### Tasks table — `tbleHaU9DxHyvixdL`

The only Airtable table the portal reads from.

- **Accountable to** — linked record to the Users table. Used for freelancer assignment. Never exposed to clients.
- **Status** — single-select with exactly four values, in this order:
  - `🔴 TO DO`
  - `🟡 IN PROGRESS`
  - `🟠 REVIEW`
  - `🟢 DONE`
- **Last Modified Time Status** — auto-populated timestamp of the last status change. Closest available signal to a completion timestamp; not a true "done at" (a task can be marked DONE and revisited).
- No "task accepted" timestamp, no "task rejected" status. Freelancers communicate with the studio directly rather than rejecting in Airtable.
- Tasks are mostly created ahead of time; some retroactive entries exist from before the system was in place.

#### Portal field mapping

Confirmed via AdminSettings → Airtable Field Mapping panel. Mapping is stored in `app_settings.airtable_field_config`.

| Panel label | Airtable field |
|---|---|
| Scenes table name or ID | Tasks table (`tbleHaU9DxHyvixdL`) |
| Portal Scene ID field | _(blank)_ — portal stores Airtable record ID in `scenes.airtable_record_id` instead |
| Scene name field | `Task name` |
| Status field | `Status` |
| Delivery date field | `Deadline` |
| Round field | _(current value to be confirmed via the panel)_ |

#### Status mapping (Airtable ↔ portal)

| Airtable value | Portal status |
|---|---|
| `🔴 TO DO` | `pending` |
| `🟡 IN PROGRESS` | `in_production` |
| `🟠 REVIEW` | `awaiting_review` |
| `🟢 DONE` | `approved` |

#### Other Airtable tables (not consumed by the portal)

- **Scene Manager Day Logs** — daily time entries by scene managers (date, project, time spent). Used for monthly-rate freelancer payroll (Maycon, Katerina, Fiodor, Taya, Julia). Rates and rollup fields drive cost-per-day and feed invoices.
- **Cost / Budget table** — name TBC. Configures costs and shows budget in terms of time per production stage.
- **Team Holiday Tracker** — logs time off across the broader team.
- **Scene Manager Invoices** — grouped invoice entries for scene managers.
- **Modeller Invoices** — grouped invoice entries for modellers.

**Portal ↔ Airtable rules**:

- **Reads**: The portal only reads from the Tasks table — Status, deadline, scene/round identifiers — and only for client-facing display.
- **Writes**: The portal writes one-way to Airtable for studio operations (Users / Clients / Projects sync per `airtable-sync`). This is for Kieran's workflow, not for client display.
- **Never**: The portal does not read or surface anything from Scene Manager Day Logs, the Cost/Budget table, Team Holiday Tracker, or either of the Invoices tables. These are internal/payroll-only.

### Actions on `airtable-sync`

- `push-scene` — creates/updates a Task row in Airtable; stores returned record ID in `scenes.airtable_record_id`.
- `push-status` — writes portal round status to Airtable (maps to emoji value).
- `pull-status` — reads Status + Deadline; updates `scene_rounds.status` and `scene_rounds.delivery_due_at`.
- `get-config` / `set-config` — read/write field mapping from `app_settings`.
- `get-fields` — calls Airtable metadata API; returns all tables + field names (debugging).
- `probe-records` — fetches raw records from the configured table (debugging).

No migration is required by this schema documentation.

### Client + project outbound sync (Clients table)

Separate from the read-only Tasks sync above. The portal writes client and project records into Airtable's Clients table via `airtable-sync-contact` and `airtable-sync-project`.

- **Canonical link is `accounts.airtable_client_id`.** `resolveAndStoreCompanyRecordId` resolves stored-id-first (with a 404 re-check), falling back to a `company_name` lookup only on the first-ever sync, then writes the resolved id back. This replaced name-equality re-resolution, which forked the link — and silently created duplicate Clients rows — whenever a name diverged between systems.
- **Address syncs as six separate fields, additively.** `Building number`, `Street name`, `City`, `Postcode`, `Country`, `Registration number` each map to their own configured Airtable column via `app_settings.airtable_contact_field_config`. `patchClientProfileFields` uses a `setIf(airtableField, portalValue)` helper — one PATCH per non-empty field. Empty portal values never overwrite Airtable. Kieran owns column creation in his base; admin then updates the config keys. (The old single-line `composeAddress` helper was removed.)
- **Pre-flight duplicate match on Add Client.** `airtable-find-matching-clients` (admin-gated) strips `Limited` / `Ltd` / `Inc` / `LLC` / `Studio(s)` suffixes from both sides and runs a bidirectional subset match, returning up to 5 candidates with representative + project count. `admin-create-client` accepts an optional `airtableClientId` to link the new account to the chosen row instead of creating a duplicate.

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
| `round_rescheduled` | Portfolio.tsx | client |
| `password_set` | SetPassword.tsx (initial), Account.tsx (change) | client / admin |
| `manual_invite_generated` | ManualInviteModal | admin |

### Actor role reliability

`logActivity()` accepts an optional `actorRole` override. All admin-only call sites pass `actorRole: "admin"` explicitly. Mixed-context callers (TaskDetail, AssetViewer) rely on the DB lookup. Client login entries always hardcode `actor_role: "client"`. Dropbox/system events hardcode `actor_role: "system"`.

## Ghost mode

Admin can view the portal as any client:
- Clients page — click the ghost icon on the left of each client row
- `enterGhostMode({ userId, name })` from `AuthContext`

The `GhostModeBanner` is fixed-position at the top. The client sidebar and layout offset by the banner height so nothing is obscured.

## Client Agreement

Version: SSS-CA-v2.0, 14 clauses. Content in `src/lib/agreementTerms.ts`. Replaces all previous agreement versions. Signed agreements stored in `agreements` table, PDF generated via `accept-agreement` edge function.

## Local tooling

- **`scripts/` is gitignored — local-only.** Shell diagnostics and one-off jobs live in named scripts there, not inline `cd ... && cmd` chains. Established scripts: `scripts/sql.sh` (SQL via the Supabase Management API), `scripts/delete-auth-users.sh` (orphan auth-user cleanup). Build new named scripts as needed and reuse them within a session.
- **PDF generation with non-ASCII names.** jsPDF's built-in fonts are WinAnsi-only and mangle Latin Extended-A characters (`Srđan`, `Bogdanović`). The `scripts/generate-subcontractor-letter.ts` pattern reads `/System/Library/Fonts/Supplemental/Georgia*.ttf` (regular + bold + italic) at runtime and registers them via `addFileToVFS` + `addFont` for clean coverage. Reuse this approach for any PDF containing non-ASCII names.

## Pending

- **Quotation number auto-generation** — quotation numbers should be auto-generated from the account's `client_code` + sequence (e.g. `WIN-001`, `WIN-002`). Currently entered manually. Logic should live in `QuotationFormDialog` or a DB trigger.
- **Clean up test invoices** — several test/dummy invoices in the database from development. Delete or archive before going live with real clients.
- **Sidebar nav customisation** — review and finalise which nav items appear for each user type; hide any admin-only or unbuilt routes that clients might see.
- **Quotation + invoice PDF generation** — edge functions for generating PDFs using `_shared/pdfUtils.ts` design config not yet built. Currently PDFs are generated client-side only.
- **Client correction flow not built** — client clicks Review on dashboard → full-screen overlay with pins → Submit corrections → creates Round 02 → countdown resets. Currently admin-only round creation.
- **New commission brief flow not built** — 3-step overlay from idle dashboard state.
- **Airtable inbound webhook not set up** — `pull-status` is currently manual only.
- **Pre-launch ghost mode test** — ghost into each active client account and walk through the full client flow before any real client is invited.
- **Brief field in Airtable** — Kieran needs to add a `Brief` field to the Tasks table for instructions sync to work.
- **Email from address** — `airtable-auto-sync` sends from `portal@silvershadowstudio.com`. Confirm verified in Resend.
- **SVG logo in generator** — `public/generator/images/SS - Logo 2019.svg` is not committed to git (filename has spaces, was skipped). Copy manually to that path on any new machine.

