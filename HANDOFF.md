# Handoff Log

## How to use this file

This is the rolling session log. Each session appends a new block at the top. `CLAUDE.md` carries the stable rules, architecture, and migration history; `HANDOFF.md` carries the moving parts: what shipped, what's mid-flight, what's pending, and what was learned.

**Promotion policy.** At the end of each session, review findings in HANDOFF.md. When a finding has stabilised into a durable rule, architectural decision, or piece of stable context, promote it to `CLAUDE.md`. HANDOFF.md should not accumulate rules — it is for state in motion. CLAUDE.md should not accumulate session noise — it is for rules at rest.

---

# Session — 18 May 2026

Long session, 19 commits. Two major threads: (1) plumbing the delivery-notification email queue end-to-end and wiring it into the actually-active scan path, and (2) a sweep of UI polish — image performance, unified loader, sidebar/menu tightening, and a documents-page accordion. Head: `dc960e3` on `origin/main`.

## Completed this session

### 1. Documents / HANDOFF split (`74a0f2b`)
- Replaced `CLAUDE.md` (rules at rest) and `HANDOFF.md` (state in motion) per the agreed split. Promotion policy now documented at the top of HANDOFF.md.

### 2. AdminClients header → filtered Projects view + `account_id` fix (`04e2afb`, `0edb8e9`, `1462c6e`)
- `AdminClients.tsx`: header card click now navigates to `/admin/projects?client=<account_id>` instead of the profile page; the existing "Edit profile" dropdown item still routes to `/admin/clients/<account_id>` so the profile stays reachable.
- `AdminProjects.tsx`: the `?client=` query param was being treated as `user_id`; now resolved as `account_id` via `account_members` lookup, mapped to the set of user_ids on that account, and matched against the project list. Synthetic empty entry built when no projects exist for any user on the account. Renamed local `clientParam → accountParam`.
- `Client` interface extended with `account_id: string | null`. Header now renders a 10px uppercase **"View profile →"** link when `selectedClient && !selectedProject && selectedClient.account_id` — routes back to `/admin/clients/<account_id>`. Live SQL sanity-checked the data path.

### 3. Per-client email history in admin profile (`224bedb`)
- New edge function `list-client-emails` (admin-gated, deployed). Resolves all `auth.users.email` for an account via `account_members`, paginates Resend `GET /emails` (cap 5 pages × 100 = 500), filters server-side by recipient, returns `[{ id, to, from, subject, created_at, last_event }]` plus a `warning` field on Resend errors.
- New edge function `get-client-email` (admin-gated, deployed). Calls Resend `GET /emails/{id}`; returns full HTML + metadata. `events: []` is a single-entry array derived from `last_event` — Resend doesn't expose a per-email event timeline via API.
- `AdminClientProfile.tsx`: new "Emails" section below Account-owner. Row format: date / recipient / subject / status badge (tone-coloured by `last_event`). Click → 4xl Dialog with sandboxed `iframe srcDoc={html} sandbox=""` preview.

### 4. `.catch()` on PostgrestBuilder sweep (`42b5913`)
- Same class of bug fixed earlier today for `sign-quotation` / `sign-freelancer-documents`. Found four more in `dropbox-scan-visuals/index.ts:353` and three in `dropbox-webhook/index.ts:66, 367, 452` — all on `supabase.from("activity_log").insert(...).catch(...)`. Rewritten with `await ... destructure { error }` + `if (error) console.warn`.
- Audited all 36 `.catch(` call sites in `src/` and `supabase/functions/`. The four above were the only PostgrestBuilder targets; rest are correctly on real Promises (`fetch`, `resp.json`, `storage.createBucket`, `auth.admin.deleteUser`, `functions.invoke`, `navigator.clipboard.writeText`, `downloadWithDrawings`). Documented in HANDOFF.

### 5. Dropbox team namespace headers in `dropbox-api` (`4bf5c53`) + `dropbox-webhook` (`361357f`)
- Same fix landed in two passes. Both functions now call `/2/users/get_current_account` after token refresh, read `root_info.root_namespace_id`, and pass `Dropbox-API-Path-Root: {".tag":"namespace_id","namespace_id":"<id>"}` on every subsequent path-based call.
- `dropbox-api`: threaded into all four call sites — `get-temporary-link`, `get-thumbnail`, `list-folder`, `rescan-folder`. Live verified: same team path returns `409 path/not_found` without the header, `200` with it.
- `dropbox-webhook`: added in `processChanges` before the initial recursive `list_folder({path: "", recursive: true})`.

### 6. Delivery-notification email queue end-to-end (`04fddac`, `47fbab0`, `66d9489`)
- **Migration `20260518000001_delivery_notification_queue.sql` applied.** New table `pending_delivery_notifications` (id, scene_round_id → scene_rounds, account_id → accounts, send_at, sent_at, payload jsonb, attempts, last_error, created_at). Partial index `(send_at) WHERE sent_at IS NULL` for cron lookups; partial unique index `(scene_round_id) WHERE sent_at IS NULL` as the idempotency guard. RLS admin-only via `is_admin()`. pg_cron job `dispatch-pending-deliveries` scheduled `*/5 * * * *` calling `https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dispatch-pending-deliveries` (jobid 1, active).
- New edge function `send-delivery-notification` (deployed). Takes `{ pending_id }`, resolves recipients (preferring the payload snapshot, falling back to live `account_members → auth.users.email`), builds HTML matching `_shared/emailTemplates.ts` (logo, `#EDE8E0` background, Georgia serif body, 11px uppercase CTA), sends via Resend, stamps `sent_at` on success or `attempts + 1, last_error` on failure.
- New edge function `dispatch-pending-deliveries` (deployed). Cron target. Pulls up to 50 due-but-unsent rows ordered by `send_at` asc, calls `send-delivery-notification` for each via server-to-server fetch with the service-role bearer. Live smoke-tested: empty queue returns `{"processed": 0}`.
- `dropbox-webhook/index.ts`: added `computeUkSendAt(now)` (Europe/London 09:00–20:00 send-immediate, else next 09:00 UK via Intl + offset iteration to handle BST/GMT) and `enqueueDeliveryNotification` helper. Called inside `deliverRound` right after the activity_log insert.
- **Deep-link CTA** (`47fbab0`): payload now carries `project_id / scene_id / round_id`; `send-delivery-notification` assembles `https://portal.silvershadowstudio.com/portfolio?project=…&scene=…&round=…`. `Portfolio.tsx` auto-drill `useEffect` extended to read `useSearchParams()` (URL params take precedence over `location.state`; cleared via `navigate(location.pathname, { replace: true })` after consume). `ProtectedRoute.tsx` redirects to `/auth` with `state={{ from: location }}`; `Auth.tsx` reads `state.from` and uses `${pathname}${search}` as the post-login target so email clicks survive the login round-trip.
- **Helper extracted to shared file** (`66d9489`): `supabase/functions/_shared/deliveryNotification.ts` now owns `computeUkSendAt` + `enqueueDeliveryNotification`. Both `dropbox-webhook` and `dropbox-scan-visuals` import from it.
- **Wired into the actually-active path**: `dropbox-scan-visuals/index.ts` now calls `enqueueDeliveryNotification` inside its `if (!DELIVERED_STATES.includes(dbRound.status))` block, right after the activity_log insert. The gate enforces "only on actual delivery transitions"; the DB unique index protects against duplicate enqueues from repeat scans.

### 7. Round 2+ requested directly from annotations (`c42a762`)
- `Portfolio.tsx` + `Index.tsx`: new `handleRequestNextRoundDirect()` helper. When `selectedRound.round_number > 1` (or `focus.round.round_number > 1` on the dashboard), clicking "Request Round NN" now skips the NewRoundModal entirely. Directly inserts `scene_rounds` row with `status: "pending"`, `start_date` + `end_date` from `computeRoundSchedule(now)`, `instructions: "See annotations on Round NN"`. Logs activity (`round_created`, `actorRole: "client"`, `"Round NN requested via annotations"`). Round 1 still uses the brief modal.
- Dashboard path also updates the prior round to `status: "in_production"` so it leaves the review filter (mirrors existing `handleCreateCorrections`).

### 8. ClientSidebar — team sub-label + project menu (`a692535`, `946af3c`)
- `accountSubLabel={accountType === "team" ? "Team" : (profile?.company ?? null)}` — team users now see the literal "Team" under their name.
- Account menu split: partnership keeps `Overview / Orders / Documents / Settings / Compact / Theme / Log off`. Project clients no longer see Overview or Orders. Team menu unchanged. `/dashboard` and `/orders` routes preserved in `App.tsx` for partnership clients + admin ghost mode.

### 9. Unified pulsing SS BrandLoader across 99 sites (`b6dd250`, `c1a3bca`)
- New `src/components/ui/BrandLoader.tsx` — renders `@/assets/ss-icon.png` with `brightness-0 dark:invert`, sized `sm/md/lg` (`h-4/h-6/h-10`), animated via custom Tailwind keyframe `brand-pulse` (1800ms ease-in-out, opacity 0.3 ↔ 1.0, scale 0.95 ↔ 1.05). Keyframe + `animate-brand-pulse` utility added to `tailwind.config.ts`.
- Replaced every `<Loader2 ... animate-spin>` and every ad-hoc gold-border-spinner div across 42 files. RefreshCw with `animate-spin` toggles converted to `{isRefreshing ? <BrandLoader /> : <RefreshCw />}` so the static refresh icon affordance is preserved when idle. `Loader2` imports removed where no other usage remained.
- `LoginSplash.tsx` deliberately untouched (signature entry experience).
- Cleanup commit `c1a3bca` removed an accidentally-staged 0-byte stray file named `....` that `git add -A` swept up.

### 10. Three-layer image strategy (`491ecd4`)
- **Layer 1 — Cache headers.** `dropbox-api` `get-temporary-link` and `get-thumbnail` responses now return `Cache-Control: private, max-age=3600`. 1-hour TTL stays safely under Dropbox's ~4-hour temp-link lifetime; browser-cached JSON means repeat grid renders and repeat lightbox opens skip the round-trip.
- **Layer 2 — Thumbnails in browsing views.** Portfolio.tsx and Index.tsx dashboard-hero Dropbox-preview resolution switched from `get-temporary-link` to `get-thumbnail` at `w640h480`. Storage-uploaded files keep their public URL (no thumbnail service available, per the constraint). AdminProjects only fetches `source: "upload"` assets so no Dropbox-thumb path to swap there.
- **Layer 3 — Lightbox progressive load + adjacent preload.** `AssetViewer.tsx` now keeps two URLs: `lowResUrl` (thumbnail, typically a browser-cache hit from the grid) and `thumbnailUrl` (full-res, despite the legacy name). In-page preview renders low-res in flow then full-res absolute on top, fading in via `transition-opacity duration-300` on `onLoad`. `Lightbox` component gained `placeholderSrc` prop + internal `fullResLoaded` state (resets on `src` change). New `useEffect([selectedAsset, siblingRounds, sceneRoundId])` queries `round_assets` for ±2 neighbouring round IDs, resolves their full-res URLs, fires `preloadImages(urls)` — arrow-key flicks land on already-loaded images.

### 11. Documents page polish (`6f51a03` earlier today, `0f895f9`, `dc960e3`)
- Sidebar section labels replaced with horizontal rules (`6f51a03`).
- **`SectionHeader` introduced (`0f895f9`)**: gold uppercase label flush-left, 1px `#2A2820` rule fills remaining width, optional inline action button (e.g. Orders' "View all →") replaces the rule's right end. Italic serif empty states (`EmptyState`) at `text-foreground/45`.
- **Promoted to accordion (`dc960e3`)**: each of the four categories (Client Agreement / Orders / Quotations / Invoices) is now collapsible. Single-section-open invariant; 200ms ease height + opacity animation via framer-motion's `AnimatePresence`. Header now shows `LABEL · count` (`· None` at 40% opacity when empty), with a `ChevronRight` rotating 90° on open. Default-open priority: unpaid invoice → Invoices; else missing agreement → Client Agreement; else first non-empty section; else all collapsed. 24px between collapsed headers, 48px below an expanded section.

## In progress / needs verification

- **Live end-to-end test of the delivery email queue.** Dispatcher cron is active and returns `{"processed":0}` against an empty queue. Needs a real delivery transition (admin Rescan on a scene that flips from non-delivered to delivered) to exercise the full path: enqueue → cron picks up → Resend send → row stamped `sent_at`. The `pending_delivery_notifications` table is empty as of session end.
- **CP117/SC01 round 02 image.** Dropbox file `CP117-SC01-VS_R02_10 .jpg` has a **trailing space before `.jpg`** which the scan-visuals regex `/_R(\d+)_(\d+)\.(jpg|jpeg|png|tiff|tif)$/i` correctly rejects. Round 02 row exists in DB (`29a2ec74-…`, status `pending`, kind `production`) from the Round 2+ direct flow but has zero `round_assets`. **User action required**: rename the file in Dropbox to remove the space.
- **`folder_mappings` empty across all scenes.** Diagnosed: only writer is `FolderMappingManager.tsx:116` (manual admin step); no scene was ever set up via that legacy workflow. `dropbox-webhook` returns early at line 365 with "No folder mappings configured" on every fire — the webhook is structurally dead for the current scene-code workflow. Mitigation: `dropbox-scan-visuals` now also fires the email enqueue, so email notifications work via admin Rescan. Webhook fix landed (namespace header) but functionally idle until the path is migrated or `folder_mappings` populated.

## Pending

- **`STRIPE_SECRET_KEY` is `sk_live_`.** Verified live earlier today via a one-shot diagnostic function (deployed, invoked, deleted). Any payment smoke-test still risks real money on real cards. Decision parked from previous session — recommendation: swap to `sk_test_` for dummy account flow, or use a card you control with a £1 test + refund. `INV-202605-4769`'s cached `cs_live_...` URL also still in DB and will resolve via the cache shortcut.
- **Sidebar visual diff check.** The `dca01c3` tightening landed yesterday; no live browser sweep this session. Recommend a 60-second eye-on-the-screen check at next opportunity.
- **`is_super_admin()` SQL helper + `useIsSuperAdmin` React hook.** Both implemented (`a0496f3`) but no caller / RLS policy uses them yet. Available when needed.
- **`handleMakeAdmin` in `AdminClients.tsx`** — defined but unwired (per-user actions dropdown not yet built). Re-attach when adding it.

## Decisions made

- **`dropbox-webhook` stays in code but is structurally dead** until either (a) `folder_mappings` is populated for active scenes, or (b) the webhook is migrated to scene-code resolution mirroring `dropbox-scan-visuals`. Option (b) is the recommended end-state when picked up — eliminates a manual admin step and unifies the two sync paths. Today's path-root fix is forward-compatible with either choice.
- **`scene_rounds.image_url` is and remains DEPRECATED.** Migration `20260201213741` marked the column deprecated. The actually-functional client image pipeline is `round_assets → dropbox-api/get-temporary-link` (or storage public URL for uploads). The earlier brief's framing "the webhook should populate `scene_rounds.image_url`" was rejected; the real bug was `dropbox-api` missing the team namespace header.
- **Delivery-notification queue uses option 1 (proper table + cron)**, not option 2 (one-shot cron). Trade-off: pays a schema cost for retry visibility, idempotency, and debuggability. The partial unique index `(scene_round_id) WHERE sent_at IS NULL` is the idempotency lock.
- **Recipients are snapshotted at enqueue time** in the payload. If membership changes between delivery and send (delayed by quiet hours), the email reflects who was on the account at delivery, not at send time. `send-delivery-notification` falls back to live resolution only if the payload snapshot is empty.
- **CTA deep-links use query params, not `location.state`.** `location.state` doesn't survive external HTTP clicks. Portfolio reads `?project=…&scene=…&round=…` and clears them after consume.
- **Round 2+ skips the brief modal.** Previous round's `asset_drawings` + `asset_pins` are the brief. Production reads them in place on the previous round; no copy/move. Round 1 still uses the full brief modal (initial brief is still needed).
- **Three CP107 duplicate `project_code` rows** (Eiffel Tower, 10 Downing St, Parc des Princes — all `project_code = "CP107"`): legacy from before scan-by-name existed; deliberately not addressed per the previous-session instruction. Worth a cleanup pass before more production codes are issued.
- **BrandLoader replaces `Loader2 + animate-spin` everywhere except `LoginSplash`.** Dual opacity + scale pulse (1800ms ease-in-out, opacity 0.3↔1.0, scale 0.95↔1.05). RefreshCw remains for idle refresh icons; only the spinning state swaps to BrandLoader.
- **Documents accordion default-open priority**: unpaid invoice → missing agreement → first non-empty section → all collapsed. Picks the section the client is most likely to need to act on.

## Open questions or things to watch

- **Resend list-emails pagination cap** is 5 pages × 100 = 500 emails per account in `list-client-emails`. If volume grows past that, older emails roll off. Trivial to raise `MAX_PAGES`.
- **`pending_delivery_notifications` retry semantics**: `attempts` field is bumped on failures but never blocks retries. Effectively: cron will keep trying every 5 minutes until either the row is `sent_at`-stamped or manually cleaned up. No exponential backoff. Acceptable for current volume; revisit if Resend starts rate-limiting.
- **`SmartImage.loadedSrcs` is session-scoped** (module-level `Set`). Cross-session caching now relies on the `Cache-Control` header added to `dropbox-api` JSON responses — adequate but means a hard refresh re-warms the cache.
- **Edge function source for `_shared/deliveryNotification.ts`**: both callers pin different `supabase-js` versions (`@2.89.0` in webhook, `@2` floating in scan-visuals). The helper's supabase param is typed `any` deliberately; behaviourally compatible at runtime. If a future caller wants tighter typing, pin a single version in the shared file.
- **Documents accordion: smart-default heuristic only fires once per page load.** Subsequent data refetches (mutations from inside the page) don't re-trigger it. Acceptable; if the user signs an agreement inline and expects the accordion to flip to Invoices, that's a future enhancement.
- **Three-layer image perf**: not benchmarked. The thumbnail-vs-temp-link swap is conceptually large (640×480 jpg ≈ 30 KB vs full-res 4K render ≈ 10 MB) but actual savings depend on how many rounds are visible in a typical grid. Worth a quick devtools network sweep.
- **`folder_mappings` decision** (see above) — needs to land before the webhook is reconnected to anything. Until then, every delivery is admin-initiated via Rescan.

---

# Session — 17 May 2026 (evening)

Pre-launch session before the Katharine Pooley project starts tomorrow morning. Focus: Stripe payment loop end-to-end.

## Completed this session

### Stripe deposit + balance invoice loop closed

- **`1497770`** — Pre-generate Stripe URL on quotation signing; cache + on-demand Pay now.
  - `sign-quotation` (edge function, deployed): when the deposit invoice is created on signing, immediately calls Stripe to create a checkout session and stores `stripe_checkout_url` on the invoice row. Fails soft if `STRIPE_SECRET_KEY` missing.
  - `create-invoice-checkout` (edge function, modified, deployed): returns cached `stripe_checkout_url` if present; writes new URLs back via service-role client (clients can't UPDATE via RLS on quotation-linked invoices, so server-side caching is required).
  - `Documents.tsx`: Pay now button always shows for non-paid, non-draft invoices; opens cached URL if present, otherwise calls `create-invoice-checkout` on demand. `{ pending: true }` triggers "Payments not configured yet" toast.
- **`e6857c4`** — Add `create-balance-invoice` function + AdminProjects L5 button.
  - `create-balance-invoice` (NEW edge function, deployed): admin-gated; takes `scene_id`, resolves scene → project.account → most recent signed quotation; balance = `gross_total * (1 - deposit_percentage / 100)`; creates invoice with `type: 'balance'`, pre-generates Stripe URL, dispatches `send-invoice-email`.
  - `AdminProjects.tsx`: Level 5 round detail shows a gold "Create balance invoice" button when `selectedRound.status === "approved"`. Admin decides when to click (no auto-detection of "final" round).

## Pending verification before going live

- **Stripe key mode check.** Confirm whether `STRIPE_SECRET_KEY` in Supabase secrets is `sk_live_*` or `sk_test_*`. If live, either swap to test for dummy account flow, or do a £1 live test on a card you control and refund.
- **End-to-end deposit flow** with dummy account: sign quotation → deposit invoice appears → Pay now → Stripe checkout → webhook marks paid.
- **INV-202605-4769** has a cached `stripe_checkout_url` from the previous key. If keys are swapped, clear it: `update invoices set stripe_checkout_url = null where invoice_number = 'INV-202605-4769';`

## Decisions made this session

- **Balance invoice trigger is manual, not automatic.** The system cannot reliably know which round is the "final" one. Admin clicks the button when ready. Documented in `create-balance-invoice` function header.
- **Stripe URL caching lives server-side, not client-side.** RLS prevents clients from updating quotation-linked invoices. The first time a client clicks Pay now on an uncached invoice, `create-invoice-checkout` (running as service-role) generates and caches the URL.
- **Stale `Clients in database` table removed from CLAUDE.md.** Client list is operational data, not architecture. Source of truth is the `accounts` table. Query it when needed.

## Carried forward, not addressed tonight

- Client correction flow (item 7 in pre-session brief) — handled manually via email for the Katharine Pooley job; build properly this week.
- Client instructions submission flow (item 3) — same, manual via email this week.
- Uber/Deliveroo-style soft delete + denormalisation architectural brief — parked for post-launch strategic conversation.
- CLAUDE.md / HANDOFF.md split applied this session: migrations stay in CLAUDE.md, promotion policy added here, stale client table dropped.

---

# Session — 17 May 2026 (morning)

Picks up directly from the morning-of-16-May session. This session shipped five separate commits plus one in-session data cleanup (no commit). Head: `23b11f2` on `origin/main`.

## Completed this session

### 1. Role architecture cleanup (`a0496f3`)
- **Migration `20260516000003_role_team_and_super_admin.sql` applied.**
  - Added `'team'` to the `app_role` enum (applied as a standalone statement first — `ALTER TYPE ADD VALUE` can't run in the same transaction as code that references the new value).
  - Added `profiles.is_super_admin BOOLEAN NOT NULL DEFAULT false`.
  - Seeded `is_super_admin = true` for `fred@silvershadowstudio.com`.
  - Migrated `user_roles.role 'client' → 'team'` for users whose membership is exclusively on team accounts. Guarded by an `EXISTS / NOT EXISTS` pair so dual-account users (a real client who also holds a team account) would keep `'client'` as their primary — but the UNIQUE(user_id) constraint on `account_members` means no users were ever actually dual-account, so the guard is now belt-and-braces.
  - New `is_super_admin()` SQL helper (SECURITY DEFINER).
- **`src/hooks/useUserRole.ts`**: `AppRole` now includes `"team"`. Multi-role precedence: admin > client > team. New `isTeam` boolean alongside `isAdmin` / `isClient`.
- **`src/hooks/useIsSuperAdmin.ts`** (new): reads `profiles.is_super_admin` for Fred-only feature gates.
- **`supabase/functions/admin-create-client/index.ts`** (deployed): the invite-mode `user_roles` upsert now writes `'team'` when `accountType === 'team'`, `'client'` otherwise. Provision mode kept as `'client'` upsert with `onConflict: 'user_id,role'` (no-op for users who already have a row).
- **Post-migration DB state verified**: Fred is `admin`, canecht is `client`, nicolas + claire + home@colomb are `team`. Fred is the only `is_super_admin = true`. Live smoke test of nicolas@: `user_roles` returns `[{role:'team'}]` and `account_members → accounts` returns `account_type='team'`.

### 2. Per-user listings on AdminClients + AdminTeam (`da8ed14`)
- New **`supabase/functions/admin-list-account-users`** edge function (deployed). Service-role-backed listing of every user across every account. Auth-gated on `is_admin()`. Query params: `?accountTypes=partnership,project` (AdminClients) or `?accountTypes=team` (AdminTeam). Returns one row per `account_members` entry with `email` resolved from `auth.users`, `last_login_at` taken from `account_members.last_login_at` falling back to `MAX(client_activity.started_at)`.
- **`src/pages/admin/AdminClients.tsx`** (893 → 786 lines): replaced per-account row layout with grouped cards. Each account renders a header (company + type + client_code + dropdown) followed by per-user rows showing name, position, email, last-seen relative timestamp, and a Ghost button keyed to that specific user_id. The old inline "last 10 connections" expansion is gone; the activity drill-down still lives at `/admin/client-activity`.
- **`src/pages/admin/AdminTeam.tsx`** (369 → 290 lines): same grouped layout. Replaced the `.limit(1).maybeSingle()` hack that silently dropped every non-first team member. Now lists everyone via the same edge function.
- `handleMakeAdmin` in `AdminClients.tsx` is **retained but currently unwired** (the per-user dropdown menu it belonged to was removed). Re-attach when adding the per-user actions dropdown in a future pass.

### 3. Shared `Sidebar.tsx` primitive (`e534cfd`)
- New **`src/components/Sidebar.tsx`** (357 lines) owns all visual rendering: `<aside>` shell, logo, section-aware nav, active gold left-bar, hover account menu, mobile bottom-tab-bar, account row.
- The hover-account-menu animation block (staggered `transitionDelay: (length - 1 - idx) * 40ms` with separator fades) is **a verbatim copy** of the original — do not rewrite without re-confirming visual behaviour.
- **`src/components/AdminSidebar.tsx`** (344 → 124 lines): builds the `SECTIONS` array (Overview / Production / Operations / Finance + a headerless "Clients" row), attaches `useNewClientsCount()` badge to the Clients item.
- **`src/components/ClientSidebar.tsx`** (308 → 103 lines): picks `PARTNERSHIP_NAV` / `PROJECT_NAV` / `TEAM_NAV` from `accountType`, supplies company name as the gold sub-label, requests `showMobileTabBar`.
- **One small motion diff worth flagging**: ClientSidebar items previously used `transition-all duration-300 ease-out`. The shared primitive uses `transition-colors duration-quick` (180ms, colors only). Matches what AdminSidebar adopted in the prior sidebar refactor and is closer to the Part 1 motion-language directive ("sidebar items don't animate except the active gold underline").

### 4. Sidebar typography tightening (`dca01c3`)
- Section headers (OVERVIEW / PRODUCTION / OPERATIONS / FINANCE): `letter-spacing` `0.28em → 0.25em`, opacity `text-sidebar-foreground/45 → /35`. Font size stays 9px.
- Vertical rhythm: items within a group now have `gap-2` (8px); titled sections get `mt-7` (28px) instead of `mt-6` (24px) above each header. Item internal padding (`py-3`) deliberately untouched per "do less".

### 5. Structured invite-error codes + forgot-password route (`23b11f2`)
- **`admin-create-client`** (deployed) now returns structured 409s on already-registered users:
  - Same category → `{ code: "ALREADY_REGISTERED", error/message: "User already registered — direct them to use the forgot password flow" }`
  - Different category → `{ code: "WRONG_CATEGORY", error/message: "User already registered in another category. Each user can only belong to one category (client or team)." }`
  - Category = `team` vs (`client/project/partnership`) via the new `categoryOfAccountType()` helper. Both invite and provision modes covered.
- **`AdminClients.tsx` + `AdminTeam.tsx`**: switched from `supabase.functions.invoke` to direct `fetch()` so the response body is reachable on non-2xx (the supabase-js wrapper hides it). On the two known codes the page shows a friendly toast; ALREADY_REGISTERED toasts include a muted sub-line "They can recover access via the Forgot password link on the login screen."
- **Live verification**: nicolas@ as team → ALREADY_REGISTERED; canecht@ as team → WRONG_CATEGORY; canecht@ as project → ALREADY_REGISTERED. All return HTTP 409.
- **`/forgot-password` route added** in `App.tsx`. It mounts the existing `Auth` page; `Auth.tsx` checks `location.pathname.startsWith("/forgot-password")` on mount and pre-selects the recovery form. Reuses `supabase.auth.resetPasswordForEmail()` (no duplicate code).
- **Login screen UX**: "Forgot password?" link moved from below the submit button to **directly below the password input** (right-aligned, 11px, 50% opacity). "Back to login" link in recovery mode stays.

### 6. Mid-session DB cleanup (no commit)
- **Orphan team account deleted**: `5b76f33b-5ee3-4fc7-8011-5e95b9b63cbc`, `company_name = 'canecht@gmail.com'`, `account_type = 'team'`. Had 0 linked rows across all 10 child tables (account_members, projects, invoices, quotation_documents, orders, agreements, lane_tasks, subscriptions, freelancer_documents, account_invitations). canecht@ is now single-category-clean: one row in `account_members` for Katharine Pooley Limited (project, owner), `user_roles.role = 'client'`.

## In progress / needs verification

- **Visual sidebar identical-to-before check** has not run in a real browser this session. Build passes; JSX structure preserved; hover-menu animation copy-pasted character-for-character. Worth an eye-on-the-screen check next time you're in the portal — the one cosmetic diff to watch for is the slightly faster item hover transition on the client side (300ms → 180ms, colors only) noted above.
- **`AdminInvoices.tsx` tab-routing**: `/admin/quotes` and `/admin/invoices` both mount the same component; the page reads `useLocation().pathname` and picks `defaultValue` for the Tabs. There's a `key={defaultTab}` on the Tabs element so navigating between the two sidebar items forces a remount onto the correct tab. Working but slightly hacky — proper fix is a URL-controlled tab state, not a remount-on-key.
- **`useIsSuperAdmin()`** is implemented but **no caller uses it yet**. The function exists for future Fred-only feature gates. No UI surfaces super-admin-only behaviour today.
- **`handleMakeAdmin`** in `AdminClients.tsx` is defined but **currently unwired**. It used to live on a per-account dropdown that's no longer rendered. Re-attach when adding per-user actions.

## Pending

### Carried forward, untouched this session
- **Stripe payment link debugging** — secrets set, webhook registered, functions deployed; payment link creation from the invoice table still not confirmed working. Check `create-invoice-checkout` logs after triggering from the portal.
- **Quotation number auto-generation** — should be derived from `accounts.client_code` + sequence (e.g. `WIN-001`); currently entered manually.
- **Studio signature upload** — Fred needs to upload his actual signature PNG via `AdminSettings → Studio Signature`. The signing edge functions fall back to text-only sig blocks if the file is missing. **Bonus context**: the recent PDF size fix (commit `e1b3c78`) downscales the studio signature to 600×400 in memory at PDF generation time, so an over-large upload no longer balloons the output.
- **Clean up test invoices and team accounts** — historical test rows in `invoices`; two `Jean Dujardin` team accounts (id `9c3d7be1-…` and `cbde4d4f-…`).
- **Client correction flow** — not built. Client clicks Review → full-screen pin overlay → Submit → Round 02 created.
- **New commission brief flow** — not built. The IdleView's "send us a brief" link currently just `console.log`s.
- **Pre-launch ghost mode test** — ghost as Simon Tomlinson (Winch) and Marie Soliman (Bergman). **Note**: those accounts don't exist in the live DB yet; the names in CLAUDE.md are stale. Actual non-team client accounts today are Katharine Pooley Limited and Silver Shadow Studio (Fred's own).
- **Airtable inbound webhook** — `pull-status` is still manual only.
- **Brief field in Airtable** — Kieran needs to add it to the Tasks table.
- **Apply `20260516000002_studio_showcase_images.sql`** — wait, this one was applied earlier; the table + RLS + 3 seeded rows are in production. Confirmed not pending.

### New, surfaced this session
- **`account_members_user_id_key UNIQUE (user_id)` constraint** — already in production. It permanently restricts a user to **one** account. The current AdminClients / AdminTeam UI is designed to render N users per account (group + indent layout) but can never actually show more than 1 today. If the design intent is genuinely "multiple users per account", that constraint needs to be lifted. If the intent is "one user, one account" (current behaviour), the grouped-by-account UI is somewhat decorative — a flat user list would convey the same.
- **`canecht@gmail.com` and team accounts**: now that the orphan is gone and the structured WRONG_CATEGORY error returns 409, attempting to invite an existing client to a team account will be rejected cleanly. Worth a real-flow check from `AdminTeam` to confirm the toast renders correctly (the live curl smoke test passed).

## Decisions made this session

- **`'team'` is a real semantic role** distinct from `'client'`. It joins `admin / client / owner / user / team` in `app_role`. The `owner` and `user` enum values remain declared but unused.
- **Single-category membership** is the model: a user belongs to **either** the `client` category (covering `partnership` / `project`) **or** the `team` category. Never both. Enforced at the DB by the pre-existing UNIQUE constraint; enforced at the app by structured 409 errors from `admin-create-client`.
- **`is_super_admin` is a `profiles` column, not a role.** Both Fred and Kieran will be `user_roles.role = 'admin'` for RLS purposes (Kieran isn't promoted yet); the super-admin flag distinguishes Fred-only feature gates. RLS doesn't read this column.
- **Sidebar visual rendering is single-sourced in `src/components/Sidebar.tsx`.** Both `AdminSidebar` and `ClientSidebar` are now config-only wrappers. Future visual changes to *any* sidebar should be made in `Sidebar.tsx`, not the wrappers.
- **`/forgot-password` is a deep link into `Auth.tsx`**, not a separate page. Auth.tsx reads `location.pathname` on mount. This avoids duplicating the recovery form code.
- **`AdminClients` / `AdminTeam` use direct `fetch()` against edge functions** (not `supabase.functions.invoke`) so the response body is reachable on non-2xx. Same pattern was already in use for `admin-list-account-users`. Trade-off: explicit auth header threading; benefit: error-code-aware UI.
- **Provision mode in `admin-create-client` keeps the `'client'` role default** rather than mirror the account_type. The upsert is a no-op for users who already have the row, and avoids creating duplicate-role rows for the (now schema-blocked) dual-account case.
- **Item internal padding in the sidebar (`py-3`) was deliberately left untouched** in the typography pass. The 8px gap + 28px section break creates grouping at the boundary level; tightening item-level padding is a separate decision if items themselves should feel denser.

## Open questions / things to watch

- **The "multiple users per account" mental model vs the DB constraint.** Today: schema = 1 user per account, UI = grouped-by-account-with-N-users layout. The grouped layout works fine for 1-user-per-account but it implies you can grow each card. If the constraint stays, consider whether the visual grouping still earns its complexity. If it goes, several downstream questions open (which user is "owner", how invites work for an existing account, what `account_members.role` enum values mean).
- **`AdminInvoices` Tabs `key={defaultTab}` remount** — works but if any tab carries non-trivial state (e.g. a filter the user just set), navigating from `/admin/invoices` to `/admin/quotes` and back will discard it. Worth replacing with proper URL-controlled tab state at some point.
- **`is_super_admin()` SQL helper exists but is not yet referenced by any RLS policy.** If you want Kieran admin'd in but want some `app_settings` writes (e.g. brand colours, document_design_config) to be Fred-only, the policy update goes through the helper.
- **`useIsSuperAdmin()` is the React-side counterpart** — not yet used. First call site will probably be AdminSettings → Brand section once Kieran is admin'd in.
- **CLAUDE.md client list is stale** — it lists Lürssen / Winch / Bergman / Silvershadow as the clients, but the live DB has only Katharine Pooley Limited (project) + Silver Shadow Studio (Fred's, partnership) + the four team accounts. Worth a sweep next time someone touches CLAUDE.md.
- **Visual identical-to-before check on the sidebar refactor is the one unfinished verification.** Build passes, structural JSX preserved, but no eyes have hit the live portal post-refactor. Recommend a 60-second visual sweep on next page load: hover menu animation, active gold left-bar position, mobile bottom-tab-bar (client only), spacing between section headers.

## Commit chain summary

```
23b11f2  Structured ALREADY_REGISTERED / WRONG_CATEGORY error codes + forgot-password route
dca01c3  Quieten sidebar section headers, widen inter-group spacing
e534cfd  Consolidate AdminSidebar + ClientSidebar into shared Sidebar primitive
da8ed14  List every account member, ghost view per-user (AdminClients + AdminTeam)
a0496f3  Add 'team' to app_role + profiles.is_super_admin for Fred-only gates
```

All on `origin/main`. `git diff origin/main..HEAD` confirms no local drift.
