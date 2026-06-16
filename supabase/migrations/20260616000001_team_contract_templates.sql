-- ─── team_contract_templates ──────────────────────────────────────────────────
-- DB-backed templates for pre-populating engagement contract form fields.
-- Admin-only read/write. Soft-deleted via archived_at (preserves FK integrity
-- on any team_contracts row that referenced the template).
CREATE TABLE IF NOT EXISTS public.team_contract_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  default_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  archived_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_contract_templates_sort
  ON public.team_contract_templates(sort_order);

CREATE TRIGGER update_team_contract_templates_updated_at
  BEFORE UPDATE ON public.team_contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.team_contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all team contract templates"
  ON public.team_contract_templates
  FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- Seed three starter templates.
-- default_fields carries only the 8 template-applicable fields — all
-- per-person and per-contract fields (names, dates, fee_amount) are left
-- blank for admin to fill per engagement.
-- created_by is NULL for seeded rows (no auth user available at migration time).
INSERT INTO public.team_contract_templates (name, description, default_fields, sort_order) VALUES
(
  'Scene Manager',
  'Monthly retainer for scene management and production coordination.',
  '{
    "entity_type": "individual",
    "subject_line": "Scene Manager Engagement",
    "scope_description": "Scene management and production coordination for CGI visualisation projects, including overseeing production stages, coordinating with modellers and other freelancers, reviewing outputs, and ensuring delivery to agreed deadlines.",
    "fee_currency": "GBP",
    "fee_scope_description": "Per calendar month",
    "payment_milestone_1_pct": 0,
    "payment_milestone_2_pct": 0,
    "payment_milestone_3_pct": 100
  }'::jsonb,
  0
),
(
  'Modeller',
  'Per-scene per-round engagement for 3D modelling and visualisation.',
  '{
    "entity_type": "individual",
    "subject_line": "3D Modelling Engagement",
    "scope_description": "3D modelling and visualisation services for CGI architectural projects, producing high-quality models and renders to the agreed brief and incorporating feedback across production rounds to final approved delivery.",
    "fee_currency": "EUR",
    "fee_scope_description": "Per scene per round",
    "payment_milestone_1_pct": 10,
    "payment_milestone_2_pct": 40,
    "payment_milestone_3_pct": 50
  }'::jsonb,
  1
),
(
  'Photographer',
  'Day-rate engagement for architectural and interior photography.',
  '{
    "entity_type": "individual",
    "subject_line": "Photography Engagement",
    "scope_description": "Photography services for architectural and interior projects, capturing agreed deliverables to professional standard and providing edited finals within the agreed delivery window.",
    "fee_currency": "GBP",
    "fee_scope_description": "Per shoot day",
    "payment_milestone_1_pct": 50,
    "payment_milestone_2_pct": 0,
    "payment_milestone_3_pct": 50
  }'::jsonb,
  2
);

-- ─── team_contracts additions ─────────────────────────────────────────────────
ALTER TABLE public.team_contracts
  ADD COLUMN IF NOT EXISTS is_pre_signed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id    UUID
    REFERENCES public.team_contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_team_contracts_template_id
  ON public.team_contracts(template_id);
