-- Revolut Merchant payment links on invoices (replaces Stripe checkout).
-- Additive only: two nullable columns. The Revolut order id lets the merchant
-- webhook mark the invoice paid; the checkout url is the payment link surfaced
-- on the PDF ("PAY ONLINE") and in the client/admin invoice views.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS revolut_order_id text,
  ADD COLUMN IF NOT EXISTS revolut_checkout_url text;

COMMENT ON COLUMN public.invoices.revolut_order_id IS 'Revolut Merchant order id (from POST /api/orders); keyed on by revolut-merchant-webhook to mark paid.';
COMMENT ON COLUMN public.invoices.revolut_checkout_url IS 'Revolut hosted payment-link URL (checkout.revolut.com). Cached; surfaced on the invoice PDF and portal.';
