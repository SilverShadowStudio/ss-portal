# Silver Shadow Studio — Client Portal (ss-portal)

> Keep this file lean (<40k chars; target ~32k) — it loads every session. Verbose reference/architecture detail belongs in a companion `ARCHITECTURE.md` (read on demand); `HANDOFF.md` carries state-in-motion.

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
- **Never delete, rename, or restructure existing code unless the task explicitly requires it. Additions are preferred over modifications; modifications over deletions.**
- **When multiple approaches exist, pick the one with the smallest blast radius — easiest to revert, least likely to break something else.**
- **Never touch files unrelated to the task at hand, even if they look wrong.**
- **Always deploy edge functions from the project root and verify with `npx supabase functions download <name>` + grep before trusting it.** A deploy run in the background or without an explicit CWD has twice silently shipped stale source while returning exit 0 + success.
- **Always run `npm run build` locally before pushing major frontend changes.** On failure Vercel silently serves the last successful build — live URL shows no error, new code never served. `tsc --noEmit` does NOT catch all build errors (esbuild syntax errors pass TS but break Vite). `npm run build` is authoritative; confirm green in Vercel before marking work complete.

## Session Routines

### Startup
1. Launch: `cd ~/code/ss-portal && claude --dangerously-skip-permissions`
2. First command: `cat HANDOFF.md && git status`
3. First prompt: "Summarise the current state in your own words — what's shipped, what's blocked, what's queued. Don't take action yet."

The HANDOFF.md prepended at the end of each session is the source of truth. Read it first, act second.

### Closing
Run in order, pause between each:
1. **Git status** — surface uncommitted changes; ask whether to commit/stash/leave. Don't commit blindly.
2. **Prepend HANDOFF.md** with a dated block at the TOP (`# Session — [date]`), sections: Completed (commit hash + one-liner), In progress / needs verification, Pending, Decisions made, Open questions / watch, URGENT next session. Commit `HANDOFF — [date] session: [summary]`; push to main.
3. **CLAUDE.md promotion review** — report candidate additions; don't write them without Fred's approval.
4. **Final git status** — working tree clean.

## Architecture decisions

- **Softr** stays for Kieran's internal production portal — do not touch it, ever.
- **Airtable** stays as Kieran's source of truth — the portal syncs to it, never replaces it.
- Two portals: client-facing (this repo) + production (Kieran's Softr).
- Supabase is owned by Fred's personal account — no dependency on Lovable.

### Two-database design (intentional and permanent)
Supabase (Postgres) and Airtable coexist by design:
- **Supabase** — authentication, RLS, client-facing data (projects, scenes, rounds, assets, orders, invoices, agreements, activity log).
- **Airtable** — Kieran's production team workflow (task assignment, modeller tracking, scene status, deadlines). Kieran owns this entirely.

Outbound: DB triggers on `scene_rounds` fire `net.http_post` to `airtable-auto-sync` on round-created / status-change / instructions-submitted (one-way, portal → Airtable). Inbound: manual `pull-status` in `airtable-sync` + the Dropbox webhook for file arrivals.

## Email deliverability

Invitation, agreement, quotation, and invoice emails go through the edge-function + Resend pipeline. Three rules keep them domain-aligned and out of corporate filters:

- **Verify links must be on the portal domain, never `*.supabase.co`.** The `/auth/verify` rewrite in `vercel.json` proxies server-side to `…supabase.co/auth/v1/verify` so the visible link matches the `silvershadowstudio.com` sender (DMARC). `buildPortalVerifyUrl(properties, fallback)` in `admin-create-client` composes these from `generateLink()` for all three modes (`resend`/`magiclink`/`invite`), falling back to `action_link` when token components are missing. Does not cover Supabase's own auth emails (password reset) — those stay on `supabase.co`.
- **Email images are portal-hosted under `public/email-assets/`, never S3 or base64** (`amazonaws.com` gets down-ranked; `data:` URIs don't render in Outlook desktop `<img>`). Canonical `LOGO_URL`/`illustrationUrl` live in `_shared/emailTemplates.ts`, but four functions carry their own `LOGO_URL` copies (`accept-agreement`, `send-quotation-email`, `send-delivery-notification`, `send-invoice-email`) — **change all of them together.**
- **Sender is `portal@silvershadowstudio.com`.** Watch item: the Katharine Pooley corporate filter soft-bounces it even after the fix. Don't change sender strategy until the Resend webhook is ingesting bounce reasons.

`send-transactional-email` is **legacy** (uses `LOVABLE_API_KEY`, no longer valid) — **do not use.**

## Auth + activity logging

- **Phantom-login guard.** The `SIGNED_IN` handler in `AuthContext.tsx` inserts a `client_login` row only when `auth.users.last_sign_in_at > lastLog.created_at + 10s` (skew tolerance). Comparing against the server-side `last_sign_in_at` (not a local ref) also de-dupes synthetic `SIGNED_IN` events across tabs/devices (token refresh, cross-tab storage sync, focus regain). Without it, one continuous tab session logged six phantom logins.
- **`session_end` idempotence.** `useClientActivityTracker.ts` guards `session_end` with a `sessionEndedRef` boolean so it fires at most once per session — both the `pagehide` and `visibilitychange` beacon paths share the guard. Reset on each new `session_start`.
- **`admin-delete-account`** (admin-gated cascade delete) deletes the account row first so `account_members` cascades, then removes orphan `auth.users` — and **always preserves `fred@silvershadowstudio.com`.** Returns deleted/preserved/failed.

## Kieran — critical context

Kieran is Production Director. He built and maintains the entire Softr portal himself (25+ blocks, per-user-group views, conditional logic, permissions) and is the only person who touches it.

The new portal replaces only the client-facing layer. Clients previously logged into Softr; they now log into this portal. Everything else Kieran does in Softr is unchanged. The handshake is Airtable: when Kieran updates a task status, the client sees it via the sync.

His stated concern — "we don't ultimately know how it works or how to fix it" — is legitimate. Keep the Airtable sync simple, well-documented, and debuggable by a non-engineer.

Rules:
- Never ask Kieran to do anything in the portal codebase — all requests go through Fred.
- Never suggest replacing or augmenting Softr unless Kieran explicitly asks.
- Never suggest migrating away from Airtable.
- If Kieran ever wants his own admin view inside this portal, build it to his exact spec without touching anything he does in Softr.

## Live

- **URL**: https://portal.silvershadowstudio.com
- **Repo**: github.com/SilverShadowStudio/ss-portal (private)
- **Deploy**: Vercel auto-deploys on push to `main` (~30s)

## Stack

React 18 + TypeScript + Vite 5 · Tailwind CSS 3 · Framer Motion · Supabase (Postgres + Auth + Storage + Edge Functions) · Vercel · Dropbox API (render delivery) · Airtable API (Kieran's tracker) · Resend (transactional email — `RESEND_API_KEY` set, `silvershadowstudio.com` verified, DNS via Squarespace) · Stripe (live; see Stripe section).

## Supabase

- **Project ID**: `oodhsoiwnqxcimzmzick` · **URL**: `https://oodhsoiwnqxcimzmzick.supabase.co`
- Owned by Fred's personal account (fred@silvershadowstudio.com). Access token in password manager (Dashboard → Account → Access tokens).
- Deploy: `SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <name> --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt`
- Connection is **hardcoded** in `src/integrations/supabase/client.ts` (which exports `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`) — Vercel env vars are NOT used (Lovable's integration previously injected them and caused conflicts).
- **OTP expiry**: 604800s (7 days) via Auth settings API — invitation links valid for 7 days.

### Calling action-routed edge functions from the frontend
`dropbox-api` (and any function routing via `?action=...`) cannot use `supabase.functions.invoke` — that method can't append URL query params. Use a direct `fetch` to `${SUPABASE_URL}/functions/v1/<fn>?action=...` with headers `Authorization: Bearer <session access_token>`, `apikey: SUPABASE_PUBLISHABLE_KEY`, `Content-Type: application/json`. Get the token from `supabase.auth.getSession()`; both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are exported from `src/integrations/supabase/client.ts`.

## Git / Deploy workflow

```bash
cd ~/code/ss-portal && git add . && git commit -m "description" && git push origin main
# Vercel deploys automatically
```

- **No co-author lines.** Co-author trailers cause Vercel to reject deployments. Never use `--co-author` or Claude's default co-author footer.
- **Git identity**: `git config user.name "Fred Colomb"` / `git config user.email "fred@silvershadowstudio.com"`.
- **SSH keys** configured on both machines (push needs no password). Mac Pro: `fc1` (`/Users/fc1/code/ss-portal`); MacBook: `fc2`.

## Vercel routing

`vercel.json` has an SPA catch-all rewrite for React Router: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`. Without it, direct URL navigation (e.g. `/admin/clients`) 404s.

- The `/auth/verify` rewrite (email deliverability) must be listed **before** the SPA catch-all — Vercel evaluates in order and the catch-all would otherwise swallow it.
- Real files under `public/` (manifests, service workers, icons) are served as static assets *before* rewrites (afterFiles phase). New `public/` files never need a `vercel.json` entry.

## PWA (installable portal)

- **`public/manifest.json`** — `display: standalone`, `theme_color: #1A1814` (charcoal), `background_color: #EDE8E0` (cream), icons 192 + 512 `purpose: "any maskable"`.
- **`public/service-worker.js`** — minimal install-eligibility worker, online-only: `install`→`skipWaiting()`, `activate`→`clients.claim()`, empty `fetch` handler (no caching). Browsers require a registered SW with a fetch handler before offering install. **No offline support** — if caching is added later, a versioning/update story is needed.
- **`src/components/PWAInstallPrompt.tsx`** — branded bottom banner; shows only when signed in + 30s dwell + browser fired `beforeinstallprompt` + not already standalone. `localStorage["pwa-prompt-dismissed"]="1"` suppresses re-prompting. iOS Safari shows an "Add to Home Screen" variant. SW registered in `src/main.tsx` (feature-guarded).
- **Icons bake the charcoal background in** (not transparent) for clean maskable cropping; 14% inset keeps the glyph in the safe zone.

## Project structure

Lean map — see the dedicated section per system for detail.

```
src/pages/      Index (client dashboard state machine), Portfolio, Timeline, Delivery, Orders,
                Documents (Agreement/Quotations/Invoices), Contract, SetPassword, Auth
src/pages/admin/ AdminDashboard, AdminClients, AdminProjects (main workhorse), AdminOrders,
                AdminScenes, AdminFinance, AdminInvoices (Invoices/Quotations/Generator),
                AdminTimeline, AdminBatchUpload, AdminActivity, AdminSettings,
                AdminProductionTracker, AdminDocuments (Agreements/Design/Email), AdminClientProfile
src/components/ AdminSidebar, ClientSidebar (both import lib/sidebarConstants), AdminLayout,
                ClientLayout, GhostModeBanner, PWAInstallPrompt; admin/* (Dropbox+Airtable panels,
                ActivityLogPreview, ClientActivityPanel, SceneCard, Invoice/QuotationFormDialog,
                QuotationsTab, AssetUploader); quotations/ (QuotationViewer, QuotationDocument);
                client/ (TaskDetail, AssetViewer, PinChat, LaneCard); ui/SmartImage
src/lib/        design.ts, sidebarConstants.ts (SB), agreementTerms.ts, activityLog.ts,
                reviewWindow.ts, clientActivity.ts, invoiceUtils.ts
src/contexts/AuthContext.tsx (auth + ghost mode) · src/integrations/supabase/{client.ts,types.ts}

supabase/functions/  Dropbox: oauth-start/-callback, api, webhook, scan-visuals,
                create-project-folder, create-scene-folder.  Airtable: sync, auto-sync, list-models,
                sync-contact, sync-project, find-matching-clients.  Client/account: admin-create-client,
                admin-impersonate-client, admin-delete-account, admin-generate-manual-invite,
                parse-signature.  Docs/email: accept-agreement, send-quotation-email, send-invoice-email,
                sign-quotation, download-invoice-pdf, preview-email, update-email-config, resend-find-email.
                Stripe: create-invoice-checkout, stripe-webhook.  slack-notify.
                (send-transactional-email = LEGACY, do not use.)
  _shared/      emailTemplates.ts (buildInviteEmailHtml, InviteEmailConfig+subject),
                pdfUtils.ts (DocumentDesignConfig, loadDesignConfig), brandLogo.ts
supabase/migrations/  applied in filename order via Supabase Management API

public/generator/  Standalone invoice generator (static HTML/JS): index.html (form), display.html
                (Invoice A), display2.html (Invoice B), script.js, styles. Accepts URL params
                client/address/contact/registration. images/SS - Logo 2019.svg NOT in git — copy
                manually (see Local tooling).
public/         manifest.json, service-worker.js, icons/ (PWA)
```

## Client dashboard — state machine (Index.tsx)

Single focused view; exactly one state per client at a time:
1. **delivered** — new renders just delivered, countdown to review deadline
2. **countdown** — review window open, time remaining
3. **review** — client in review (pins / corrections)
4. **order** — pending order to confirm
5. **idle** — nothing active; new commission brief CTA

## Design system

### Colours
- Background `#151517` (`hsl(240 5% 9%)`) · Sidebar `#111113` (`hsl(240 5% 7%)`) · Gold `hsl(36 35% 57%)` via `--gold`.
- All colours via CSS variables — never hardcode hex.

### Typography
- Headings: Cinzel (serif), `font-serif`. Body/UI: Arial/sans, `font-sans`.
- Nav labels: 11px uppercase, `tracking-[0.24em]`. Eyebrow labels: 9px uppercase, `tracking-[0.28em]`, `text-foreground/40`.

### Rules
- No `rounded-full` buttons · No bullet points in UI copy · No emojis in UI · No bold in prose.
- Gold for active states and key highlights only. Sharp rectangular components (`rounded-sm` at most).
- All design tokens in `src/lib/design.ts` — import from there, never hardcode.

### Sidebar constants
Both `AdminSidebar` and `ClientSidebar` import from `src/lib/sidebarConstants.ts` (the `SB` object). Never hardcode sidebar widths, nav font sizes, or account row styles — use `SB.*`. Key values: `SB.widthExpanded = "w-64"`, nav label `fontSize: 11, letterSpacing: "0.24em"`, account name `12px text-foreground`.

## React component patterns

### DOM-driven hover effects in canvas-style components
For per-frame updates driven by mouse position (e.g. a Gantt column highlight), update the DOM directly via a `ref`, not `setState` — `setState` at 60fps forces a full re-render per frame. **Pattern**: keep a `ref` to the overlay element; in `onMouseMove` update `ref.current.style.left`/`display` directly; `onMouseLeave` hides it. Established in `ProductionGantt.tsx` (`hoverColRef`).

### Dialogs must be mounted unconditionally
`<Dialog open={state}>` only responds to state changes when mounted. If nested inside a conditional that can unmount it (e.g. `{!selectedClient && (...)}`), `setDialogOpen(true)` has no mounted consumer — the trigger appears dead. **Rule**: render Dialogs unconditionally at the component root; convert `DialogTrigger` to plain `<Button onClick={() => setOpen(true)}>` when trigger and Dialog are in different conditional scopes. First suspect whenever a modal button is inert (cost two diagnostic sessions).

## Database key tables

| Table | Purpose |
|-------|---------|
| `accounts` | Client accounts — `client_code TEXT UNIQUE` (3-letter code for quotation numbering) + `airtable_client_id TEXT` (canonical hard link to the Airtable Clients record; name lookup is fallback-only) |
| `account_members` | User ↔ account links |
| `projects` | `project_code`, `project_slug`, `dropbox_folder`, `dropbox_folder_url` |
| `scenes` | `scene_code`, `scene_slug`, `airtable_record_id`, `dropbox_folder` |
| `scene_rounds` | Rounds per scene — `instructions`, status, `delivery_due_at`, `start_date`/`end_date`, `delivered_at`/`approved_at`, `buffer_weeks INT DEFAULT 1` (idle gap before next round), `is_legacy`/`legacy_source_path` |
| `round_assets` / `round_uploads` | Render files per round / client briefing files |
| `activity_log` | Immutable production-critical actions |
| `lane_tasks` / `subscriptions` | Subscription lane tasks / lane subscriptions |
| `orders` | Project orders |
| `invoices` | See Invoice system (`quotation_id`, `type`, stripe fields, `invoice_number`, `line_items`, totals) |
| `quotation_documents` | See Quotation system (`quotation_number`, `line_items`, `deposit_percentage`, signed fields, totals, status) |
| `agreements` | Signed client agreements (SSS-CA-v2.0) |
| `client_notifications` / `dropbox_connections` | In-app notifications / Dropbox OAuth tokens |
| `client_activity` | Session tracking (`kind`: session_start / session_end / page_view) |
| `app_settings` | Key-value config — `airtable_field_config`, `airtable_contact_field_config`, `email_invite_config` (incl. `subject`), `document_design_config` |
| `user_roles` | Admin role assignments |

Migrations applied in filename order via the Supabase Management API; full list in `supabase/migrations/` (latest: `20260610000001_scene_rounds_legacy.sql` — `is_legacy`/`legacy_source_path`).

## Client codes

Every account can have a 3-letter `client_code` (e.g. `WIN` for Winch Design), used as a quotation-number prefix (`WIN-001`). Set in the Add Client dialog, which suggests up to 8 codes from the company name as clickable chips. Stored in `accounts.client_code`.

## Quotation system

- **Table** `quotation_documents`. Created via `QuotationFormDialog` (AdminInvoices); viewed via `QuotationViewer` (full-screen) + `QuotationDocument` (A4 HTML).
- **Signing flow**: `QuotationViewer` shows a gold "Sign" button when status is `sent`; admin/client enters name + position → `sign-quotation` sets `status='signed'` + `signed_at`/`signed_by_name`/`signed_by_position` and auto-creates a deposit invoice (`type='deposit'`, due 5 days later).
- **Deposit %**: `deposit_percentage` (default 50), shown in the form and reflected in the deposit invoice. Status: draft/sent/signed/declined/cancelled.

## Invoice system

- **Table** `invoices`. **Types**: `deposit` (auto-created on quotation signing), `balance` (manual), `standalone` (default, legacy).
- **Stripe**: `stripe_checkout_url` stored when a checkout session is created; `stripe_payment_intent_id` stored when the webhook fires `checkout.session.completed`.

## Stripe integration

- **Account**: Silvershadow Studio Limited. **Bank**: Revolut Business (sort 04-00-75, acct 75913542). **Payout**: weekly, Monday. **Descriptor**: SILVERSHADOW.
- **Secrets** (set in Supabase): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **Webhook** (registered, event `checkout.session.completed`): `…/functions/v1/stripe-webhook`.
- **Functions**: `create-invoice-checkout` (creates session; returns `{ pending: true }` if key missing) · `stripe-webhook` (marks invoice paid, stores `stripe_payment_intent_id`). Payment-link button in the invoice table; debug via Dashboard → Functions → Logs.

## Document design system

All PDF-generating edge functions read their visual config from `app_settings` key `document_design_config` at generation time via `_shared/pdfUtils.ts → loadDesignConfig()` (defaults in `DESIGN_DEFAULTS` there — colours, fonts, logo width, margins). Editable at `/admin/documents` → Design tab. Changes affect new PDFs only; existing documents are unaffected.

## Documents admin page (`/admin/documents`)

Three-tab hub (replaces the old agreements page + standalone `/admin/email-preview`, which still exists as an unlinked route):
- **Agreements** — signed list, preview (AgreementViewer), download PDF.
- **Design** — `document_design_config` editor + three live preview cards (Quotation, Invoice, Round Instructions).
- **Email** — invitation email configurator (subject, illustration, body, CTA, footer, background) with live iframe preview. Saves to `email_invite_config` via `update-email-config`. Subject used by `admin-create-client` for invite + resend.

## Email invite configuration

Stored in `app_settings` key `email_invite_config`. Fields: `subject` (default "Your Silver Shadow Studio portal is ready."), `illustrationUrl`, `bodyCopy`, `ctaLabel`, `ctaUrl`, `footerText`, `backgroundColor`. `subject` is read by `admin-create-client` in both invite and resend modes (falls back to default).

## Email signature parser

In the Add Client dialog, "Parse Signature" → `parse-signature` (admin-only) sends a pasted email signature to Anthropic `claude-sonnet-4-20250514`, returning `{ first_name, last_name, position, company_name, email, country, city }`. Only empty form fields are populated — existing values never overwritten. Requires `ANTHROPIC_API_KEY`.

## Resend invitation

On `AdminClientProfile.tsx`, a "RESEND INVITATION →" button appears when the client has not yet signed (checked against `agreements`). It calls `admin-create-client` `mode:'resend'`, which generates a new `magiclink` (not `invite` — that fails `email_exists` for existing users) and sends the branded email. The button disappears once the client signs.

## Manual invite + clipboard rules

For recipients blocked by corporate filters (system send soft-bounces), the admin hand-delivers via `ManualInviteModal` + `admin-generate-manual-invite`.
- **`magiclink`, not `invite`** — `invite` 400s for already-registered users; `magiclink` works for any existing user (confirms + signs in on click).
- **HTML byte-identical to system mail** — rendered with `buildInviteEmailHtml` + `app_settings.email_invite_config` + `loadBrand()`; returns `verify_url` + `email_html`, does NOT send. Admin copies and forwards manually.
- **Clipboard (Safari-safe)** — uses `navigator.clipboard.write([ClipboardItem])` with `text/html` + `text/plain` blobs **pre-built via `useMemo`**, so the handler has zero awaits before `.write()` (Safari only accepts it inside a synchronous user gesture). Fall back to `clipboard.writeText(text)` when `ClipboardItem` is undefined.

## /set-password error handling

`SetPassword.tsx` reads the URL hash on load (before any async work), since Supabase appends error params when an invite link is invalid/expired: `error_code=otp_expired` → an "expired, contact us" message; any other `error` → an "invalid link" message. Error state renders immediately with no spinner, so clients always see a clear message; "Return to login" navigates to `/`.

## Dropbox

Connected and working; webhook registered for auto-sync on file changes.

### File naming convention
```
/00_Production/PRD01_Client-Projects/CP107_Charles-Street/SC05_Facade/VS_Visuals/CP107-SC05-VS_R01_01.jpg
  CP107 = project_code · SC05 = scene_code · VS = visual type (portal only shows VS_ files)
  R01 = round number · 01 = version (app shows highest version per round)
```

### Setting up a scene for Dropbox sync
In DropboxVisualsPanel, enter only the short codes (`project_code` e.g. `CP107`, `scene_code` e.g. `SC05`). `dropbox-scan-visuals` resolves the full path by searching for a folder starting `CP107_` inside `/00_Production/PRD01_Client-Projects/`, then `SC05_` inside that. Case-insensitive.

### Team namespace (Dropbox Business) — required header
All files live in the team namespace, not the personal root. `dropbox-scan-visuals` and `dropbox-webhook` detect this by calling `/2/users/get_current_account`, reading `root_info.root_namespace_id`, and passing a **`Dropbox-API-Path-Root` header on every subsequent API call**. Without it, all path operations return `path/not_found`.

### Web URL format
A folder's web URL is `https://www.dropbox.com/home` + `path_display`, stored in `projects.dropbox_folder_url`. **Caveat**: unverified for Business team accounts — `/home` may need a namespace-aware variant (e.g. `/home/Team%20Space` + path). Verify before surfacing to clients.

### Zero scene matches — check the folder path first
When a linked project shows zero results in Add Scene, suspect `projects.dropbox_folder` pointing at a non-existent path before assuming a fuzzy-match bug — the function silently returns `{ folders: [] }` on `path/not_found`. Verify with `list_folder` on `projects.dropbox_folder` (with the team namespace header).

### DB trigger bypass — linked projects and scenes
When onboarding an existing project/scene (already has a Dropbox folder), the INSERT-triggered functions must NOT create new folders. The bypass signal is a **non-null `project_code` or `dropbox_folder`** on the INSERT record:
- `dropbox-create-project-folder` skips if `record.project_code` or `record.dropbox_folder` is set.
- `dropbox-create-scene-folder` skips if `record.scene_code` or `record.dropbox_folder` is set.
- `airtable-sync-project` honours a pre-set `project_code` rather than auto-incrementing, so onboarded projects don't mint a duplicate code.

No migration needed — the pattern relies entirely on the INSERT payload.

## Airtable sync

Kieran's tracker remains his source of truth; the portal syncs to it (one-way for round events via `airtable-auto-sync`, bidirectional on demand via `airtable-sync`). **Base**: `AIRTABLE_BASE_ID` · **PAT**: `AIRTABLE_PAT` (both secrets).

### Tasks table — `tbleHaU9DxHyvixdL` (the only table the portal reads from)
- **Accountable to** — linked record to Users; freelancer assignment, never exposed to clients.
- **Status** — single-select, exactly four values in order: `🔴 TO DO`, `🟡 IN PROGRESS`, `🟠 REVIEW`, `🟢 DONE`.
- **Last Modified Time Status** — auto timestamp of the last status change; closest proxy to completion (not a true "done at" — a task can be marked DONE and revisited).
- No "task accepted" timestamp, no "rejected" status — freelancers communicate directly.

### Portal field mapping (stored in `app_settings.airtable_field_config`)
| Panel label | Airtable field |
|---|---|
| Scenes table | Tasks table (`tbleHaU9DxHyvixdL`) |
| Portal Scene ID field | _(blank — portal stores Airtable record ID in `scenes.airtable_record_id`)_ |
| Scene name field | `Task name` |
| Status field | `Status` |
| Delivery date field | `Deadline` |
| Round field | _(confirm via panel)_ |

### Status mapping
`🔴 TO DO`→`pending` · `🟡 IN PROGRESS`→`in_production` · `🟠 REVIEW`→`awaiting_review` · `🟢 DONE`→`approved`.

### Portal ↔ Airtable boundary rules
- **Reads**: only the Tasks table (Status, deadline, scene/round identifiers), only for client-facing display.
- **Writes**: one-way to Airtable for studio ops (Users / Clients / Projects sync per `airtable-sync`) — Kieran's workflow, not client display.
- **Never**: the portal does not read or surface Scene Manager Day Logs, the Cost/Budget table, Team Holiday Tracker, or the Scene-Manager / Modeller Invoices tables. These are internal/payroll-only.

### Actions on `airtable-sync`
`push-scene` (create/update a Task row, store record ID in `scenes.airtable_record_id`) · `push-status` (write round status as emoji value) · `pull-status` (read Status + Deadline → update `scene_rounds.status` + `delivery_due_at`) · `get-config`/`set-config` (field mapping) · `get-fields` / `probe-records` (debugging).

### Client + project outbound sync (Clients table)
Separate from the read-only Tasks sync. The portal writes client/project records into Airtable's Clients table via `airtable-sync-contact` and `airtable-sync-project`.
- **Canonical link is `accounts.airtable_client_id`.** `resolveAndStoreCompanyRecordId` resolves stored-id-first (with a 404 re-check), falls back to a `company_name` lookup only on the first-ever sync, then writes the id back. Replaced name-equality re-resolution, which forked the link and silently created duplicate Clients rows whenever a name diverged.
- **Address syncs as six separate fields, additively** (`Building number`, `Street name`, `City`, `Postcode`, `Country`, `Registration number`), each mapped via `app_settings.airtable_contact_field_config`. `patchClientProfileFields` uses `setIf(field, value)` — one PATCH per non-empty field; empty portal values never overwrite Airtable. Kieran owns column creation; admin updates the config keys.
- **Pre-flight duplicate match on Add Client.** `airtable-find-matching-clients` (admin-gated) strips `Limited`/`Ltd`/`Inc`/`LLC`/`Studio(s)` suffixes and runs a bidirectional subset match (up to 5 candidates). `admin-create-client` accepts an optional `airtableClientId` to link the new account instead of creating a duplicate.

## Activity log

All production-critical actions are recorded in `activity_log`. Full log at `/admin/activity` (badge filters by event type + date range, **2000-row limit**); preview on the admin dashboard via `ActivityLogPreview`.

| Action | Logged by | Actor |
|---|---|---|
| `project_created` / `project_archived` / `project_restored` | AdminProjects / ArchiveProjectDialog | admin |
| `scene_created` | AdminScenes | admin |
| `round_created` | AdminScenes (R01), dropbox-webhook (auto) | admin / system |
| `asset_uploaded` | TaskDetail, AssetUploader | admin |
| `asset_approved` / `revision_requested` | AssetViewer | client |
| `client_created` | AdminClients | admin |
| `client_registered` / `client_login` | AuthContext (first / subsequent login) | client |
| `agreement_signed` | accept-agreement | client |
| `dropbox_file_received` | dropbox-webhook | system |
| `round_rescheduled` | Portfolio.tsx | client |
| `password_set` | SetPassword.tsx / Account.tsx | client / admin |
| `manual_invite_generated` | ManualInviteModal | admin |

`logActivity()` accepts an optional `actorRole` override. Admin-only call sites pass `actorRole:"admin"`; mixed-context callers (TaskDetail, AssetViewer) rely on the DB lookup; client login hardcodes `client`; Dropbox/system events hardcode `system`.

## Ghost mode

Admin can view the portal as any client: Clients page → click the ghost icon on the left of a row; `enterGhostMode({ userId, name })` from `AuthContext`. `GhostModeBanner` is fixed at the top; the client sidebar and layout offset by the banner height.

## Client Agreement

Version SSS-CA-v2.0, 14 clauses. Content in `src/lib/agreementTerms.ts`. Replaces all previous versions. Signed agreements stored in `agreements`; PDF generated via `accept-agreement`.

## Local tooling

- **`scripts/` is gitignored — local-only.** Shell diagnostics/one-off jobs live in named scripts there, not inline `cd ... && cmd` chains. Established: `scripts/sql.sh` (SQL via Management API), `scripts/delete-auth-users.sh` (orphan cleanup). Build new named scripts and reuse within a session.
- **PDF with non-ASCII names.** jsPDF built-in fonts are WinAnsi-only and mangle Latin Extended-A (`Srđan`, `Bogdanović`). `scripts/generate-subcontractor-letter.ts` reads `/System/Library/Fonts/Supplemental/Georgia*.ttf` (regular/bold/italic) at runtime via `addFileToVFS` + `addFont`. Reuse for any PDF with non-ASCII names.
- **PWA icon generation.** `scripts/generate-pwa-icons.mjs` composites the wing mark onto a solid `#1A1814` background at 14% inset → `public/icons/icon-192.png` + `icon-512.png`. Requires `sharp` installed transiently (`npm install sharp --no-save --legacy-peer-deps`) — **never add `sharp` to `package.json`.** Re-run only when the source icon changes.
- **Generator brand logo.** `public/generator/images/SS - Logo 2019.svg` is NOT committed (filename has spaces). Copy it manually to that path on any new machine.

## Pending

Backlog (not-built features, cleanup, deferred work) is tracked in `HANDOFF.md`, not here — see the latest session block.
