-- Manual round creation for pre-paid clients.
--
-- Distinguishes rounds paid through the portal (Stripe) from rounds an admin
-- creates directly for clients who paid externally (invoice, bank transfer,
-- retainer). Adds scene_rounds.payment_method and restricts the client INSERT
-- path to the Stripe value so that only an admin can create 'manual' rounds.

-- 1) New column. NOT NULL DEFAULT 'stripe' backfills every existing row to
--    'stripe' in the same operation.
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe'
  CHECK (payment_method IN ('stripe', 'manual'));

-- 2) Strengthen the client INSERT policy so a non-admin can only create rounds
--    on the Stripe path. The booking flow omits payment_method (→ default
--    'stripe'), so it is unaffected. Only the existing admin policy
--    ("Admins can insert scene rounds" WITH CHECK is_admin()) can write
--    payment_method = 'manual'. The account-member ownership clause is preserved
--    verbatim from 20260424104042; the only addition is the payment_method gate.
DROP POLICY IF EXISTS "Members can insert account rounds" ON public.scene_rounds;
CREATE POLICY "Members can insert account rounds"
  ON public.scene_rounds FOR INSERT TO authenticated
  WITH CHECK (
    payment_method = 'stripe'
    AND EXISTS (
      SELECT 1 FROM public.scenes s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = scene_rounds.scene_id AND public.is_account_member(p.account_id)
    )
  );

-- ── Rollback (manual; this repo applies migrations forward-only) ─────────────
-- DROP POLICY IF EXISTS "Members can insert account rounds" ON public.scene_rounds;
-- CREATE POLICY "Members can insert account rounds"
--   ON public.scene_rounds FOR INSERT TO authenticated
--   WITH CHECK (EXISTS (
--     SELECT 1 FROM public.scenes s
--     JOIN public.projects p ON p.id = s.project_id
--     WHERE s.id = scene_rounds.scene_id AND public.is_account_member(p.account_id)
--   ));
-- ALTER TABLE public.scene_rounds DROP COLUMN IF EXISTS payment_method;
