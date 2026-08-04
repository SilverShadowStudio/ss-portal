# Addendum — Legacy Sheet Import (`POUBELLE - 01 - Interior Design`)

Supersedes §8 phase 4 and §9 questions 1–2 of `sales-director-build-spec.md`.

---

## 1. What this file actually is

**It is a contact database, not a deal history.** That distinction changes the plan.

| | |
|---|---|
| Raw rows | 445 (109 blank, 6 section banners, 7 junk `FOLLOW UP` markers) |
| Real contact rows | **286** |
| Unique companies | **226** |
| Companies with >1 contact | **34** |
| Named contacts | 229 |
| With email | 105 · with phone 107 · with LinkedIn 152 |
| With any contact history | 108 |
| With a written call report | **57** |
| Date span | March 2017 → April 2026 |
| Geography | UK 158, USA 42, France 28, UAE 12, Italy 6, Saudi 5, + 8 more |

**`Lead Status`, `Probability`, `Expected Revenue`, `Last Email on ?` and `Quotation on ?` are 100% empty.** Every column that would have carried an outcome was created and never filled.

### The honest consequence
The Excel import was supposed to unlock win/loss pattern coaching. **It does not.** There are 21 companies in a `DEAD` block and only 4 carry any reason. There are no won deals, no values, no close dates, no stage history. You cannot compute a win rate, a loss pattern, or a cycle length from this.

So: **§8 phase 5 stays blocked, and the qualification engine stays rules-based.** Do not let the coach claim it knows your win patterns — it would be inventing them. What this file gives you is a *starting pipeline*, not a *training set*. The training set starts accumulating the day phase 1 ships.

---

## 2. What it does unlock — three real things

### 2.1 A contacts table is now mandatory (schema change)
Caudwell has 4 rows, Grosvenor 4, Aman 4 — different people, same company. The sheet is **one row per contact**. The original spec had no `contacts` table because the portal has none. It needs one now, and multi-threading is exactly what the coach should be pushing on.

```sql
create table contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  name text, title text, email text, phone text, linkedin text,
  role_type text,      -- 'champion'|'blocker'|'economic_buyer'|'gatekeeper'|'unknown'
  is_primary boolean default false,
  created_at timestamptz default now()
);
```
Add `interactions.contact_id` (nullable FK). A single-threaded deal — one contact, no second name — becomes a first-class coach warning: *"Six months, one contact, no second name. If they leave, the deal dies. Get a second person this week."*

### 2.2 A day-one backlog of 73 overdue follow-ups
Every single `NEXT Contact Date` in the file is in the past. **Zero are future-dated.** The oldest is Helen Green Design, due October 2019 — 2,477 days late. Then a cluster of 468-day-old French studios (Joseph Dirand, Alberto Pinto, Jean-Louis Deniot, Patrick Jouin, Pierre Yovanovitch) all due 23 April 2025.

This is the ideal cold start: the coach opens on day one with a real, specific, uncomfortable backlog rather than an empty screen. Import each of these as an **overdue `commitments` row**, `party='us'`, `original_due_date` = the sheet's date. That is what the commitment ledger was built for.

### 2.3 57 free-text reports containing real qualification signals
The reports are in mixed French/English and carry exactly the disqualifiers a coach needs. Recurring patterns already visible:

- **No budget** — *"pas d'argent"*, *"ils font en interne et ont pas de thune"*
- **In-house capability** — *"Inhouse CGI Team"*, *"Renders inhouse, Sketchup"* (the single most common structural disqualifier in this list)
- **Price-anchored badly** — *"on a fait 1 rendu à bas prix"*
- **Gatekeeper blocked** — several, including one where the PA asked for images to be pulled from the site
- **Warm but unconverted** — *"ENORME appel"*, *"TRES bien passé"*, *"demande de lunch"* with no follow-through recorded

Run a **one-off LLM enrichment pass** over these 57 reports (reuse `sales-coach-debrief`'s extraction schema, `source='import'`) to produce structured `interactions` rows plus `qualification_note`. That is a legitimate, evidence-backed input to `sales-coach-qualify` v1 — not a win-rate model, but a real disqualifier checklist drawn from your own history.

---

## 3. Cleaned file

`leads-import-cleaned.csv` — 286 rows, one per contact, ready for the importer.

Normalisation applied:
- Section banners (`CURRENT`, `CONTACT NOW`, `DEAD`, `FASHION`, `YACHTS`, `HOTELS`) forward-filled into `stage` + `segment`, then dropped as rows. Mapping: CURRENT→`engaged` (1), CONTACT NOW→`contacted` (229), DEAD→`dead` (21), vertical-only→`new` (35). Segments: interior_design 251, hospitality 25, yachts 6, fashion 4.
- French dates (`12 juin 2018`) → ISO. 281 parsed cleanly.
- **Epoch artefacts rejected** — `11 avril 1901`, `19 septembre 1898` are Sheets serial-number corruption, not dates. Dropped, not imported.
- **Column-shift recovery** — 4 rows had an email sitting in the FIRST-contact-date column (Studio Indigo, Tollgard, Lawson Robb, CTM Design). Email recovered, row flagged.
- **`Reception` column split.** It mixes gatekeeper names (*Valeria*, *George*) with qualification notes (*Pas d'argent*, *Inhouse CGI Team*). Now `gatekeeper_reception` vs `qualification_note`.
- `company_key` (lowercased, alphanumeric) + `is_primary_contact` for deduping against the existing 272 `leads`.
- `dq_flags` column — **15 rows need a human eye**, including `UNREAL` and `ASAP` in date fields, `BASH`/`Whatsapp`/`Linkedin` in the email field, and VICKERS STUDIO with two emails in one cell.

---

## 4. Importer requirements

1. **Dry-run mode first.** Report matches, new records, and conflicts. Do not write on the first pass.
2. **Dedupe against existing `leads` on `company_key`**, then fuzzy-match on domain from `website`. Expect overlap with the current 272 — never blind-insert.
3. **Existing data wins on conflict.** The portal's 272 leads are more recent than a spreadsheet last touched in April 2026. Sheet values fill blanks only.
4. **Idempotent.** Add `leads.import_source` + `import_row_hash` so re-running changes nothing.
5. **Order:** `leads` → `contacts` → `interactions` (from reports) → `commitments` (from overdue next-actions) → `lead_events` with `source='import'`.
6. **Never mail an imported address without checking `suppressed_emails`.** Some of these are seven years stale; a bulk send to them is a deliverability incident waiting to happen.
7. Import the 21 `DEAD` companies with `stage='dead'`, `outcome='lost'`, `loss_reason_category='unknown'` where blank. Do not guess a reason to fill the column — an invented reason is worse than a null, because the coach will later treat it as evidence.

---

## 5. Revised answers to §9

| Question | Answer |
|---|---|
| 1. The spreadsheet | Received. 226 companies, 286 contacts. Contact list, not deal history. |
| 2. Historic losses with reasons | **No.** 21 dead companies, 4 with a reason. Phase 5 stays rules-based; revisit in ~2 quarters once debriefs have accumulated. |
| 3. Margin | Still open. Nothing in this file — `Expected Revenue` is empty and `Potential` has 3 values. Manual entry at qualification for now. |
| 4. Currency | The 3 `Potential` values are GBP. Assume GBP base, `useFx` at display. |
| 5. Second rep | Still open. |

---

## 6. Revised build order

Phase 4 moves earlier and shrinks — it is now an import, not an analytics unlock:

1. Schema (**+ `contacts` table**) + `sales-coach-debrief` + `DebriefSheet`
2. **Import** (dry-run → commit) — gives the coach a real pipeline and 73 overdue commitments on day one
3. `sales-coach-brief` + `PaceHeader` + `CommitmentAlert` + `DirectiveCard`
4. LLM enrichment pass over the 57 reports → structured interactions + disqualifier list
5. `LeadDossier`, commitment ledger UI, stall sweep
6. `sales-coach-qualify` (rules + imported disqualifiers, clearly labelled as heuristic) and `PipelineDiagnosis` — **real scoring deferred until the debrief data exists**
