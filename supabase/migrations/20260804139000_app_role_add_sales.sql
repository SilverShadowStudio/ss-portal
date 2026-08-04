-- Sales roles — added to the app_role enum in their OWN migration.
-- Postgres forbids using a value added by ALTER TYPE ... ADD VALUE within the
-- same transaction that adds it, so these must commit before the sales_director
-- migration references them (in policies / functions). Idempotent.
alter type public.app_role add value if not exists 'sales';
alter type public.app_role add value if not exists 'sales_manager';
