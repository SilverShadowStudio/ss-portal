-- 20260730000006_applied_migrations_ledger.sql
--
-- ADDITIVE. Portal-owned ledger of which migration files have actually been
-- applied to this database. The remote has no supabase_migrations.schema_
-- migrations table (schema was built via Lovable + dashboard), `db push` is
-- banned, and application is manual via the Management API — so nothing
-- records what ran. This table is that record, going forward.
--
-- Workflow (enforced by convention + scripts/apply-migration.sh):
--   every future apply inserts a row in the same transaction batch as the
--   migration SQL itself. Backfill of historical rows is best-effort from
--   prose notes in migration headers and HANDOFF.md, marked method='backfill'.

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  method      text NOT NULL DEFAULT 'management_api',  -- management_api | backfill | dashboard
  notes       text
);

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

-- Admin read-only from the app; writes happen via the Management API
-- (service context) during migration application.
CREATE POLICY "applied_migrations_admin_select"
  ON public.applied_migrations FOR SELECT
  USING (public.is_admin());

-- Record self.
INSERT INTO public.applied_migrations (filename, notes)
VALUES ('20260730000006_applied_migrations_ledger.sql', 'ledger created')
ON CONFLICT (filename) DO NOTHING;
