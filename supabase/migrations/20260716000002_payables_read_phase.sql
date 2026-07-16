-- =====================================================================
-- Payables Read Phase — Kieran's Airtable → portal mirror (read-only)
--
-- Delivered as a migration FILE per hard rule. Do NOT run `supabase db push`.
-- Apply via Supabase Dashboard → SQL editor. Idempotent (safe to re-run).
--
-- Read-only from Airtable. The portal NEVER writes back. Sync is one-way:
-- Pass 2 adds the edge function + pg_cron (15-min cadence). Pass 3 wires
-- the P&L "Payables" tile + manual refresh button + AdminAlertBanner.
--
-- Design notes:
--   * airtable_record_id is the primary key. Airtable record IDs are
--     globally unique across the base, so no source_table qualification
--     is needed for uniqueness.
--   * amount_paid + balance_remaining are NULL for the two Partner Studios
--     tables (binary Paid?, no partial-payment fields). The three
--     freelancer tables (Modeller / Scene Manager / Photographer) populate
--     both.
--   * OUTSTANDING math in the UI (Pass 3) is:
--       COALESCE(balance_remaining,
--                CASE WHEN paid_status = 'paid' THEN 0
--                     ELSE invoice_total END)
--     Never invoice_total for a partially-paid freelancer — that would
--     overstate what is owed.
--   * vat_registered defaults FALSE. Payables are excluded from
--     computeQuarterVat by design; this column exists so a UK
--     VAT-registered freelancer / partner studio can later be handled
--     without a rebuild. It is NEVER summed into cash-basis input VAT.
--   * period_date for Partner Studios Contract carries Date Created (the
--     table has no month/year fields). The UI (Pass 3) surfaces this as
--     an approximation ("≈ created" marker) so it isn't read as a real
--     invoice date.
--   * Seed of app_settings.airtable_payables_field_config runs last;
--     app_settings has pre-existing RLS and the SQL editor bypasses it
--     as postgres. ON CONFLICT DO NOTHING preserves any admin-UI edits.
-- =====================================================================


-- 1. payables_snapshot ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payables_snapshot (
  airtable_record_id      text          PRIMARY KEY,
  source_table            text          NOT NULL
    CHECK (source_table IN (
      'modeller_invoices',
      'scene_manager_invoice',
      'photographer_invoice',
      'partner_studios_monthly',
      'partner_studios_contract'
    )),
  payee_airtable_user_id  text,
  payee_name              text,
  payee_email             text,
  invoice_total           numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid             numeric(12,2),
  balance_remaining       numeric(12,2),
  period_date             date,
  period_year             int,
  period_month            int,
  paid_status             text          NOT NULL DEFAULT 'unknown'
    CHECK (paid_status IN ('paid','unpaid','partial','unknown')),
  payment_stage           text,
  invoice_number          text,
  vat_registered          boolean       NOT NULL DEFAULT false,
  raw                     jsonb         NOT NULL,
  synced_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payables_snapshot IS
  'Read-only mirror of Kieran''s five Airtable payables tables. Keyed on the Airtable record ID; the portal never writes back to Airtable.';
COMMENT ON COLUMN public.payables_snapshot.amount_paid IS
  'Populated for the three freelancer tables (Modeller / Scene Manager / Photographer). NULL for the two Partner Studios tables — they only carry a binary Paid?.';
COMMENT ON COLUMN public.payables_snapshot.balance_remaining IS
  'Populated for the three freelancer tables. NULL for Partner Studios. Outstanding math (Pass 3): COALESCE(balance_remaining, CASE WHEN paid_status=''paid'' THEN 0 ELSE invoice_total END). Never invoice_total for a partially-paid freelancer.';
COMMENT ON COLUMN public.payables_snapshot.period_date IS
  'For Partner Studios Contract this carries Date Created (the table has no month/year fields). Pass 3 surfaces this as an approximation ("≈ created" marker).';
COMMENT ON COLUMN public.payables_snapshot.vat_registered IS
  'Default false. Set true when a payee is UK VAT-registered so future logic can treat their VAT correctly. Never summed into cash-basis input VAT — payables are excluded from computeQuarterVat by design.';
COMMENT ON COLUMN public.payables_snapshot.raw IS
  'Full Airtable field payload for the record (fields keyed by field ID via returnFieldsByFieldId=true). Debugging aid; not queried by the UI.';


-- 2. payables_sync_log ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payables_sync_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        timestamptz  NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  ok                boolean,
  records_upserted  int,
  records_deleted   int,
  errors            jsonb,
  alerts_raised     int          NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.payables_sync_log IS
  'Append-only log of payables-sync cycles. Retention: no automatic prune in this phase; add if row count becomes a problem.';


-- 3. admin_alerts --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text         NOT NULL,
  source       text         NOT NULL,
  detail       jsonb        NOT NULL,
  raised_at    timestamptz  NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid         REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.admin_alerts IS
  'Generic admin-alert surface. First callers: payables schema-drift + sync-failure. Extensible to other Airtable / Dropbox / Stripe drift signals.';


-- 4. Indices -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payables_snapshot_period_idx
  ON public.payables_snapshot (source_table, period_year, period_month);
CREATE INDEX IF NOT EXISTS payables_snapshot_paid_status_idx
  ON public.payables_snapshot (paid_status);
CREATE INDEX IF NOT EXISTS payables_snapshot_payee_idx
  ON public.payables_snapshot (payee_airtable_user_id);

CREATE INDEX IF NOT EXISTS payables_sync_log_started_idx
  ON public.payables_sync_log (started_at DESC);

-- Prevents raising the same drift alert repeatedly across sync cycles.
-- Keys on the specific field_id inside detail so different missing fields
-- raise separate rows. Once resolved (resolved_at IS NOT NULL) the guard
-- lifts and a new sync can raise a fresh alert.
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_unresolved_unique_idx
  ON public.admin_alerts (kind, source, (detail->>'field_id'))
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_alerts_unresolved_idx
  ON public.admin_alerts (source, kind)
  WHERE resolved_at IS NULL;


-- 5. updated_at trigger --------------------------------------------------
DROP TRIGGER IF EXISTS payables_snapshot_set_updated_at ON public.payables_snapshot;
CREATE TRIGGER payables_snapshot_set_updated_at
  BEFORE UPDATE ON public.payables_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 6. RLS (admin-only) ----------------------------------------------------
ALTER TABLE public.payables_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_alerts      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payables_snapshot_admin_select ON public.payables_snapshot;
DROP POLICY IF EXISTS payables_snapshot_admin_insert ON public.payables_snapshot;
DROP POLICY IF EXISTS payables_snapshot_admin_update ON public.payables_snapshot;
DROP POLICY IF EXISTS payables_snapshot_admin_delete ON public.payables_snapshot;

CREATE POLICY payables_snapshot_admin_select ON public.payables_snapshot
  FOR SELECT USING (public.is_admin());
CREATE POLICY payables_snapshot_admin_insert ON public.payables_snapshot
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY payables_snapshot_admin_update ON public.payables_snapshot
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY payables_snapshot_admin_delete ON public.payables_snapshot
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS payables_sync_log_admin_select ON public.payables_sync_log;
DROP POLICY IF EXISTS payables_sync_log_admin_insert ON public.payables_sync_log;
DROP POLICY IF EXISTS payables_sync_log_admin_update ON public.payables_sync_log;
DROP POLICY IF EXISTS payables_sync_log_admin_delete ON public.payables_sync_log;

CREATE POLICY payables_sync_log_admin_select ON public.payables_sync_log
  FOR SELECT USING (public.is_admin());
CREATE POLICY payables_sync_log_admin_insert ON public.payables_sync_log
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY payables_sync_log_admin_update ON public.payables_sync_log
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY payables_sync_log_admin_delete ON public.payables_sync_log
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS admin_alerts_admin_select ON public.admin_alerts;
DROP POLICY IF EXISTS admin_alerts_admin_insert ON public.admin_alerts;
DROP POLICY IF EXISTS admin_alerts_admin_update ON public.admin_alerts;
DROP POLICY IF EXISTS admin_alerts_admin_delete ON public.admin_alerts;

CREATE POLICY admin_alerts_admin_select ON public.admin_alerts
  FOR SELECT USING (public.is_admin());
CREATE POLICY admin_alerts_admin_insert ON public.admin_alerts
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY admin_alerts_admin_update ON public.admin_alerts
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_alerts_admin_delete ON public.admin_alerts
  FOR DELETE USING (public.is_admin());


-- 7. Seed app_settings.airtable_payables_field_config --------------------
-- Field IDs (fldXXX) captured live from the Airtable Metadata API on
-- 2026-07-16. IDs are stable across Kieran renaming a column; the sync
-- function (Pass 2) uses returnFieldsByFieldId=true, so name drift is
-- invisible to the portal. Column DELETES are caught by the schema-guard
-- and land as admin_alerts rows.
--
-- ON CONFLICT DO NOTHING preserves any prior admin-UI edit to this key.
INSERT INTO public.app_settings (key, value) VALUES (
  'airtable_payables_field_config',
  $config$
  {
    "base_id": "appyidJqOmdNB8WUd",
    "sources": {
      "modeller_invoices": {
        "table_id": "tbl6WfMgznJYgevRt",
        "fields": {
          "payee":          "fldrMDZWXFrabuAiQ",
          "payee_name":     "fld9QbhHXoTJJaVVG",
          "payee_email":    "fldGBoUiFFIgl5SCG",
          "invoice_total":  "fldzjmh3ozKd07Wf8",
          "period_date":    "fld92FqdxsoIwKOua",
          "period_year":    "flddZ2NxkfidEcJ3c",
          "period_month":   "fldSLpZPuxlertagZ",
          "paid_status":    "fldrDa9dzkBfakN2V",
          "amount_paid":    "fldgcIR61IPSAMydd",
          "balance":        "fld8KuEOa1Nawt9Yr"
        }
      },
      "scene_manager_invoice": {
        "table_id": "tblhYCC3InxUJUK3H",
        "fields": {
          "payee":          "fldFEKNdFphTptYlz",
          "payee_name":     "fldAKKCt9nyUUOobZ",
          "payee_email":    "fldZo6oX5cDxAQfwy",
          "invoice_total":  "fldOGozVRp10h7FK1",
          "period_date":    "fldV49QlTVOIafdsI",
          "period_year":    "fldgDqLbnzIE0kpou",
          "period_month":   "fldIu37GKY6wSmQuM",
          "paid_status":    "fldQDHiDgLLu7rC3M",
          "amount_paid":    "fldzw5jguRXA6cLr7",
          "balance":        "fldk9tl6PFsm09Yai"
        }
      },
      "photographer_invoice": {
        "table_id": "tblCoQXYZuUCh0Vgc",
        "fields": {
          "payee":          "fld04Y88WwEBXz9y4",
          "payee_name":     "fldVaYXoquVCsUzou",
          "payee_email":    "fldkOkJSmj0f8WqJ3",
          "invoice_total":  "fld96CUQ8woIPdQXw",
          "period_formula": "fldgunbga2bqIloFd",
          "paid_status":    "fld2bWNIYOB9SZeos",
          "amount_paid":    "fldXhtsAFgURpmzru",
          "balance":        "fldcVoO0eMOYTuOLY"
        }
      },
      "partner_studios_monthly": {
        "table_id": "tbl4fdObC6NYOUINx",
        "fields": {
          "payee":          "fldsVlZlz8xXutW5p",
          "payee_name":     "fldn1lOB36OYZOmVP",
          "payee_email":    "fldMFHA5ZVTBFQdgo",
          "invoice_total":  "fldw5Wp9HZn6fZf4c",
          "period_year":    "fld3U1XjhiYI5kn8k",
          "period_month":   "fldvLEjOEHmAXmOeC",
          "paid_status":    "fldDUiuLau1ycrANC"
        }
      },
      "partner_studios_contract": {
        "table_id": "tblBUVWHpphKDiEKS",
        "fields": {
          "payee":          "fldhH68UszvPd4oUp",
          "project":        "fldLQ4LLmPkCSiN32",
          "invoice_total":  "fldDck3bMUHlA1K0N",
          "date_created":   "fldAPVSCe1dfkYqxl",
          "paid_status":    "fldCsaS6iSrTNcpMQ",
          "payment_stage":  "fldBwHV7N08agilGw",
          "invoice_number": "fldCgJ2hpKIBFqUU1"
        }
      }
    }
  }
  $config$::jsonb
)
ON CONFLICT (key) DO NOTHING;
