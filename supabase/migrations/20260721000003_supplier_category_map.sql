-- Overhead Drop Zone — Supplier→category memory
--
-- Small mapping table: once Fred assigns a category to a supplier, future
-- extractions from the same supplier auto-fill the category (still
-- user-overridable in the review form).
--
-- Matching key is the NORMALIZED supplier name (lowercased, common
-- corporate suffixes stripped, non-alphanumeric collapsed to spaces).
-- Normalization happens client-side in src/lib/supplierNormalize.ts;
-- this table stores the pre-normalized string as the PK so the map is
-- stable across invoice-format quirks ("Roofoods Ltd" and "Roofoods"
-- collapse to the same key).
--
-- Admin-only RLS; writes only via supabase-js from the OverheadForm save
-- path; reads only from the OverheadUploadFlow extraction path.

CREATE TABLE IF NOT EXISTS public.supplier_category_map (
  supplier_normalized TEXT PRIMARY KEY,
  category_code       TEXT NOT NULL REFERENCES public.expense_categories(code),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID
);

COMMENT ON TABLE public.supplier_category_map IS
  'Persistent supplier→category memory for the overhead drop zone. Written '
  'on save in OverheadForm; read by OverheadUploadFlow to pre-fill category '
  'on extraction. Matching by normalized supplier name.';

ALTER TABLE public.supplier_category_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_category_map_admin_select ON public.supplier_category_map;
DROP POLICY IF EXISTS supplier_category_map_admin_insert ON public.supplier_category_map;
DROP POLICY IF EXISTS supplier_category_map_admin_update ON public.supplier_category_map;
DROP POLICY IF EXISTS supplier_category_map_admin_delete ON public.supplier_category_map;

CREATE POLICY supplier_category_map_admin_select ON public.supplier_category_map
  FOR SELECT USING (public.is_admin());
CREATE POLICY supplier_category_map_admin_insert ON public.supplier_category_map
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY supplier_category_map_admin_update ON public.supplier_category_map
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY supplier_category_map_admin_delete ON public.supplier_category_map
  FOR DELETE USING (public.is_admin());
