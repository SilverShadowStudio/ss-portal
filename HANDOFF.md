# Handoff Log

## How to use this file

This is the rolling session log. Each session appends a new block at the top. `CLAUDE.md` carries the stable rules, architecture, and migration history; `HANDOFF.md` carries the moving parts: what shipped, what's mid-flight, what's pending, and what was learned.

**Promotion policy.** At the end of each session, review findings in HANDOFF.md. When a finding has stabilised into a durable rule, architectural decision, or piece of stable context, promote it to `CLAUDE.md`. HANDOFF.md should not accumulate rules — it is for state in motion. CLAUDE.md should not accumulate session noise — it is for rules at rest.

---

# Session — 22 May 2026

Build-out session focused on two large threads plus a UI refinement pass. Thread one: the **Team Contracts** feature (admin-driven engagement contracts for freelancers/subcontractors) shipped end-to-end across Commits 1–5 (`fa724c0` → `ca15da5`), with a clause-strengthening pass (`eebafa1`) and a "Save for later" draft action (`fede602`). Thread two: the **lightbox round-review** experience moved to OS-level monitor fullscreen and then through a multi-step debugging chain (`8324a14` → `d712d47`) to fix zoom-to-fit centring, pan clamping, and a fullscreen-sizing bug rooted in the UA stylesheet. Thread three: a **four-tier text contrast** token system applied to the admin dashboard and shared sidebar (`32fc27d`), with a gold sub-label restoration follow-up (`a1ed729`). Head: `d712d47` on `origin/main`. Working tree clean.

## Completed this session

### 1. Team Contracts feature — Commits 1–5 (`fa724c0`, `a3c4cf5`, `b204c1b`, `66d7473`, `b7580dd`, `ca15da5`)
- **Commit 1 — centralised PDF design tokens + primitives.** Extracted shared document-design tokens and low-level PDF drawing primitives into `supabase/functions/_shared/documents/` so all server-side document generators share one visual language (cream `#EDE8E0` background, warm charcoal ink, warm grey muted, gold accent, A4 margins). Foundation for the team-contract generator and reusable by future document types.
- **Commit 2 — `team_contracts` table + RLS (migration `20260520000001`).** New table holding one row per engagement contract: status (`draft` / `pending` / `signed` / `declined`), contract type (individual / company), recipient identity, `profile_id` + `account_id` linkage (nullable until Send-to-portal), signed metadata, storage path. RLS: admins manage all rows; a recipient can `SELECT` their own contract via a join through `freelancer_profiles`. No `is_draft` column — draft vs sent is expressed through `status` (`draft` → `pending`).
- **Commit 3 — admin form + "Register Them" flow.** Engagement-contract creation integrated into the existing `AdminTeamContracts.tsx` (per decision D3 — no separate page). "Register them" provisions a subcontractor record directly, bypassing the existing client onboarding flow (NDA + FSA stacking not required — see Decisions).
- **Commit 4 — PDF generator + admin download path + `recipient_email` (migration `20260520000002`).** `supabase/functions/_shared/documents/teamContractPdf.ts` generates the contract PDF server-side with **two variants** (Individual and Company), driven by contract type. **Tinos fonts** (regular/bold/italic) bundled at `supabase/functions/_shared/fonts/` for clean Latin Extended-A diacritic coverage (e.g. `Srđan`, `Bogdanović`) — replaces the macOS-Georgia approach and its licensing concern. Migration `20260520000002` adds `recipient_email TEXT` to `team_contracts`, persisted on the draft. Admin download path renders + returns the PDF via `preview-team-contract-pdf`.
- **Commit 5 — Send to portal for signature (`ca15da5`).** The big one. `team-contract-send` performs **reuse-aware atomic provisioning**: if `recipient_email` already has an `auth.users` row, reuse it; if the recipient already has a different `account_type`, create a new team-type account; if an existing `freelancer_profile` is individual and the new contract is company, link via `profile_id` to the existing personal profile. `profile_id` + `account_id` linkage is established atomically at Send time (compensating-transaction pattern — supabase-js has no multi-statement transactions). `team-contract-accept` records signature, generates the signed PDF, and stores it. Acceptance is gated. Edge functions: `team-contract-create`, `team-contract-send`, `team-contract-accept`, `preview-team-contract-pdf` (all deployed).

### 2. Strengthened Team Contract clauses (`eebafa1`)
- `supabase/functions/_shared/documents/teamContractPdf.ts`: extended **Clause 6 (IP)** to explicitly assign working files; inserted new **Clause 10 (Non-Disparagement)**; fixed cross-references (Late Delivery → Clause 13; Termination → "Clauses 6 to 11 survive"). Contract is now 13 clauses.

### 3. Save for later action on Team Contract form (`fede602`)
- Three-action draft pattern on the form: Save for later / (send) / (download). "Save for later" persists a `draft`-status row; `AdminTeamContracts.tsx` can re-open drafts for editing.

### 4. Lightbox monitor-fullscreen + UX fixes (`8324a14`, `a4b72e0`, `c44cd3e`, `5218dc2`, `d712d47`)
- **`8324a14`** — `src/components/client/AssetViewer.tsx` `Lightbox`: replaced app-level fullscreen with OS-level monitor fullscreen. On open, `containerRef.current.requestFullscreen()` (mobile skipped via `matchMedia("(max-width: 768px)")`); a `fullscreenchange` listener closes the lightbox on exit; `exitFullscreen()` on unmount.
- **`a4b72e0`** — zoom-to-fit centring + click-drag pan: clamp `tx`/`ty` to viewport edges in `onPointerMove`; widened image cap from `96vh/96vw` to `100vh/100vw` in fullscreen.
- **`c44cd3e`** — re-clamp pan offset on wheel-zoom to prevent edge gaps (closed the wheel-zoom edge case left open by `a4b72e0`).
- **`5218dc2`** — fullscreen surface not filling the screen: added `.lightbox-fullscreen-target:fullscreen { width:100vw; height:100vh; inset:0 }` in `src/index.css` and the class on the lightbox root container. Diagnostic established the React state was correct (`tx=ty=0`, `scale=1`, flex-center parent present, `object-position` center) — root cause was fullscreening a `position:fixed; inset:0` element with no `:fullscreen` sizing rule.
- **`d712d47`** — the `:fullscreen` rule had no visible effect because the UA stylesheet applies `:fullscreen { width:100% !important; height:100% !important }`, and a normal author declaration loses to a UA `!important`. Added `!important` to all three properties (`width:100vw !important; height:100vh !important; inset:0 !important`) so the author rule outranks the UA rule; `vw`/`vh` sidestep the buggy `position:fixed` containing-block resolution.

### 5. Four-tier text contrast tokens + sidebar (`32fc27d`, `a1ed729`)
- **`32fc27d`** — introduced a four-tier contrast token system (`strong` / `standard` / `label` / `recessive` + `divider`) in `src/index.css` (`:root` + `.dark`) and `tailwind.config.ts`. Applied to the admin dashboard and the **shared `src/components/Sidebar.tsx`** (option a — both admin and client sidebars get the contrast improvement together). The existing app-wide `.text-label` composite utility was recoloured to `var(--text-label)` rather than removed. Used class name `text-strong` (not the spec's `text-primary`) to avoid collision with the existing gold-accent `.text-primary`.
- **`a1ed729`** — restored the gold accent on the sidebar sub-label in `Sidebar.tsx` (both modes) after the contrast pass had neutralised it.

## In progress / needs verification

- **Team Contract Send + Accept — browser end-to-end test not yet run.** The mechanical chain is built and deployed, but the full provision → invite → accept → signed-PDF flow has not been exercised in the browser. Deferred from earlier today.
- **Commit 6 (activity events) was folded into Commit 5.** Verify that `team_contract_sent` / `team_contract_signed` / `team_contract_declined` events render correctly in `/admin/activity` (badge + actor role).
- **Lightbox fullscreen fix — live verification.** `d712d47` deployed; reopen a delivered round's image and confirm the surface fills the monitor and the image lands dead-centre at 1.0× with pan/zoom unchanged.
- **Sidebar contrast (client side) — visual QA.** The four-tier pass applies to both admin and client sidebars via the shared component; client-side appearance not yet eyeballed.
- **Operational instrumentation gaps** — some pieces shipped earlier; verify in browser.

## Pending

- **Multi-user live collaboration (Phase 1 + Phase 2).** Proper spec session still required before any code (carried in the Maybourne backlog alongside multi-user commenting).
- **Sabrina update email** — drafted (Maybourne 3 of 4 features live), not yet sent.
- **All carried-forward items from earlier sessions** — Stripe key-mode check, studio-account architectural cleanup, agreements-bucket admin `DELETE` policy, Maybourne backlog 2/4 (multi-user commenting) and 4/4 (Isabelle button), `/onboarding` self-registration path, Katharine Pooley deliverability re-test, Manual Invite live test, quotation number auto-generation, test-invoice cleanup. See prior session blocks for detail.

## Decisions made

- **Reuse design for Team Contracts.** Draft vs sent is expressed via `status` (`draft` / `pending`) — no `is_draft` column. `profile_id` + `account_id` linkage is established atomically at Send-to-portal time, not at draft creation.
- **Engagement contract is legally self-sufficient.** It does not require NDA + FSA stacking; the subcontractor path bypasses the existing client onboarding flow via "Register them".
- **Server-side PDF generation** (in `supabase/functions/_shared/documents/`), not client-side jsPDF (decision D1).
- **Tinos font (Apache 2.0 / OFL) bundled** at `supabase/functions/_shared/fonts/` for Latin Extended-A diacritic support, replacing the Microsoft Georgia approach and its licensing concern. (Licensing note: Tinos is distributed under OFL in `google/fonts`, not Apache — flagged and accepted.)
- **Storage reuse.** The `freelancer-documents` bucket holds team-contract signed PDFs at `{user_id}/team-contracts/{contract_id}.pdf`, covered by the existing `fd_storage_own` RLS policy (decision D4 — no new bucket).
- **Lightbox auto-enters OS-level monitor fullscreen on open**, with `!important` CSS to outrank the UA stylesheet's `:fullscreen { width:100% !important }` rule.
- **Text token naming.** `text-strong` used in code instead of the spec's `text-primary` to avoid collision with the existing gold-accent `.text-primary`. The four-tier system is global via the Tailwind theme.

## Open questions or things to watch

- **Recipient email deliverability.** The portal-domain verify-link + portal-hosted-image fix is verified for general clients, but the **Katharine Pooley corporate filter** behaviour beyond the initial fix is not yet validated (depends on Resend webhook bounce ingestion — still backlog).
- **The recoloured `.text-label` composite is global.** Sub-perceptible shift, but it changes every `.text-label` usage app-wide, not just the dashboard/sidebar.
- **Sidebar contrast applies to both admin AND client sidebars** (option a, shared `Sidebar.tsx`). If admin/client need to differ later, that requires a variant prop on the shared component.

---

# Session — 19 May 2026 (post-Maybourne demo)

Long follow-up session immediately after the Maybourne Hotels demo. Ten commits (`db723c0` → `e9d4e72`), plus one local-only artefact (subcontractor letter PDF on Desktop). Six threads: (1) shipping the first piece of the Maybourne feature backlog (Reschedule + Round buffer), (2) Airtable sync architectural cleanup (stable record-id link + separate address fields), (3) phantom-login diagnostic → multi-part fix, (4) Airtable pre-flight match check on Add Client, (5) email deliverability fix after Katharine Pooley bounce (portal-domain verify links + portal-hosted images), (6) Manual Invite admin feature for clients blocked by corporate mail filters. Head: `e9d4e72` on `origin/main`. Working tree clean. `SUPABASE_ACCESS_TOKEN` rotated again mid-session; new token stored in the password manager, not committed.

## Completed this session

### 1. Reschedule feature — Maybourne 1 of 4 (`db723c0`)
- **Migration `20260519000003`-pre / actually no migration.** Reuses existing `scene_rounds.start_date` and `scene_rounds.end_date` — no schema change.
- **New component**: `src/components/client/RescheduleRoundModal.tsx`. Renders a 3-column grid of the next 12 Mondays starting from `(today + 7d, rounded forward to the next Monday)`. Current delivery shown above. Gold confirm button reads `Reschedule to [date]`, disabled until a different Monday is selected. Mobile-safe (collapses to 2 cols, `max-h-[90vh]` scroll, 520 px width cap).
- **`src/components/client/TaskDetail.tsx`**: optional `onReschedule` prop wired in. When provided, a "Reschedule" link renders inline next to "View Instructions" using the same 11 px tracked warm-grey style. Hidden when not provided.
- **`src/pages/Portfolio.tsx`**: `handleRescheduleRound` updates `scene_rounds.end_date` to a new Monday at 11:00 and `start_date` to `(end - 7 days)`, syncs local `sceneRounds` map + `selectedRound`, logs `round_rescheduled` with project/scene/round context. `onReschedule` is wired only when the round is `pending` / `in_production` / `in_progress` AND `daysUntilStart > 7` — otherwise the link is hidden entirely (chose hidden over disabled tooltip per "what reads cleanest").
- **`src/lib/activityLog.ts`**: added `round_rescheduled` to `ActivityAction` union and `ACTION_LABELS` as badge `"Reschedule"`.

### 2. Airtable architectural fixes — stable record-id link (`c469277`) + separate address fields (`46f16b2`)
- **Migration `20260519000003_accounts_airtable_client_id.sql`** applied: `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS airtable_client_id TEXT;` + `CREATE INDEX idx_accounts_airtable_client_id ...`. Verified column present.
- **Behaviour change**: pre-fix, every sync re-resolved Airtable Clients by `company_name` equality, which forks the link when names diverge (rename in Airtable, typo in either system) — duplicate Clients rows silently created. Post-fix, the stored `airtable_client_id` is the canonical hard link; name lookup is the fallback for first-ever sync, then writeback persists the id.
- **`supabase/functions/airtable-sync-contact/index.ts`** and **`supabase/functions/airtable-sync-project/index.ts`** both gained `resolveAndStoreCompanyRecordId` (stored-id-first lookup, 404-check on stored id, name fallback + writeback). Plus `airtableRecordExists` and `searchOrCreateCompanyByName` helpers. `airtable-sync-project` reads `accounts.airtable_client_id` alongside `company_name`/`account_type`.
- **Backfill**: only Maybourne had an owner; `accounts.airtable_client_id = recUIVIGQue3NSwa2`. Silver Shadow Studio account intentionally skipped (still on the studio-account architectural-cleanup Pending list).
- **Six-field address mapping (`46f16b2`)**: after Kieran added six new Clients columns (`Building number`, `Street name`, `City`, `Postcode`, `Country`, `Registration number`) and deleted the freeform `Address` field, `app_settings.airtable_contact_field_config` got six new keys merged via `jsonb` concat (`field_client_building_number`, `field_client_street_name`, `field_client_city`, `field_client_postcode`, `field_client_country`, `field_client_registration_number`). `composeAddress` helper was deleted; `patchClientProfileFields` now uses a `setIf(airtableField, portalValue)` helper that fires one PATCH field per portal column / Airtable column pair. Empty portal values never overwrite Airtable — sync is additive only.
- **First-deploy gotcha caught**: `npx supabase functions deploy` ran as a background task without explicit CWD didn't pick up the updated source — it deployed a stale version. Caught it via `npx supabase functions download` (deployed source missing the new helper names), redeployed from project root, verified again. Same gotcha recurred each subsequent function deploy session; documented here for future automation.

### 3. `password_set` activity events (`fd26b08`)
- New `ActivityAction` `password_set` + `ACTION_LABELS` badge `"Password"`.
- **`src/pages/SetPassword.tsx:55-56`**: fires after `supabase.auth.updateUser({ password })` succeeds, description `"Set initial password"`, before navigating to `/sign-agreement`.
- **`src/pages/Account.tsx:439`**: fires after the user-initiated password change in the client Settings → Password section succeeds, description `"Changed password"`.
- Actor role resolved by existing `getActor()` (`user_roles` row → `"admin"`, otherwise `"client"`). No `actorRole` override needed.
- Verified no CHECK constraint on `activity_log.action` (queried `pg_constraint` — empty), so the new value inserts cleanly.

### 4. Round buffer field — Maybourne 3 of 4 (`4ed6a35`)
- **Migration `20260519000004_round_buffer.sql`** applied: `ALTER TABLE scene_rounds ADD COLUMN IF NOT EXISTS buffer_weeks INTEGER DEFAULT 1;`. Default 1 reproduces pre-buffer cadence (1 week of idle between delivery and next round start). Verified `column_default = '1'`.
- **`src/lib/roundSchedule.ts`**: `computeRoundSchedule(from, options?)` now accepts `{ previousRoundEnd, bufferWeeks }`. When `previousRoundEnd` is provided, the next round's start anchors to `rollToNextMonday10am(previousEnd + bufferWeeks * 7d)`, clamped against the default "next slot from now" so a delayed request never lands in the past. New private helper `rollToNextMonday10am`. Default no-args behaviour is unchanged.
- **`src/components/client/NewRoundModal.tsx`**: new `bufferWeeks` state (default 1), prefilled from `existingDraft.buffer_weeks` when reopening a draft. Stepper (`−` / numeric input / `+`) + single-option `weeks` dropdown sits between the file-fields section and the Delivery summary, with the italic 11 px muted helper text the spec asked for. `onCreate` / `onCreateWithDate` / `onSaveDraft` props all gained `bufferWeeks` as a new parameter.
- **`src/pages/Portfolio.tsx`**: `SceneRound` and `editingDraft` types gained `buffer_weeks`; `fetchProjects` SELECT and reschedule SELECT both include it; `openRoundModalForScene` loads it for the draft preview; `handleSaveDraft` accepts + persists it; `handleCreateRound` accepts optional `bufferWeeks` (default 1) and persists on both submit-from-draft and fresh-insert paths; `handleRequestNextRoundDirect` reads the previous round's `buffer_weeks`, passes `previousRoundEnd` + `bufferWeeks` to `computeRoundSchedule`, and writes the same `buffer_weeks` on the new round (inheritance).
- No edge function changes — admin timeline + `AdminProjects` pick up the new dates automatically since they read `start_date` / `end_date`.

### 5. Phantom login fix + admin-delete cascade + session_end pairing (`f377071`)
- **Diagnostic findings** (logged separately, no code changes during triage): Margaux Delacroix's auth row (`8ab1e7a0-755c-4e66-a213-5b689c85bcc0`) was still alive (`deleted_at=NULL`, `banned_until=NULL`) despite an admin delete. Six `client_login` rows for her appeared between 09:08 and 15:10 UTC on 19 May while `auth.users.last_sign_in_at` stayed frozen at `09:05:45 UTC`. Two rows fired 15 ms apart — physically impossible as real logins. Cross-check on `client_activity`: 3 `session_start` vs 8 `session_end`, with `page_view` spanning the entire 6-hour window — one continuous tab session, not multiple sign-ins.
- **Fix 1 — `src/contexts/AuthContext.tsx`**: `SIGNED_IN` handler now reads `auth.users.last_sign_in_at` via `supabase.auth.getUser()` and the most recent `client_login`/`client_registered` row's `created_at` from `activity_log`. Insert is skipped unless `last_sign_in_at > lastLog.created_at + 10s` (10 s skew tolerance per spec). Synthetic SIGNED_IN events (token refresh, cross-tab storage sync, tab focus regain on some `@supabase/supabase-js` versions) silently no-op.
- **Fix 2 — `supabase/functions/admin-delete-account/index.ts`** (new edge function, deployed, admin-gated): enumerates members, captures email + other-membership count before deleting, then deletes the account row, then deletes `auth.users` for any member whose only membership was this account. Preserved sentinel: `fred@silvershadowstudio.com`. Returns `auth_users_deleted` / `auth_users_preserved` (with reason) / `auth_users_failed`. **`src/components/admin/AccountList.tsx:handleDeleteAccount`** rewired from inline `.from('accounts').delete()` to `supabase.functions.invoke('admin-delete-account', ...)`.
- **Fix 3 — `src/hooks/useClientActivityTracker.ts`**: new `sessionEndedRef` (initialised `false`). `session_end` now fires at most once per session lifetime — both the auth-change path and the `pagehide` / `visibilitychange` beacon path are guarded. Reset on new `session_start`.
- **Cleanup applied after push**: 7 orphan `auth.users` rows deleted via `scripts/delete-auth-users.sh` (gitignored) — Margaux included, `fred@silvershadowstudio.com` confirmed intact. One sweep deleted 135 orphan `activity_log` rows across 9 distinct `actor_user_id`s (the 18 pre-existing orphans + the rows that became orphan after the auth deletes + a handful of older historical strays). Remaining orphans: 0.

### 6. Airtable pre-flight match check on Add Client (`75bb7d0`)
- **`supabase/functions/airtable-find-matching-clients/index.ts`** (new, deployed, JWT + admin-gated): takes `{ company_name }`, returns up to 5 matches. Strips `Limited` / `Ltd` / `Inc` / `LLC` / `Studios?` suffixes from both sides, runs bidirectional `query ⊆ candidate OR candidate ⊆ query`. Coarse Airtable filter via stripped query's first word; precise rule enforced in JS so suffix divergence (e.g. `Maybourne Ltd` ↔ `Maybourne Limited`) isn't lost. Batched Users-table fetch resolves `Client Representative` linked-record IDs to full names. Batched Projects-table fetch with a single OR formula counts projects per matched client.
- **`supabase/functions/admin-create-client/index.ts`**: now accepts optional `airtableClientId` in the body; when present, written onto the new `accounts` row at insert time, *before* the downstream `airtable-sync-contact` fan-out — so the stored-id-first resolution kicks in and PATCHes the chosen row instead of creating a duplicate.
- **`src/components/admin/AccountList.tsx`**: new state `airtableMatches` + `matchesLoading` + `linkedAirtableId`. Debounced (300 ms) `useEffect` on `form.companyName` invokes the match function when length ≥ 3, dialog open, not team-only. Match panel renders above submit only when loading or matches exist. Each row: `Name — address — representative — N projects` with `Link to this` / `Linked ✓` toggle. `Create new anyway` button (active only when a link is selected). Toast branch on submit: linked → `"Created and linked to existing Airtable record"`; unlinked → `"Created (new Airtable record)"`. `resetForm` clears the three new states.

### 7. Email deliverability fix — portal-domain verify links + portal-hosted images (`2a318c3`)
- **Trigger**: Resend domain audit flagged the invite emails — verify link host was `oodhsoiwnqxcimzmzick.supabase.co` (no DMARC alignment with the `silvershadowstudio.com` sender), and image hosts were on `silvershadowstudio.s3.eu-central-1.amazonaws.com` (shared-tenant `amazonaws.com` host scored down-rank by some filters).
- **`vercel.json`**: added rewrite `{"source":"/auth/verify","destination":"https://oodhsoiwnqxcimzmzick.supabase.co/auth/v1/verify"}` **before** the SPA catch-all (`/(.*) → /index.html`). Vercel rewrites are evaluated in order and the SPA catch-all would otherwise swallow `/auth/verify`. Vercel forwards the request server-side; the visible link in the email is on the portal domain, the browser never sees `supabase.co`. Probed live with a dummy token → final URL was `portal.silvershadowstudio.com/set-password#error=otp_expired` (Supabase rejected the dummy, redirected back to `redirect_to`, browser stayed on portal domain throughout).
- **`supabase/functions/admin-create-client/index.ts`**: new helper `buildPortalVerifyUrl(properties, fallback)` composes `${APP_BASE_URL}/auth/verify?token=${hashed_token}&type=${verification_type}&redirect_to=${encoded redirect}` from `generateLink()` response. Falls back to `action_link` when token components missing. Applied to all three modes (`resend`, `magiclink`, `invite`).
- **PNGs committed at `public/email-assets/`**: `silvershadow-wordmark.png` (was 23 KB on S3, oxipng lossless → 8 KB), `portal-invite-illustration.png` (was 147 KB, lossless → 139 KB, lossy not used — file is CDN-fetched, doesn't pressure Gmail's 102 KB body clip). Optimised with `npx oxipng-bin -o 4 --strip safe`.
- **`supabase/functions/_shared/emailTemplates.ts`**: `LOGO_URL` and `EMAIL_INVITE_DEFAULTS.illustrationUrl` swapped to `https://portal.silvershadowstudio.com/email-assets/*`. Four other edge functions had their own hardcoded `LOGO_URL` copies (`accept-agreement`, `send-quotation-email`, `send-delivery-notification`, `send-invoice-email`) — all swapped too.
- **Deployed**: `admin-create-client`, `send-quotation-email`, `send-invoice-email`, `accept-agreement`, `send-delivery-notification`, `preview-email`, `admin-impersonate-client` (the latter two via chained deploy). Verified via `functions download` that `buildPortalVerifyUrl` appears 4× in deployed `admin-create-client` (1 def + 3 callsites).

### 8. Manual Invite admin feature (`e9d4e72`)
- **Trigger**: even after the deliverability fix, the Katharine Pooley corporate filter continued to soft-bounce `portal@silvershadowstudio.com` mail. Need a path for blocked recipients without resorting to disabling clients.
- **`supabase/functions/admin-generate-manual-invite/index.ts`** (new, deployed, admin-gated): `{ account_id }` → resolves owner from `accounts.owner_user_id`, looks up email via `admin.auth.admin.getUserById`, calls `admin.auth.admin.generateLink({ type: 'magiclink', redirectTo })`, threads token through the same `buildPortalVerifyUrl` helper as `admin-create-client`, renders `buildInviteEmailHtml` with `app_settings.email_invite_config` + `loadBrand()` so the rendered HTML is **byte-identical** with what the system sends. No email send — neither Supabase native nor Resend. Returns `verify_url`, `recipient_email`, `recipient_first_name`, `subject`, `email_html`, `email_text`.
- **`src/components/admin/ManualInviteModal.tsx`** (new): 600 px-max responsive `Dialog` with two sections. Section 1 — sandboxed `iframe srcDoc` of the actual email HTML with the cream `#EDE8E0` body background; `Copy email` button uses `navigator.clipboard.write([ClipboardItem])` with `text/html` + `text/plain` blobs (pre-built via `useMemo` so the click handler has zero awaits before `.write()` — Safari accepts as a user-gesture call). Fallback to `clipboard.writeText(text)` if `ClipboardItem` undefined. Helper text: `Subject:` + `Send to:` + 10 px italic "expires in 24 hours" disclaimer (intentionally conservative — real Supabase TTL is 7 days, but the disclaimer nudges admins to forward promptly). Section 2 — IT whitelist message in a pre-styled block, `Copy message` button via plain-text `writeText`. `Activity_log` logs `manual_invite_generated` ("Manual" badge) once per accountId on modal open, ref-guarded against re-fires.
- **`src/pages/admin/AdminClientProfile.tsx`**: new "SEND MANUALLY →" button in the same `mt-5` row as "RESEND INVITATION →", styled `text-foreground/60` to match the warm-grey 11 px tracked aesthetic. `flex-wrap gap-x-7 gap-y-2` row so they reflow on narrow widths. Modal mounted at bottom of tree with `clientLabel` derived from `[firstName, lastName].filter(Boolean).join(' ')` (falls back to company name, then `"client"`).
- **`src/lib/activityLog.ts`**: added `manual_invite_generated` to `ActivityAction` + `ACTION_LABELS` badge `"Manual"`.

### 9. HANDOFF entry: `resend-find-email` diagnostic + Resend webhook backlog (`e9706fe`)
- Committed the diagnostic edge function `supabase/functions/resend-find-email/index.ts` built during the Katharine Pooley bounce triage. Admin-gated (with service-role bearer accepted for shell-side use). Two modes: list-by-recipient-with-time-window, and Resend-endpoint probe. Deployed with `--no-verify-jwt` because the platform JWT layer rejects the new `sb_secret_*` service-role format.
- Added HANDOFF entries: "Email deliverability — Katharine Pooley invite bounce (20 May 2026)" + "Pending — Resend webhook ingestion + deliverability admin UI". Both entries sit inside the prior 19 May session block.

### 10. Subcontractor letter PDF generated to Desktop (local-only, no commit)
- `scripts/generate-subcontractor-letter.ts` (gitignored — `scripts/` is in `.gitignore`). Reuses `agreementPdfV3.ts` visual conventions: cream `#EDE8E0` background, warm charcoal `#1A1814` ink, warm grey `#8A8070` muted, gold `#B89A6A` accent, A4 portrait 28 mm side margins. Cover, body (clauses 1–13), signature page; footer with `Engagement letter · Silvershadow Studio Limited · Page N of M`. **Unicode handling**: jsPDF's built-in fonts are WinAnsi-only and would mangle `Srđan` / `Bogdanović` / `Braće`; the script reads `/System/Library/Fonts/Supplemental/Georgia*.ttf` (regular + bold + italic) at runtime, base64-encodes and registers them via `addFileToVFS` + `addFont`. Latin Extended-A coverage clean. Output: `~/Desktop/silvershadow-subcontractor-letter-alicetech-2026-05-20.pdf` (103 KB, 7 pages, valid PDF 1.3), auto-opened with `open`.

## In progress / needs verification

- **Katharine Pooley deliverability re-test.** A second invite to `emilyg@katharinepooley.com` was queued via Resend at `2026-05-20 14:36:25 UTC` (id `c0601bba-670b-4b57-90b1-52af69978212`) — `last_event` was `queued` when last checked. Status not re-verified after the email-deliverability fix shipped (commit `2a318c3` came later). Worth a fresh `resend-find-email` lookup to confirm whether the corporate filter still bounces post-fix.
- **Manual Invite live test.** The feature shipped but Fred hasn't yet generated a manual invite end-to-end through the admin UI. Mechanical chain verified via `functions download` (deployed source has `buildPortalVerifyUrl` 4× and pulls from `_shared/emailTemplates.ts` with portal-hosted URLs) and live URL probes (200 on both images, `/auth/verify` proxy passes through). In-browser visual check pending.
- **Maybourne backlog 2 of 4 and 4 of 4 — untouched.** Multi-user commenting with coloured pens (deferred — schema-heavy) and the Isabelle button (future-dated project booking with live countdown) are both still unstarted.
- **`/onboarding` self-registration path remains broken** since `86f161a` last session. Not touched.

## Pending

### Maybourne demo backlog (1 of 4 shipped; 3 remaining)
- **Isabelle button — Maybourne 4 of 4.** Future-dated project booking. Client reserves a production slot for a future Monday delivery, keeps editing brief/files/comments until the cutoff (Friday midday before production week), countdown timer visible throughout. Schema impact: probably `scenes.booking_status` or a new `scene_bookings` row, and a way to gate the brief-editable window. When live, notify Sabrina at Maybourne.
- **Multi-user commenting with coloured pens — Maybourne 2 of 4.** Per-user pin/sticky/pen colour + signature, multi-designer-per-account, designer-level role hiding Documents/Agreements/Quotations/Invoices, quotation+invoice recipients routed to admin + signatory not the requesting designer. Largest of the four — schema (per-user pin colour, `account_members.role` enum), RLS, UI permissions on Documents page, role-based filtering. Opt-in per-account so Kieran's "one point of contact" policy is preserved for everyone else.
- **Multi-user live collaboration on scenes (expanded scope — Maybourne backlog).** Expansion of the item above. Originally specced as multi-user commenting with coloured pens (feature 4/4). Fred has expanded the ask to include Miro-style real-time collaboration: multiple users from a client team viewing the same scene at the same time, seeing each other's cursors live, and watching each other's comments appear as they're typed.
  - **Phase 1 — Multi-user foundation (original ask):**
    - Multiple users per account (lift the `account_members_user_id_key` UNIQUE (`user_id`) constraint — currently 1 user per account).
    - Per-user pin/pen/sticky colour stored on `account_members`.
    - Per-user comment attribution on `asset_pins`.
    - All invited users can comment, draw, upload, request rounds.
    - Account-level toggle so multi-user mode is opt-in (Maybourne-only initially).
    - Role-based filtering: designers (non-signatory members) hidden from Documents / Agreements / Quotations / Invoices.
    - Quotations + invoices route to admin + designated signatory only.
  - **Phase 2 — Live collaboration (new ask):**
    - Real-time cursor sync via Supabase Realtime channels (one per scene).
    - Presence indicator: small avatar/badge of each user currently viewing the scene.
    - Live comment streaming (see other users' comments appear as they type).
    - Stable performance at 4K zoom and on mobile.
  - **Estimated effort:** Phase 1 alone is ~1-2 weeks of proper spec + build. Phase 2 adds another 3-5 focused days. Total: 2-3 weeks. Not a fit for incremental shipping.
  - **Required before starting:**
    - Dedicated spec session (Fred + Claude) — sketches, decisions, trade-offs documented.
    - Schema design: how `account_members` evolves, what's stored on `asset_pins`, RLS plan.
    - Realtime channel architecture: subscription lifecycle, presence, cursor broadcast rate.
    - UX decisions: cursor styling, conflict resolution on simultaneous edits, mobile cursor strategy.
    - Toggle architecture: how account-level multi-user mode is enabled, what defaults look like for non-Maybourne accounts.
  - **Build order:** Phase 1 first (multi-user foundation without realtime), shipped to Maybourne, used for at least one real round of work. Then Phase 2 (realtime layer) on top.
  - **Trigger to start:** When Fred has a clear week-long block of focused time AND Maybourne (or another opt-in client) is actively requesting it. Not before — this is the kind of feature that breaks if built in interruptions.

### Resend webhook ingestion + deliverability admin UI
Both items together — the UI is useless without the data.
- **`supabase/functions/resend-webhook/index.ts`** (not built): signature-verified webhook endpoint. Receives `email.sent` / `email.delivered` / `email.bounced` / `email.complained` / `email.opened` / `email.clicked` events. Writes rows to `email_send_log` including the full `bounce` sub-object (`bounce.type` Permanent/Transient, `bounce.message` with the bouncing SMTP server's response, recipient diagnostics, SMTP response code). Register endpoint in Resend dashboard. After this lands, future bounce triage is a SQL query instead of a Resend-dashboard manual lookup.
- **Admin UI: bounce status + retry/override on `/admin/clients/<id>`** (not built). Surfaces per-recipient deliverability: latest `last_event` per email, bounce reason inline, "Resend invitation" (exists), "Override to known-good email" (calls `auth.admin.updateUserById`, then re-invites). Hooks into the new `email_send_log` rows.

### Operational instrumentation backlog (post-Maybourne)
Of the five components from the 19 May backlog, only one shipped this session. The other four:
- Time-to-sign metric on admin Agreements page — Invite-to-signed delta + new `password_set`-to-signed delta — admin-only, muted-text per row.
- Last connection summary on admin Clients list — "Last seen 3h ago · 18m session" pulled from `client_activity`.
- Expandable connection history (last 10 sessions) on the Clients list — accordion style.
- `client_activity` table audit before building the two above — verify `ended_at` / `duration_ms` populate reliably, confirm `kind = 'session'` is the right anchor.

### Other carry-overs
- **Studio account architectural cleanup.** Silver Shadow Studio account row (`a09b2cdd-2c98-4415-a58d-ec6420d69bd6`) still misclassified as a client; `AccountList.tsx` client-side filter still hides it. Proper fix not done this session.
- **Account-aware storage RLS for `agreements` bucket (Option A).** v3 PDFs still at `agreements/{user_id}/{agreement_uid}.pdf`. Pair with admin DELETE policy on the same bucket.
- **Existing test/dummy quotations and invoices in DB** — not cleaned.
- **Quotation number auto-generation** — still manual (Quotation v2.0 would subsume).
- **PDF generation for quotations and invoices via `_shared/pdfUtils.ts`** — still client-side only.
- **Brief field in Airtable** — Kieran still needs to add it to Tasks table.
- **SVG logo in invoice generator** — `public/generator/images/SS - Logo 2019.svg` still not in git.

## Decisions made

- **Reschedule lock signal: hidden, not disabled-with-tooltip.** Inside the 7-day production cutoff the Reschedule link disappears entirely. Cleaner with the in-production view's rhythm than a greyed/tooltipped button.
- **Reschedule date picker UI: Monday-chip grid, not native `<input type="date">`.** The future-Mondays-only constraint can't be enforced visually by the native picker. A 3-col chip grid of the next 12 Mondays is unambiguous and mobile-friendly.
- **Round buffer applies via `max(default-start, RollToNextMonday10am(previousEnd + buffer*7d))`.** This reproduces today's effective gap when buffer=1, clamps against the past for delayed requests, and pushes start later when the client picks buffer > 1. Default buffer = 1 = today's pre-buffer behaviour exactly.
- **Round buffer prompted on every round, not just Round 01.** UI explicitly says "buffer between each round of work" — admin spec was implicit on this; chose per-round because the modal already exists at every round-creation point, and inheritance to subsequent rounds happens automatically via `handleRequestNextRoundDirect` reading the previous round's value.
- **Studio account intentionally not backfilled with `airtable_client_id`.** It's on the Pending list for architectural removal; creating a Clients row for it would leave Airtable debris to clean up later.
- **Manual invite "expires in 24 hours" disclaimer is conservative, not literal.** Real Supabase TTL is 7 days. The 24-hour line nudges admins to forward promptly rather than telling the recipient the link will work for a week.
- **No DialogClose customisation in `ManualInviteModal`.** shadcn's `DialogContent` already renders a top-right X with an `sr-only` "Close" label. Adding a labelled "Close" button would duplicate the affordance.

## Open questions or things to watch

- **Katharine Pooley corporate mail filter.** Still soft-bouncing `portal@silvershadowstudio.com` mail at last check, even after the verify-link + image-host fix. Emily Gooda was onboarded via a one-shot magiclink generated through direct `auth.admin.generate_link` and forwarded by Fred from his own inbox. The IT whitelist message was sent to her separately. Watch whether the second queued invite (`c0601bba-670b-4b57-90b1-52af69978212`) ever delivers — if not, the filter is sender-blocking us regardless of authentication. Possible follow-ups: add `silvershadowstudio.com` to Resend's "warm-up" pool, switch sender to a per-client subdomain alias (`portal-maybourne@silvershadowstudio.com`), or route critical mail through a different provider as fallback. Don't act until the Resend webhook is ingesting bounce reasons — without those we're guessing.
- **First-deploy stale-source recurrence.** `npx supabase functions deploy` ran in background without explicit CWD has now twice deployed pre-edit source despite returning exit-code 0 and `Deployed Functions on project ...`. Confirmed via `functions download` each time. Worth investigating whether the npx cache resolves a different temp directory, or whether the supabase CLI bundles from a stale tree when launched from `/`. Workaround for now: always deploy from project root, verify with `functions download` + `grep`.
- **`profiles.first_name` lookup silent failure.** Greetings on quotation and invoice emails (and now manual invite) pull `profiles.first_name` keyed by `user_id`. If a row is missing the greeting line silently drops. Not investigated this session.
- **`activity_log` actor-role caching.** The `cachedActor` map in `activityLog.ts:getActor()` is keyed by `userId` for the session lifetime. If an admin changes role mid-session (e.g. role granted via SQL), they keep the cached `"client"` role until refresh. Edge case, not urgent.
- **Manual Invite link single-use risk.** Some corporate mail scanners (Outlook Safe Links, Mimecast) pre-fetch URLs to scan them — burns the token before the recipient clicks. Manual Invite copy-flow encourages plain-text paste which mitigates this, but the failure mode is silent. Worth a one-line warning in the modal when we have an active deliverability ticket open.

---

# Session — 19 May 2026

Marathon session, 40 commits (`2f2e2ab` → `1d1492b`). Five major threads: (1) Client Agreement v3.0 from schema to route-gate to live email cascade, (2) admin sidebar restructure by audience with a shared `AccountList`, (3) Round modal Save Draft lifecycle end-to-end with sync gates, (4) email template visual system unification (invitation, services agreement, quotation, invoice), (5) Documents page status vocabulary + Round 01 nav fix + contract cover logo. Head: `1d1492b` on `origin/main`. Working tree clean. SUPABASE_ACCESS_TOKEN rotated mid-session (previous token returned 401 against `api.supabase.com`); new token is stored in the password manager — do not paste it into committed files.

## Completed this session

### 1. Client Agreement v3.0 — schema, gate, content, fixes (`86f161a`, `6eb8bb5`, `e803c49`, `5020d73`, `4d77b22`, `a47de30`, `f0b8ea8`, `6142812`, `e6a8469`)
- **Migration `20260518000002_agreement_v3.sql` applied.** `ALTER TABLE agreements ADD COLUMN IF NOT EXISTS agreement_version` (default `'SSS-CA-PROJECT-v3.0'`), `schedule_type CHECK IN ('project','partnership')`, plus forensic columns `scrolled_to_end_at`, `time_on_page_seconds`, `pdf_downloaded_before_signing`. Indices on `agreement_version` and `schedule_type`. `signatures_audit_log` needed no schema change — `document_type` accepts free-text but `CHECK` constraint enforces existing values; the v3 path now writes `'client_agreement'` (commit `4d77b22` fixed the initial `'client_agreement_v3'` rejection).
- **Route-level gate (`6eb8bb5`).** New `ProtectedClient.tsx` wraps client routes in `App.tsx`. Reads `agreements.account_id` for the authenticated user via `account_members`, gates on `status = 'signed'`. Admin/team/ghost bypass via `useAuth().accountType` and the role check. `e803c49` fixed the bypass — `app_role` enum has no `'super_admin'` value; query now `.eq('role', 'admin')` only with explicit error logging.
- **Acceptance gate page (`a47de30`, `f0b8ea8`).** Lives at `/sign-agreement` (route `/contract` deprecated; still exists but redirects). Dark portal surface; long-form agreement scroll; signature pad; minimum-time + scroll-to-end gates. `5020d73` fixed `street → street_name` column reference on `accounts` insert.
- **Storage path Option B (`6142812`).** v3 PDFs now stored at `agreements/{user_id}/{agreement_uid}.pdf` so the existing RLS policy (`auth.uid()` matches first path segment) works unchanged. Brief specified `{account_id}/...` but that requires an account-aware policy that doesn't exist yet — deferred to post-launch cleanup window (see Pending).
- **Storage delete RLS gap (`e6a8469`).** `agreements` bucket has only admin SELECT, no admin DELETE. `AdminDocuments.tsx handleDelete` now surfaces the storage failure as a destructive toast ("Storage cleanup failed — DB row removed but PDF blob remains in storage.") so admins know the gap exists. One-line migration deferred to same post-launch window.

### 2. Admin sidebar restructure + shared `AccountList` (`26a43d6`, `84c73d9`, `f48d0da`, `c2e0a7b`, `2fd05f6`, `2e335c5`, `704b7da`)
- **Sidebar grouped by audience.** `AdminSidebar.tsx` reorganised into Clients / Team / Finance sections with placeholder Team Invoices page added.
- **Orders hidden from sidebar (`2fd05f6`).** Partnership model paused; `/admin/orders` route still reachable by direct URL so the code isn't lost.
- **`AccountList.tsx` extracted (`84c73d9`).** `AdminClients` and `AdminTeam` now share the same row component (ghost / name / company / actions). Visual parity guaranteed.
- **Action prop split (`f48d0da`, `c2e0a7b`).** `showAccountActions: boolean` replaced with `headerNavigatesToProjects?: boolean` + `accountActions?: { editProfile?: boolean; delete?: boolean }`. AdminClients passes all three; AdminTeam passes only `{ delete: true }`. Delete-confirmation toast wording neutralised ("Account deleted") so the same handler serves both pages.
- **Silver Shadow studio account hidden from Clients page (`f48d0da`).** Temporary client-side filter in `AccountList.tsx` — the studio's own account row (`a09b2cdd-2c98-4415-a58d-ec6420d69bd6`) is misclassified as a client; proper fix in studio-account cleanup (Pending).
- **`SectionAccordion` shared component (`704b7da`, `2e335c5`).** Extracted from Documents page accordion logic, applied to admin Settings page. Single-section-open invariant + 200ms height/opacity transition. `AccordionHeader` count formatting changed today — see Documents page section below.

### 3. Round modal Save Draft lifecycle (`6c3430c`, `2827659`)
- **Migration `20260519000001_scene_rounds_draft_status.sql` applied.** Adds `'draft'` to `scene_rounds.status` CHECK constraint; partial unique index `idx_scene_rounds_one_draft_per_scene ON scene_rounds(scene_id) WHERE status = 'draft'` enforces one draft per scene.
- **Sync gates (`6c3430c`).** `airtable-auto-sync/index.ts` early-returns when `record.status = 'draft'`; same in `dropbox-save-round-files/index.ts`. Both deployed. Draft → non-draft transition routes through the existing `status_changed` branch with `isDraftSubmit` flag so Airtable + notification email fire at submit time, not at draft creation.
- **Modal wiring.** `NewRoundModal.tsx` accepts `onSaveDraft`, `onDiscardDraft`, `existingDraft` props. `Portfolio.tsx` queries for an existing draft on open via `openRoundModalForScene(sceneId)`, persists via INSERT/UPDATE on `scene_rounds(status='draft')`, promotes to `'pending'` on submit and explicitly invokes `dropbox-save-round-files` (the INSERT trigger doesn't fire on UPDATE).
- **Polish (`2827659`).** File restoration on draft reopen — `round_uploads` rehydrates the upload widgets, X-button deletion cleans up storage object + DB row. Draft visual treatment on scene + round cards (10px sans uppercase, `#8A8070` tracking 0.15em, 2px left border same colour). Admin read-only banner on TaskDetail when `roundStatus === 'draft'` + Dropbox sync panel hidden. Two-step discard button ("Discard draft" → "Confirm discard") wired to `handleDiscardDraft` which deletes only the `scene_rounds` row (uploads stay on the scene). `getSceneEffectivePhase` extended to bucket drafts as `'Awaiting Brief'`.

### 4. Email template visual unification (`679ffd3`, `2e445cc`, `f02eb6b`, `964b6a9`, `a45e260`, `843733c`, `c3e0c77`, `d5e6278`, `d1ce5ac`, `8aec1d3`, `c02866c`, `fc2305d`)
- **Trading name correction (`679ffd3`).** All client-facing email copy uses "Silver Shadow Studio" (trading); "Silvershadow Studio Limited" reserved for legal blocks only. Services Agreement email redesigned to invitation-email visual system (`#EDE8E0` background, 520px column, centred logo, Georgia serif body, gold-underline 11px sans CTA).
- **Invitation email (`843733c`, `c3e0c77`, `d5e6278`, `d1ce5ac`, `2e445cc`, `8aec1d3`).** Subject finalised as `Your portal is ready` (no trailing period). Body: `[First name],` greeting + two-sentence copy with hard line breaks + `ENTER` CTA. Footer removed.
- **Services Agreement email (`964b6a9`, `a45e260`, `8aec1d3`, `c02866c`).** PORTAL CTA matching invitation styling. Subject `Your Services Agreement`. `silvershadowstudio.com` footer line removed; architectural illustration removed in `c02866c` — wordmark sits 48px above body copy.
- **Quotation notification (`c02866c`).** Subject pattern `[Project Name] / Quotation / [Quotation Number]`. Heading: project name 32px serif (primary identifier) with quotation number 13px serif 55% opacity below at 8px gap. Gold `#B89A6A` hairline. First-name greeting pulled from owner `profiles.first_name`. "Your quotation includes:" + line-item names from `quotation_documents.line_items` rendered centred serif italic 14px, 8px spacing, no prices. `VIEW QUOTATION` CTA with 1px `#B89A6A` bottom border. Footer removed.
- **Invoice notification (`fc2305d`).** Subject pattern `[Project Name] / Invoice / [Quotation Number]` — pulled from the linked quotation via `invoice.quotation_id`. Same layout as quotation email: project name large, invoice number small. Line items pulled from linked quotation when available; fall back to `invoice.line_items` for standalone invoices. `PAY INVOICE` CTA matching style. Footer removed. Standalone fallback: subject becomes `Invoice / [Invoice Number]`.
- **Acceptance gate logo tint (`f02eb6b`).** Submit-state pulsing logo tinted to match the eyebrow above it.

### 5. Documents page status vocabulary + Round 01 nav + contract cover logo (`157fede`, `1d1492b`, `b89d555`)
- **Documents page (`157fede`).** Strict two-word status palette per section: Quotations show `Pending` (gold) for `status='sent'` and `Signed` (warm grey, `text-foreground/40`) for `signed`/`accepted`; any other DB status filtered out of the row render. Invoices fetch now `.in('status', ['sent','partially_paid','paid'])` so drafts/voided/credited never reach the list; rows render `Outstanding` (gold) or `Paid` (warm grey). Overdue treatment when `status='sent'` AND `due_date < today`: italic reference + italic date eyebrow, second eyebrow line `[N] Day(s) Overdue` in warm grey beside the status word (no new colour introduced). All status eyebrows tracked 0.24em at 9px. Subtitle copy changed to `Your agreement, quotations, and invoices`. `SectionAccordion.tsx` count formatting: `· 0` instead of `· None`. Alignment: explicit `margin:0; padding-left:0` on both reference `<p>` and date eyebrow inside the flex column; status column wrapped in `flex-col items-end` with `minWidth:96` so stacked eyebrows right-align cleanly.
- **Round 01 returns to scenes view (`1d1492b`).** `Portfolio.tsx handleCreateRound`: when the round just created/submitted has `round_number === 1`, clear both `selectedScene` and `selectedRound` so the page returns to the scenes overview instead of drilling into TaskDetail. Round 02+ keeps existing auto-drilldown behaviour. Applies to both fresh-round path and submit-from-draft path.
- **Contract cover logo (`b89d555`).** `Contract.tsx CoverBlock` H1 `SILVERSHADOW STUDIO` text replaced with the S3 logo (`https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/SilvershadowStudio.png`) at `height:28px; filter:brightness(0)` centred, matching the email/document treatment. Same 48px gap below it.

### 6. Client portal redesign cascade (`5b5289e`, `44279b1`, `c2834b1`, `c4e3bab`)
- **Restored project/scene/round creation with text-only gold-underline CTAs (`5b5289e`).** Replaced rectangular buttons with the same `border-bottom:1px solid #B89A6A` 11px sans uppercase pattern used throughout emails.
- **Agreement preview modal + sign-agreement page (`44279b1`).** Dark ground; minimal top bar; icon-only download. Sidebar compact view: icons-only bottom utility nav.
- **Client portal modals redesign (`c2834b1`).** New Project / New Scene modals refactored to match Round-modal language. Dictation review panel (raw transcript vs LLM-formatted brief) added via `format-brief` edge function — client always picks one before it enters the textarea, never auto-submits.
- **Empty state minimal text-only (`c4e3bab`).** Client-side "New Project" CTA removed from empty portfolio view.

### 7. Agreement v2.1 — 50/50 split (`2f2e2ab`)
- Net 7 deposit, Net 14 balance terms baked into Client Agreement v2.1 content. v3 inherits these.

### 8. Airtable schema canonicalisation in CLAUDE.md (`ad2070d`, `5df53f1`)
- Full Tasks table mapping documented in CLAUDE.md (table id `tbleHaU9DxHyvixdL`, field names, status enum). REVIEW status colour corrected to 🟠 (was 🔵). Portal ↔ Airtable rules clarified: portal reads Tasks only (no Day Logs / Cost / Holiday / Invoices); writes one-way for studio operations.

## In progress / needs verification

- **Quotation v2.0 implementation paused at migration stage.** Migration file `supabase/migrations/20260519000002_quotation_v2.sql` written and committed to repo BUT NOT APPLIED — awaiting Fred's confirmation on naming + scope. Proposes new tables `quotation_orders` + `quotation_order_line_items` (additive — legacy `quotation_documents` and the unused-but-extant `quotations` singular table both untouched). Open question: use `quotation_orders` name (current draft) or drop unused legacy `quotations` and recreate it as the v2 table? Once approved, the rest of the brief (admin compose UI at `/admin/quotations/new`, `_shared/pdf/quotation.ts` cream-paper render, `/quotations/{id}` dark portal accept page, `accept-quotation` edge function with PDF stamping + audit log + activity log, three emails, route gating, post-acceptance 320ms fade → 1500ms hold → `/documents` transition with 2000ms gold-underline highlight) is sized at ~8 phases per the brief's own sequencing.
- **Email greeting fallback.** Quotation + Invoice templates pull `profiles.first_name` keyed by `user_id` for the greeting line. If that column/table is named differently in the schema, the line silently doesn't render. Not verified live this session.
- **End-to-end live test of v3 acceptance gate.** Migration + gate + email cascade all shipped. Needs a fresh test client invited through `admin-create-client` to walk the full path: invite → set-password → `/sign-agreement` → sign → confirmation email lands → `/` accessible. Test account not yet created this session.
- **Round 01 navigation behaviour.** Confirmed via build only; not verified in browser. Hard-refresh required to bust the cache on Vercel.

## Pending

- **Quotation v2.0 full implementation (above).** Awaiting migration approval before phases 2–8 start.
- **Account-aware storage RLS for `agreements` bucket (Option A).** Move v3 PDFs back to `agreements/{account_id}/{agreement_uid}.pdf` once a `storage.objects` policy exists that allows any `account_members` row holder to read files prefixed with their account id. Pair with admin DELETE policy for the same bucket. One-line migration each. Group with studio-account architectural cleanup.
- **`/onboarding` self-registration path broken.** Still broken since `86f161a`. The legacy state-based `formData` flow that routed `/onboarding → /contract` no longer works with the v3 gate (now at `/sign-agreement`). Reaching it shows "We couldn't load your account". Either remove `/onboarding` from `App.tsx` or rebuild as a v3-aware self-registration flow if self-serve sign-up is wanted back.
- **Studio account architectural cleanup (post-Maybourne).** Silver Shadow Studio account row (`a09b2cdd-2c98-4415-a58d-ec6420d69bd6`, `account_type='partnership'`) still misclassified as a client; client-side filter in `AccountList.tsx` hides it. Proper fix: move studio company-level fields to `app_settings.studio_profile` JSONB or a `studio_profile` singleton, edit via AdminSettings, delete the accounts row, remove the temporary filter. Pair with the agreement-bucket RLS work above.
- **Existing test/dummy quotations and invoices in DB.** Several test rows from development. Delete or archive before going live with real clients. CLAUDE.md flags this.
- **Quotation number auto-generation.** Still manual. Logic should live in `QuotationFormDialog` or DB trigger: `account.client_code` + sequence (e.g. `WIN-001`). Pending — note that Quotation v2.0 work will subsume this if approved.
- **PDF generation for quotations and invoices via `_shared/pdfUtils.ts`.** Edge functions still not built. Currently PDFs are generated client-side only.
- **Pre-launch ghost mode test.** Walk through each active client's full flow before any real client is invited.
- **Brief field in Airtable.** Kieran needs to add a `Brief` field to the Tasks table for instructions sync to work.
- **SVG logo in invoice generator.** `public/generator/images/SS - Logo 2019.svg` not in git (spaces in filename); copy manually to that path on any new machine.
- **Other admin contract surfaces still using typeset wordmark.** Today's `b89d555` only swapped `Contract.tsx`. `AgreementViewer` modal preview, `accept-agreement` PDF generation, `preview-agreement-pdf` edge function, and freelancer documents PDFs all still render text wordmarks. Match the logo treatment if/when consistency wanted.

### Maybourne demo — feature backlog (19 May 2026)

Four feature requests surfaced during the Maybourne Hotels portal demo. None block Maybourne's Friday upload deadline or Monday production start. Build order and specs to be finalised by Fred this week.

**1. The "Isabelle button" — future-dated project booking with live countdown.** Client can book a project for a future delivery date and keep refining instructions until cutoff. The countdown timer is preserved throughout. Useful when a client knows they'll need 3 scenes mid-July but doesn't have all the information yet — they reserve the production slot, save as draft, and continue adding briefs/files/comments until the cutoff (Friday midday before production week). Named after Isabelle (Maybourne, who asked for it). When live, notify Sabrina at Maybourne.

**2. Reschedule / postpone delivery date.** Client can push a delivery back, up to one week before production starts (after that, the cutoff is locked because resources have been allocated). Real-world need: client-side delays, scope changes from upstream, internal sign-off bottlenecks. Cannot be used to bring delivery forward. When live, notify Sabrina at Maybourne.

**3. Round buffer field — time between rounds.** At the moment of new-scene booking, client chooses how much time they want between rounds (today: weeks; eventually: days). Default would be one week. Use case: clients with multiple stakeholders need 2-3 weeks between rounds to consolidate feedback. Affects scheduling math and the timeline rendering. When live, notify Sabrina at Maybourne.

**4. Multi-user commenting with coloured pens (Maybourne-only initially).** Maybourne wants several designers per account, not one point of contact. Specification:

- Maybourne admin can invite multiple users to the account
- Each user has their own pin/sticky/pen colour and signature on the document
- All invited users can comment, draw, upload references
- All invited users can request rounds (no single sign-off bottleneck)
- Invitees do not see Documents, Agreements, Quotations, or Invoices (designer-level role)
- Quotations and invoices generated by any user are sent to the admin + signatory/finance person, not the requesting designer

Kieran's "one point of contact" policy is preserved for other clients. The multi-user mode is opt-in per-account and must be toggleable in admin so it doesn't appear by default for non-Maybourne clients. The invitation button on the client side should be hidden unless multi-user is enabled for that account. Largest of the four — affects schema (per-user pin colour, `account_members.role` enum), RLS, UI permissions on the Documents page, role-based filtering on quotations/invoice recipients, and the invitation flow. When live, notify Sabrina at Maybourne.

---

**Internal — Operational instrumentation: onboarding funnel + connection visibility.** Not a Maybourne request. Internal tooling for studio visibility into client/team onboarding behaviour and engagement. Build after the four Maybourne features. Five components:

1. **`password_set` activity event.** New `ActivityAction` type. Fires from `SetPassword.tsx` on successful password mutation, for both client and team users. Captures `actor_role` correctly. Goes into `activity_log` like every other event.
2. **Time-to-sign metric on admin Agreements page.** On `/admin/documents` Agreements tab, display two computed time deltas per row:
   - Invite-to-signed (from `auth.users.email_confirmed_at` or `account_invitations.created_at` to `agreements.created_at`)
   - Password-set-to-signed (from the new `password_set` activity event to `agreements.created_at`)
   - Both rendered as a small line: e.g. "Signed 4h 12m after password set" in muted text.
   - Admin-only metric. Never expose to clients.
3. **Last connection summary on admin Clients list.** Each client account card in `/admin/clients` shows a small line at the bottom of the per-user row: "Last seen 3h ago · 18m session" or similar. Reads from existing `client_activity` table (`started_at`, `duration_ms`, `kind = 'session'`).
4. **Expandable connection history.** Clicking the last-connection summary line expands to show the last 10 sessions for that user: timestamp, duration, page count. Subtle accordion, same style as the rest of the admin UI. Closeable.
5. **Existing `client_activity` table audit.** Before building 3 and 4, verify the existing heartbeat / session-tracking logic captures what we need:
   - Are sessions actually closed reliably (do `ended_at` and `duration_ms` get populated when the user navigates away, or only on explicit logout)?
   - Is the `kind`-based filter (e.g. `kind = 'session'` vs `kind = 'page_view'`) the right anchor for "session duration"?
   - The existing `/admin/client-activity` route already renders this data — confirm whether building 3 + 4 means duplicating that view at smaller scale on `/admin/clients`, or refactoring shared components.

Honest caveats to revisit before building:

- Tab-focus time is a noisy proxy for engagement. Long-running background tabs inflate duration. Decide whether to filter sessions over a threshold (e.g. cap at 30 minutes) or accept the noise.
- "Time to sign" is interesting but not actionable as a single metric. Useful only in aggregate or as a trigger for follow-up ("they got the invite 3 days ago and haven't signed").
- Consider whether a "stuck in onboarding" admin alert (auto-generated when a client has set password but not signed within N days) is more useful than just exposing the raw delta. Possibly the real product.

No code changes from this entry — captured for future implementation. Build order: after all four Maybourne features ship.

### Portal → Airtable sync architecture (decided 19 May 2026)

One-way push from portal to Airtable for entities the portal owns: **Clients** (`accounts`), **Users** (`account_members` + `auth.users`), **Projects**.

Airtable owns production entities: **Tasks**, **Scene Manager Day Logs**, **Modeller Invoices**, **Scene Manager Invoices**, **Cost/Budget table**, **Team Holiday Tracker**. Portal does not read or write these.

Bidirectional sync explicitly rejected. Reasons: conflict resolution complexity, schema drift, data type translation. Portal defines the canonical schema for shared entities; Kieran can add Airtable-only columns for his operational use without the portal touching them.

Field mapping is declarative via `app_settings.airtable_contact_field_config` and `app_settings.airtable_project_field_config`. Adding a new portal field surfaced to Airtable: (1) Kieran adds the column to the Airtable table, (2) admin adds the field config key in `app_settings`, (3) sync code maps the portal column to the Airtable column. No schema sync, no auto-column creation.

### Email deliverability — Katharine Pooley invite bounce (20 May 2026)

Invitation email to `emilyg@katharinepooley.com` sent at 18:24 BST on 19 May 2026 (Resend id `e5b8dccf-383a-4ebf-b06e-a7af8dcadb2b`, from `portal@silvershadowstudio.com`, subject "Your portal is ready", tag `category: invite`) hard-bounced. Resend's REST API returns only `last_event: "bounced"` for this message — the SMTP response code, bounce category (hard/soft/policy/transient), and DNS/auth detail are not exposed via `GET /emails/{id}` or `GET /events?email_id=…` (the latter returns an empty list for this account). Probed `/emails/{id}/events`, `/emails/{id}/bounce`, `/bounces`, `/suppressions` — all 405 Method Not Allowed. That detail only ships via webhook (`email.bounced` payload with `bounce.type`, `bounce.message`), and no webhook is configured today, so `email_send_log` has zero rows for this message.

All other portal invites sent the same evening (`fred+demo2@`, `lpetak@maybourne.com`, `fred+testteam@`) delivered cleanly, so this is not a domain-wide SPF/DKIM/DMARC failure on `silvershadowstudio.com`. Most likely recipient-side: mailbox no longer exists, mailbox over quota, or corporate mail filter blocking the `portal@` sender. Without Resend's webhook payload there's no programmatic way to distinguish. The Resend dashboard at `https://resend.com/emails/e5b8dccf-383a-4ebf-b06e-a7af8dcadb2b` shows the SMTP reason in the web UI for manual triage.

A second invite to the same address was queued at 2026-05-20 14:36:25 UTC (id `c0601bba-670b-4b57-90b1-52af69978212`) — likely an admin retry; not investigated further.

The `resend-find-email` edge function deployed this session (admin-gated + service-role bearer for shell triage) is the tool for this kind of lookup. Two modes — list-by-recipient-with-time-window, and Resend-endpoint probe.

### Pending — Resend webhook ingestion + deliverability admin UI

- **Resend webhook ingestion to `email_send_log`.** Add a `resend-webhook` edge function (signature-verified via Resend webhook secret) that receives `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked` events and writes rows to `email_send_log` with the full bounce sub-object (`bounce.type`, `bounce.message`, SMTP response code, recipient diagnostics). Register the endpoint in the Resend dashboard. After this lands, future bounce triage is a SQL query rather than a Resend dashboard manual lookup.
- **Admin UI: bounce status on client profile + retry/override.** On `/admin/clients/<accountId>`, surface per-recipient deliverability: latest `last_event` per email, bounce reason inline, "Resend invitation" button (already exists for unsigned agreements), and an "Override to known-good email" button that updates `auth.users.email` via `supabase.auth.admin.updateUserById` then re-invites. Hooks into the new `email_send_log` rows added by the webhook above — both items should ship together so the UI has data to render.

## Decisions made

- **Quotation v2.0 — new tables, not in-place migration.** Brief proposed refactoring `quotation_documents` OR a successor table; chose successor (`quotation_orders` + `quotation_order_line_items`). Additive, preserves all signed historical quotations under the legacy code path, no destructive DDL. Awaiting Fred's confirmation on the specific name.
- **Money stored as INTEGER minor units.** New quotation tables use `net_total_minor / vat_total_minor / gross_total_minor INTEGER` columns (pence/cents), dodging floating-point.
- **No drawn signature on the on-portal Quotation acceptance.** Per the v3 Agreement's clause 10, portal-click is the act. Brief Section 4.2 explicitly says no signature pad — the click is contractual. Migration omits the `accepted_signature_png BYTEA` column the original brief listed.
- **Draft polish: scene-level uploads stay when a draft is discarded.** `handleDiscardDraft` deletes only the `scene_rounds` row. Files persist on the scene via `round_uploads`; the client can X-remove them individually before discarding if they want them gone. Reasoning: uploads are scene-scoped, not round-scoped, in the existing schema.
- **Submit-from-draft path: explicit Dropbox sync invocation.** The `dropbox_round_created` trigger fires on INSERT only. The submit-from-draft path is an UPDATE (status: draft → pending), so `Portfolio.tsx handleCreateRound` explicitly invokes `dropbox-save-round-files` after the UPDATE returns.
- **Round 01 lands on scenes overview, not round detail.** No assets to view yet; the scenes grid is the more useful place to land. Round 02+ keeps the auto-drilldown.
- **Status vocabulary on Documents page: two words per section, two colours total.** Gold for action, warm grey for at-rest. No red / green / orange ever. Drafts/expired/withdrawn quotations and drafts/voided/credited invoices are filtered out of the client list entirely (still reachable by direct URL).
- **Overdue invoice signal: italic + suffix only.** No new colour. The italic on reference + date eyebrow, plus the `[N] Day(s) Overdue` warm-grey suffix beside the gold `Outstanding` word, carries the entire signal.
- **Contract cover uses image logo, not typeset wordmark.** Matches email + document treatment. `Contract.tsx` only this session; other surfaces left untouched intentionally (see Pending).
- **`SUPABASE_ACCESS_TOKEN` rotated mid-session.** The previous token returned 401 against `api.supabase.com`. New token stored in the password manager (Supabase dashboard → Account → Access tokens); not committed to the repo. Used today to deploy airtable-auto-sync, dropbox-save-round-files, accept-agreement, send-quotation-email, send-invoice-email.
- **Agreement v3 storage path: Option B (user_id), not Option A (account_id).** RLS on `storage.objects` for `agreements` bucket matches `auth.uid()` to first path segment; Option A requires a new account-aware policy that's deferred. Option B was the unblock.

## Open questions or things to watch

- **`profiles` table schema for first-name greeting.** The new quotation + invoice email templates assume `profiles.first_name` keyed by `user_id`. If this lookup silently fails (no row, wrong column name), the greeting line just doesn't render — graceful but worth verifying.
- **Quotation v2.0 table-name collision.** The unused `quotations` (singular) table is in the schema but has no `.from("quotations")` callers anywhere in code. Could safely be dropped to free the canonical name, but that's a destructive DDL; chose additive path. Revisit if naming bothers anyone.
- **`agreements` bucket admin DELETE RLS gap.** Surfaces as a destructive toast today; the PDF blob is orphaned when an admin deletes an agreement. Audit-trail-safe but a hygiene issue. One-line migration: `CREATE POLICY "Admins can delete agreement files" ON storage.objects FOR DELETE TO public USING (bucket_id = 'agreements' AND is_admin())`.
- **Quotation `line_items` JSON shape variance.** Both email templates support `description`, `name`, and `title` keys when extracting line-item names from quotation `line_items`. If older rows use a different key, the names just won't render — also graceful. Not investigated this session.
- **v3 acceptance gate live email cascade unverified.** The Services Agreement confirmation email (rebuilt twice today, latest in `c02866c` without the illustration) was wired via `accept-agreement` edge function but no real signing happened this session.



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

- **v3 agreement storage path uses `user_id` (Option B) — revisit when studio-account cleanup is done.** The v3 acceptance brief specified `agreements/{account_id}/{agreement_uid}.pdf`, but the existing storage RLS policy `"Users can view their own agreement files"` matches `auth.uid()` against the first path segment. The account-keyed layout left signed clients unable to read their own file. Tonight's fix: `handleV3Acceptance` now writes to `{user_id}/{agreement_uid}.pdf` — same first-segment shape as v2.x, so existing RLS works unchanged. **Proper end state is Option A**: an account-aware RLS policy on `storage.objects` that allows any `account_members` row holder to read files prefixed with their account id. Move the v3 path back to `{account_id}/...` at that point. Best done alongside the studio-account architectural cleanup, since both touch account-level ownership semantics. No migration required for the current state.
- **Agreements storage bucket — admin DELETE RLS policy missing.** Sibling buckets (`round-uploads`, `scene-assets`, `scene-images`, `pin-attachments`, `freelancer-agreements`) each have an admin DELETE (or full `ALL`) policy on `storage.objects`. The `agreements` bucket only has admin SELECT (`"Admins can view all agreement files"`). When an admin deletes an agreement from `/admin/documents`, the storage remove call is rejected by RLS; the DB row deletes successfully but the PDF blob is orphaned. Affects v2 and v3 rows equally — not a v3 regression. Tonight's mitigation: `AdminDocuments.tsx handleDelete` surfaces the failure as a destructive toast ("Storage cleanup failed — DB row removed but PDF blob remains in storage.") so admins know the gap exists. Proper fix is a one-line migration: `CREATE POLICY "Admins can delete agreement files" ON storage.objects FOR DELETE TO public USING (bucket_id = 'agreements' AND is_admin())`. Group with the Option A storage-RLS work above and the studio-account architectural cleanup — same migration window.
- **`/onboarding` self-registration path broken.** The legacy state-based `formData` flow that routed `/onboarding → /contract` no longer works after the v3 gate landed (commit `86f161a`). The new `Contract.tsx` is a post-login acceptance gate that expects an authenticated user with an `account_members` row, not a freshly-collected company form in `location.state.formData`. The `/onboarding` route still exists in `App.tsx` but reaching `/contract` from it shows "We couldn't load your account". Currently dormant — admin-invite is the production onboarding path and the DB wipe earlier today confirmed no in-flight self-registrations. Next session: either remove `/onboarding` from `App.tsx` entirely, or rebuild it as the v3-aware self-registration flow if self-serve sign-up is wanted back.
- **Studio account architectural cleanup (post-Maybourne).** The studio's own account row (Silver Shadow Studio, `account_type = 'partnership'`, id `a09b2cdd-2c98-4415-a58d-ec6420d69bd6`) is currently misclassified as a client. Temporary fix in place: client-side filter in `AccountList.tsx` hides it from the Clients page. Proper fix to be done after the Maybourne launch:
  - The studio is not a customer of itself — it shouldn't have an `accounts` row at all.
  - Move company-level fields (company name, registration number, address, country) from the account row to a new `app_settings.studio_profile` JSONB column or a dedicated `studio_profile` singleton table.
  - Add a "Studio Information" section to the admin Settings page (`AdminSettings.tsx`) where these fields are edited.
  - Migrate the data, then delete the Silver Shadow Studio account row.
  - Remove the temporary client-side filter in `AccountList.tsx`.
  - Decide whether the existing signed agreement for Silver Shadow Studio (id `9eb1277e-7080-4556-bcf7-b2661fd9ba4a`, signed 2026-05-06) needs to be migrated, archived, or deleted as part of this.
- **`AccountList` action props split for Team delete (shipped this session).** `showAccountActions: boolean` replaced with `headerNavigatesToProjects?: boolean` + `accountActions?: { editProfile?: boolean; delete?: boolean }`. AdminClients passes all three (header nav, edit, delete); AdminTeam passes only `{ delete: true }`. The delete-confirmation toast/dialog wording is now neutral ("Account deleted", not "Client deleted") so the same handler works for both pages.
- **Partnership / subscription model — paused, to be revisited.** The Orders system (`/admin/orders`, `Orders.tsx` for partnership clients, the `orders` table, the subscription and project order types in code, and the Lane subscription content in clauses 2 and 6 of the Client Agreement) is dormant infrastructure for a commercial model that is not currently active. All real Silvershadow clients today are project-based and use the quotation flow. Orders entry hidden from `AdminSidebar.tsx` this session; route + page kept reachable by direct URL so the code isn't lost. When the partnership / subscription model is finalised, revisit:
  - Re-enable the Orders sidebar entry in `AdminSidebar.tsx`.
  - Confirm the Orders menu item is correctly shown only to partnership clients in `ClientSidebar.tsx`.
  - Review the contract's clauses 2 and 6 around Lanes and subscriptions to confirm they still match the intended model.
  - Decide whether subscription billing automation is needed (currently no automatic invoice on subscription orders).
  - Decide whether the Orders system should be unified with Quotations or remain a separate commercial track.
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
