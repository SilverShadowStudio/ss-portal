-- Overhead Drop Zone — Full gross capture for mixed-VAT invoices
--
-- Adds 'mixed' to the allowed vat_treatment values for public.overheads and
-- to public.expense_categories.default_vat_treatment. Enables recording of
-- mixed-VAT invoices (e.g. food-delivery receipts where the food is
-- zero-rated but a service fee is standard-rated) with the FULL gross
-- captured as spend and only the real VAT claimable.
--
-- The form's auto-compute effect skips 'mixed' treatment — the user (or
-- the extractor) provides vat_amount manually. Existing rows unaffected.

ALTER TABLE public.overheads
  DROP CONSTRAINT IF EXISTS overheads_vat_treatment_check;
ALTER TABLE public.overheads
  ADD CONSTRAINT overheads_vat_treatment_check
    CHECK (vat_treatment = ANY (ARRAY[
      'standard'::text,
      'reduced'::text,
      'zero'::text,
      'exempt'::text,
      'none'::text,
      'reverse_charge'::text,
      'mixed'::text
    ]));

ALTER TABLE public.expense_categories
  DROP CONSTRAINT IF EXISTS expense_categories_default_vat_treatment_check;
ALTER TABLE public.expense_categories
  ADD CONSTRAINT expense_categories_default_vat_treatment_check
    CHECK (default_vat_treatment = ANY (ARRAY[
      'standard'::text,
      'reduced'::text,
      'zero'::text,
      'exempt'::text,
      'none'::text,
      'reverse_charge'::text,
      'mixed'::text
    ]));
