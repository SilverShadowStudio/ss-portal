-- Booking-level payment tracking. One Stripe session per booking_group_id.
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_group_id UUID NOT NULL UNIQUE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  payment_option TEXT NOT NULL CHECK (payment_option IN ('deposit_50', 'full_100_discount_3')),
  subtotal_gbp NUMERIC(10,2) NOT NULL,
  vat_gbp NUMERIC(10,2) NOT NULL,
  discount_gbp NUMERIC(10,2) DEFAULT 0,
  total_gbp NUMERIC(10,2) NOT NULL,
  amount_charged_gbp NUMERIC(10,2) NOT NULL,
  amount_outstanding_gbp NUMERIC(10,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  receipt_pdf_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking_group ON public.booking_payments(booking_group_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_account ON public.booking_payments(account_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_status ON public.booking_payments(status);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all booking payments" ON public.booking_payments;
CREATE POLICY "Admins manage all booking payments" ON public.booking_payments
  FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Account managers view their booking payments" ON public.booking_payments;
CREATE POLICY "Account managers view their booking payments" ON public.booking_payments
  FOR SELECT TO public
  USING ((account_id IS NOT NULL) AND public.is_account_manager(account_id));

-- Private bucket for booking receipts. Access is service-role-only: the webhook
-- uploads, and downloads go through short-lived signed URLs minted by the
-- booking-receipt-url edge function (gated on is_admin OR is_account_manager).
INSERT INTO storage.buckets (id, name, public)
VALUES ('booking-receipts', 'booking-receipts', false)
ON CONFLICT (id) DO NOTHING;
