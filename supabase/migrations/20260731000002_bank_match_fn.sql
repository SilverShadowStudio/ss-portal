-- 20260731000002_bank_match_fn.sql
--
-- ADDITIVE. Reference-based matching for the reconciliation engine, in one
-- deterministic place. Links bank transactions to the portal's accounting
-- records by normalised reference (uppercase, alphanumerics only):
--   client_income → invoices.invoice_number
--   expense       → overheads.invoice_number
-- Only ever fills an empty match (never overwrites a confirmed one). Admin-only.
-- Called after each CSV import (and later, each API sync).

CREATE OR REPLACE FUNCTION public.match_bank_transactions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inc int; ovh int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.bank_transactions b
     SET matched_type='income_invoice', matched_id=i.id,
         match_confidence='reference', status='matched', updated_at=now()
    FROM public.invoices i
   WHERE b.matched_id IS NULL
     AND b.classification='client_income'
     AND regexp_replace(upper(coalesce(b.reference,'')),'[^A-Z0-9]','','g')
       = regexp_replace(upper(coalesce(i.invoice_number,'')),'[^A-Z0-9]','','g')
     AND regexp_replace(upper(coalesce(b.reference,'')),'[^A-Z0-9]','','g') <> '';
  GET DIAGNOSTICS inc = ROW_COUNT;

  UPDATE public.bank_transactions b
     SET matched_type='overhead', matched_id=o.id,
         match_confidence='reference', status='matched', updated_at=now()
    FROM public.overheads o
   WHERE b.matched_id IS NULL
     AND b.classification='expense'
     AND regexp_replace(upper(coalesce(b.reference,'')),'[^A-Z0-9]','','g')
       = regexp_replace(upper(coalesce(o.invoice_number,'')),'[^A-Z0-9]','','g')
     AND regexp_replace(upper(coalesce(b.reference,'')),'[^A-Z0-9]','','g') <> '';
  GET DIAGNOSTICS ovh = ROW_COUNT;

  RETURN jsonb_build_object('income_matched', inc, 'overhead_matched', ovh);
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_bank_transactions() TO authenticated;
