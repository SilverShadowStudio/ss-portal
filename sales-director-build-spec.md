# ss-portal — Sales Director Build Spec

**For:** Claude Code, working in the `ss-portal` repo
**Goal:** A sales section that behaves like a demanding senior sales director. The admin is the sales rep. The system tells them what to do, they report back what happened, it re-ranks and tells them the next thing.

Do not build a CRM grid. `AdminSales.tsx` already is one. This is a **loop with an opinion** sitting on top of it.

---

## 0. Non-negotiable design principles

1. **The loop is the product:** Brief → Act → Debrief → Re-rank → Brief. Every design decision protects the speed of one cycle. If the debrief takes more than ~15 seconds, the rep stops doing it, the data rots, and the feature is dead within two weeks.
2. **Debrief is free text, never a form.** One tap for the common outcome + one sentence of typed text. The LLM parses it into structured rows. No dropdowns for "what happened".
3. **The coach always has an opinion.** Never "here are your options." Always "do this, because X."
4. **Commitments are the spine.** Everything the coach does hangs off promises made and whether they were kept.
5. **Greenfield.** Per the briefing there is no usable history — 272 leads, flat status, no stages, no losses, no activity log. Design the schema clean. Do not retrofit.

---

## 1. Schema (migration: `supabase/migrations/<ts>_sales_director.sql`)

Follow the RLS pattern from `20260731000001_leads.sql` (admin-only via `user_roles`) for every new table.

### 1.1 `pipeline_stages` (lookup — additive, per HANDOFF.md)
```
key            text PK          -- 'new','contacted','engaged','qualified','proposal','negotiation','won','lost','dead'
label          text NOT NULL
sort_order     int NOT NULL
probability    numeric NOT NULL -- 0..1, used by the ranker; seed with estimates, tune later
is_terminal    boolean NOT NULL default false
is_active      boolean NOT NULL default true
```
Seed all nine. Stages must be addable via row insert, not code change.

### 1.2 `leads` — extend (do not drop anything)
```
stage                 text NOT NULL default 'new' REFERENCES pipeline_stages(key)
outcome               text            -- 'won' | 'lost' | 'dead' | null
loss_reason           text            -- free text, coach-extracted
loss_reason_category  text            -- 'price','timing','no_budget','competitor','no_decision','wrong_fit','ghosted','other'
closed_at             timestamptz
expected_margin_pct   numeric         -- see §7 finance note
owner_id              uuid NOT NULL REFERENCES auth.users(id)  -- CONFIRMED: a second rep is coming. Enforce from day one.
converted_account_id  uuid REFERENCES accounts(id)   -- kills the "leads is an island" problem
stalled_at            timestamptz     -- set automatically, see §4.3
```
Backfill: map existing `status='won'` → `stage='won'`, `outcome='won'`. `status='new'` → `stage='new'`. Keep `status` in place for now; add a follow-up migration to drop it once nothing reads it. Backfill `owner_id` to the current sole admin.

**Multi-rep from day one (confirmed decision).** The portal is currently single-tenant on the admin side — admins see everything. That stays true for the *lead table*, but every new table in this spec carries `owner_id` and the coach layer is scoped per rep:
- `commitments`, `coach_directives`, `sales_targets`, `coach_settings` are all filtered by `owner_id = auth.uid()`.
- A rep's brief, pace, and commitment ledger show **their** work only. A shared brief is not a brief.
- Add an admin-only "all reps" toggle on `PipelineDiagnosis` for the manager view.
- RLS: `owner_id = auth.uid() OR is_admin()`. Write the `is_admin()` helper once in the migration and reuse it.

Retrofitting this later means rewriting every query and every RLS policy. Doing it now costs almost nothing.

### 1.3 `lead_events` (immutable audit — this is the history that doesn't exist today)
```
id, lead_id FK, event_type ('created'|'stage_change'|'outcome_set'|'owner_change'|'value_change'),
from_value text, to_value text, actor_id uuid, source ('ui'|'coach'|'import'|'system'), created_at
```
Write via a Postgres trigger on `leads` so nothing can change a stage without leaving a trace. This table is what makes stage-duration analysis and "how long do deals sit here" possible in six months.

### 1.4 `interactions` (one row per touch — calls, emails, meetings)
```
id, lead_id FK, type ('call'|'email'|'meeting'|'linkedin'|'whatsapp'|'other'),
direction ('outbound'|'inbound'),
outcome ('no_answer'|'left_message'|'spoke'|'meeting_booked'|'pushed'|'objection'|'dead'|'other'),
summary text,              -- LLM-normalised
raw_debrief text,          -- exactly what the rep typed. NEVER discard this.
objection text,             -- extracted, nullable
occurred_at timestamptz NOT NULL default now(),
created_by uuid, created_at
```
Also update `leads.last_contacted_at` on insert via trigger.

### 1.5 `commitments` — **the most important table in this spec**
```
id, lead_id FK, interaction_id FK nullable,
party ('us'|'them'),
description text NOT NULL,
due_date date NOT NULL,
status ('open'|'kept'|'missed'|'cancelled') default 'open',
owner_id uuid NOT NULL REFERENCES auth.users(id),
slip_count int default 0,      -- increments each time due_date is pushed
original_due_date date,
completed_at timestamptz, created_at
```
Every debrief must produce at least one `party='us'` commitment with a date, or explicitly mark the lead stalled. There is no third option.

### 1.6 `coach_directives` (what the coach told you, and whether you did it)
```
id, lead_id FK nullable, directive text, why text, suggested_opening text, win_condition text,
rank int, score numeric, generated_for date,
owner_id uuid NOT NULL REFERENCES auth.users(id),
status ('pending'|'acted'|'dismissed'|'expired'),
acted_interaction_id FK nullable, created_at
```
Persisting these is what lets the coach say *"this is the third time I've put this at the top."* Without it, it has amnesia and it will feel like a tips generator.

### 1.7 `sales_targets`
```
id, period_start date, period_end date, amount numeric, currency text,
owner_id uuid NOT NULL REFERENCES auth.users(id), created_at
```
Per-rep targets. A studio-wide number is the SUM of these, computed in the manager view — not a separate row type.

### 1.8 `coach_settings`
```
user_id uuid PK, intensity ('direct'|'hard'|'brutal') default 'hard',
daily_call_target int default 10, daily_meeting_target int default 2,
created_at, updated_at
```

---

## 2. Edge functions

Copy `supabase/functions/draft-sales-pitch/index.ts` **verbatim** as the scaffold for each — same admin gate (Bearer → `getUser()` → `user_roles`), same retry/backoff on `[429,500,502,503,529]`, same `x-api-key` + `anthropic-version: 2023-06-01` headers.

**Model:** use `claude-sonnet-5`. The repo currently pins `claude-sonnet-4-5`, which still works but is a generation behind — Sonnet 5 is materially better at the structured extraction the debrief parser needs. Confirm the key has access with `GET https://api.anthropic.com/v1/models` before switching, and leave the model id in one shared constant so it is a one-line change later.

### 2.1 `_shared/coachPrompt.ts`
Exports `buildCoachSystemPrompt(intensity)`. Keep the persona in **one file** so tone can be tuned without touching logic. See §5.

### 2.2 `sales-coach-brief`
- **In:** `{ date? }`
- Loads: active leads **owned by the calling user** (non-terminal stage), open + overdue commitments, last 3 interactions per lead, current target + progress, pending directives from previous days.
- Computes the rule-based score (§4) in TypeScript — **not** in the LLM.
- Sends the **top 15 only** to Claude with the pace gap and overdue commitments. Sending all 272 wastes tokens and dilutes the ranking.
- **Out:** 5–7 directives, each with `directive`, `why`, `suggested_opening`, `win_condition`. Persist to `coach_directives`.
- **Guardrail:** before suggesting any email action, check `suppressed_emails` for that address. If suppressed, the coach must say so and switch channel.

### 2.3 `sales-coach-debrief` — the highest-value endpoint
- **In:** `{ lead_id, raw_text, quick_outcome? }`
- LLM extracts strict JSON (no prose, no markdown fences — strip defensively before parse):
```json
{
  "interaction": { "type": "", "direction": "", "outcome": "", "summary": "", "objection": null },
  "stage_change": { "to": "qualified", "reason": "" } | null,
  "lead_updates": { "contact_name": null, "role": null, "value_estimate": null },
  "commitments": [ { "party": "us", "description": "", "due_date": "2026-08-07" } ],
  "commitments_resolved": [ { "id": "", "status": "kept" } ],
  "outcome": null,
  "loss_reason": null, "loss_reason_category": null,
  "needs_pushback": true,
  "pushback_reason": "no next step given"
}
```
- Writes all rows in a transaction, then **immediately returns the next directive** in the same response. That instant re-rank is what makes it feel like a conversation with a boss instead of data entry.
- **If `needs_pushback`:** do not save a soft close. Return the coach's challenge and keep the debrief sheet open. e.g. rep types "left a message" → coach: *"That's not an outcome. Next attempt, and when? No date means this is stalled and I'm marking it."*

### 2.4 `sales-coach-qualify`
- **In:** `{ lead_id }` → **Out:** `{ verdict: 'pursue'|'park'|'pass', reasons: string[], disqualifier: string }`
- **Be honest with yourself here:** with 3 wins and 0 recorded losses there is nothing to learn from. v1 is rules + sector/size heuristics, and the UI must label it as such. It becomes a real specialist only after the Excel import (§8).

---

## 3. Frontend

`src/pages/admin/AdminSalesCoach.tsx`, route in `App.tsx` under `<AdminProtectedRoute>`, nav item in `AdminSidebar.tsx` `SECTIONS` (indent under Sales, `badgeCount` = overdue commitments).

**Use `@tanstack/react-query` for this module.** The briefing flags the server-state pattern as inconsistent — this is the module to set the standard in. No raw `supabase.from()` into `useState`.

Reuse: `AdminLayout` (`panel`), `.ssr-panel/-zone/-tile`, `useFx`/`CurrencyAmount`, `BrandLoader`, `CircleButton`. Tables stay on `useTableSort` + `TableToolbar`.

### Components
| Component | Job |
|---|---|
| `PaceHeader` | First thing on screen. Gap to target, days left, required run rate. No green checkmarks, no celebration widgets. |
| `CommitmentAlert` | Overdue promises, above everything else. If any exist, the brief opens with them. |
| `DirectiveCard` | Who · why now · suggested opening · what a win looks like. One primary action: **Debrief**. |
| `DebriefSheet` | Quick-outcome chips (No answer / Left message / Spoke / Meeting booked / Pushed / Dead) + one textarea. Submit → shows the coach's reply and the next directive **in place**. Never navigates away. |
| `LeadDossier` | Per-lead: relationship map, commitment ledger, interaction timeline, objection history. |
| `PipelineDiagnosis` | Verdict paragraph, not a dashboard. Single-threaded deals, stage-duration outliers, coverage ratio. |
| `IntensityDial` | Direct / Hard / Brutal in settings. |

Mobile matters — debriefs happen between calls, on a phone. `DebriefSheet` must be thumb-usable.

---

## 4. Ranking (rules-based v1, in TypeScript)

### 4.1 Score
```
score = value_weight × stage_probability × urgency × commitment_penalty × confidence

value_weight       = log10(max(value_estimate, 1000))          -- dampens whale bias
stage_probability  = pipeline_stages.probability
urgency            = 1 + (days_since_last_contact / stage_expected_cycle_days)
commitment_penalty = 1 + (0.5 × open_overdue_commitments)      -- broken promises float to the top
confidence         = 0.6 if contact_name is null, else 1.0
```

### 4.2 Hard overrides (bypass the score)
1. Any overdue `party='us'` commitment → top of the list, always.
2. `next_action_at` due today → top block.
3. A lead the rep has dismissed 3× → surfaced as a **kill candidate**, not an action.

### 4.3 Auto-stall
Nightly: any non-terminal lead with no interaction in > 21 days and no open commitment → set `stalled_at`, write a `lead_events` row. Stalled leads leave the active brief and enter a weekly **"kill or revive"** queue. Deals must not be allowed to quietly rot in the pipeline.

---

## 5. The coach persona (in `_shared/coachPrompt.ts`)

Encode as explicit rules, not adjectives:

- **Never open with praise.** Open with the outstanding commitment, or the gap to target.
- **One directive, not a menu** — unless the rep explicitly asks for alternatives.
- **Name the pattern, not the incident.** One missed call is noise. "Fourth deal this quarter lost after quoting on the first call" is coaching. Only make pattern claims when the data supports them — never invent a pattern from three data points.
- **Name avoidance.** Easy calls done, hard call skipped → say so.
- **Kill deals out loud.** *"Drop it. Three months, no second contact, no budget confirmation. You're keeping it in the pipeline because it makes your numbers look better."*
- **Reference its own history.** Query `coach_directives` — *"third time I've put this at the top. What's actually blocking?"*
- **Praise is rare and specific.** Constant praise is worthless.
- **Own bad calls.** *"I flagged this high-fit. It stalled. I read the trigger wrong."*
- **Never invent client facts.** Everything about a client comes from `interactions` and `leads`. If it doesn't know, it asks.

### The one guardrail worth building
**Hard on inputs, fair on outcomes, hardest on honesty.** Pressure works on what the rep controls — calls made, commitments kept, next steps set, honest qualification. Aiming it at things they don't control (a client's procurement delay) just trains them to hide information in debriefs, and then the dataset rots and the whole system stops working. Put this in the prompt explicitly.

Intensity dial is a real setting, not decoration — needed the day this is handed to anyone else.

---

## 6. Cron

- `sales-coach-nudge` — daily. Overdue commitments → Resend email to the rep. Follow `_shared/cronAuth.ts` / `requireCronOrAdmin` + `X-Cron-Secret`. Schedule SQL applied manually in the Dashboard, per existing convention.
- `sales-coach-stall-sweep` — nightly, implements §4.3.
- pg_cron is UTC-only with ±1h DST drift. Irrelevant at these times; don't engineer around it.
- The brief itself is generated **on page load**, not by cron — it must reflect the debrief submitted 30 seconds ago.

---

## 7. Finance — what to wire, what to leave

**Tier 1 (do now):** `expected_margin_pct` on leads. Without margin the coach optimises for revenue and will actively push the rep toward the wrong deals — a £50k job at 12% loses to a £20k job at 45%, and a revenue-only ranker says the opposite. This is the single most common failure mode in CRM scoring.

**CONFIRMED: margin lives in Airtable.** First task of phase 1, before any schema work:

1. Find where Airtable margin data actually lands. The sync is one-way (Airtable → portal) — check whether margin reaches a Postgres table at all, or stops at Airtable.
2. Report back one of three findings:
   - **(a) Already synced** → identify the table/column, join `leads.expected_margin_pct` to it, no manual entry needed.
   - **(b) In Airtable but not synced** → extend the existing sync to pull the margin field. Follow the existing sync function's pattern. **Never write back to Airtable.**
   - **(c) Per-project actuals only, no per-lead estimate** → then margin is a *forecast* at qualification, not a lookup. `expected_margin_pct` is manual entry, defaulted from the historical average by segment (interior design vs hospitality vs yachts almost certainly differ).
3. Do not guess which of these is true. Read the sync functions and the Airtable schema, then say which one it is.

If (c), also add `actual_margin_pct` populated on close — that's the loop that eventually tells the coach which *kinds* of work are worth chasing.

**Tier 2 (later, once there's data):** payment behaviour and receivables from `invoices` (3 rows today — not yet useful). This is what eventually unlocks *"don't discount that renewal, they paid 60 days late twice."*

**Tier 3 (skip):** company P&L, cash flow, payroll. It won't improve a single deal-level decision and it widens the blast radius of any leak or screenshot. One exception: if cash collection is tight, encode a rule — *"prioritise deals with upfront terms this quarter"* — not a finance feed.

Language discipline: the coach reasons with margin, it does not recite margin figures in every brief. If it starts sounding like an accountant it stops sounding like a sales director.

---

## 8. Build order

| Phase | Ship | Why |
|---|---|---|
| **1** | Schema + `sales-coach-debrief` + `DebriefSheet` | The loop's bottleneck. If debriefing isn't frictionless, nothing else matters. Start generating the dataset immediately. |
| **2** | `sales-coach-brief` + `PaceHeader` + `CommitmentAlert` + `DirectiveCard` | The daily surface. Now it's usable end to end. |
| **3** | `LeadDossier`, commitment ledger UI, stall sweep | Memory becomes visible. |
| **4** | Excel importer (10 years of leads, per HANDOFF.md) | **The unlock.** This is where win/loss patterns become real instead of asserted. |
| **5** | `sales-coach-qualify` with real scoring + `PipelineDiagnosis` | Only meaningful after phase 4. |

---

## 9. Blockers / open questions — answer before phase 4

1. ~~The Excel of ~10 years of leads.~~ **RECEIVED.** See the addendum — it is a contact list, not a deal history. Read the addendum before building; it changes the schema (adds `contacts`) and the build order.
2. ~~Historic losses with reasons?~~ **NO.** 21 dead companies, 4 with a reason. Phase 6 stays heuristic.
3. ~~Margin?~~ **In Airtable.** See §7 — investigate and report which of the three cases applies before writing schema.
4. **Currency:** still open. `useFx` exists — confirm targets and lead values are stored in one base currency with FX at display. The 3 legacy `Potential` values are GBP; assume GBP base unless the code says otherwise.
5. ~~Second rep?~~ **YES.** `owner_id` enforced from day one, per-rep RLS on the coach layer. See §1.2.

---

## 10. Things that will break this if ignored

- Check `suppressed_emails` before any coach-suggested email. Non-negotiable.
- `account_members.user_id` is UNIQUE (one user = one account) — this constrains the lead→client conversion flow. Design that action around it.
- `accounts` is a client/team hybrid; filter on `account_type` when converting so a lead can't become a freelancer record.
- Never write back to Airtable.
- Don't route anything through Stripe.
- Deploy edge functions from project root and verify — stale-cache deploys are a known issue.
- `raw_debrief` is never overwritten by the LLM's normalised summary. If the parser gets something wrong, the original text is the only recovery path.
