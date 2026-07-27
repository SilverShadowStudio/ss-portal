-- Invoice Dropbox filing: track filed state + auto-file issued invoices.
-- Mirrors the overhead filing trigger (20260720000002_overhead_dropbox_filing.sql),
-- but simpler — no lock columns/log (invoices are low-volume, admin-driven).
--
-- Applied via the Management API query endpoint on 27 Jul 2026 (NOT db push —
-- the remote has no schema_migrations table; see CLAUDE.md / memory).
--
-- Edge function to (re)deploy after applying:
--   npx supabase functions deploy dropbox-save-invoice-file \
--     --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

-- 1. Track filed state (NULL = not yet filed; also the trigger guard).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS dropbox_path TEXT;

COMMENT ON COLUMN public.invoices.dropbox_path IS
  'Dropbox path of the filed invoice PDF (INV001_Receivable). NULL = not yet filed.';

-- 2. Trigger function — POST to dropbox-save-invoice-file. Reuses the shared
--    public.internal_dropbox_trigger_headers() helper.
CREATE OR REPLACE FUNCTION public.trg_dropbox_invoice_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     => 'https://oodhsoiwnqxcimzmzick.supabase.co/functions/v1/dropbox-save-invoice-file',
    headers => public.internal_dropbox_trigger_headers('invoice_filing_pending'),
    body    => jsonb_build_object(
      'type',       TG_OP,
      'table',      TG_TABLE_NAME,
      'schema',     TG_TABLE_SCHEMA,
      'record',     to_jsonb(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL::jsonb END,
      'trigger_source', 'trigger'
    )
  );
  RETURN NEW;
END;
$$;

-- 3. Fire when an invoice is issued (sent/paid) and not yet filed.
DROP TRIGGER IF EXISTS invoices_dropbox_pending ON public.invoices;
CREATE TRIGGER invoices_dropbox_pending
  AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (
    NEW.status IN ('sent', 'paid')
    AND NEW.dropbox_path IS NULL
  )
  EXECUTE FUNCTION public.trg_dropbox_invoice_pending();
