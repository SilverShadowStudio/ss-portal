-- Orders table: replaces quotations as the client-facing order confirmation flow.
-- Admin creates an order (scope + price). Client sees it in their portal and
-- confirms with one click. That click is the binding commitment under the
-- Client Agreement signed at registration.

CREATE TABLE IF NOT EXISTS public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES auth.users(id),

  -- Reference shown to the client (e.g. ORD-2026-001)
  order_number      TEXT,

  -- Human-readable title shown in the portal (e.g. "45 Charles Street — 11 CGI Stills")
  title             TEXT NOT NULL,

  -- 'subscription' | 'project'
  order_type        TEXT NOT NULL DEFAULT 'project'
    CHECK (order_type IN ('subscription', 'project')),

  -- 'pending_acceptance' | 'accepted' | 'in_production' | 'completed' | 'cancelled'
  status            TEXT NOT NULL DEFAULT 'pending_acceptance'
    CHECK (status IN ('pending_acceptance', 'accepted', 'in_production', 'completed', 'cancelled')),

  -- Line items: [{description, quantity, unit_price, unit?}]
  lines             JSONB NOT NULL DEFAULT '[]',

  -- Financials (stored in the currency unit, not pence)
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate          NUMERIC(5,2)  NOT NULL DEFAULT 20,
  vat_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'GBP',

  -- Optional notes shown to client under the line items
  notes             TEXT,

  -- Linked invoice generated on acceptance
  invoice_id        UUID REFERENCES public.invoices(id),

  -- Timestamps
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Clients can see their own orders
CREATE POLICY "clients_read_own_orders"
  ON public.orders FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM public.account_members
      WHERE user_id = auth.uid()
    )
  );

-- Clients can update status on their own pending orders (acceptance only)
CREATE POLICY "clients_accept_own_orders"
  ON public.orders FOR UPDATE
  USING (
    account_id IN (
      SELECT account_id FROM public.account_members
      WHERE user_id = auth.uid()
    )
    AND status = 'pending_acceptance'
  )
  WITH CHECK (status = 'accepted');

-- Admins have full access
CREATE POLICY "admins_full_orders"
  ON public.orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_account_id ON public.orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
