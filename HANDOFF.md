# Session Handoff — 17 May 2026

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
