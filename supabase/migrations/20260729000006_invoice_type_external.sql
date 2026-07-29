-- Allow 'external' (income invoices uploaded from Xero etc.) alongside the
-- portal-raised types. Keeps the guard, just widens the allowed set.
CREATE OR REPLACE FUNCTION public.validate_invoice_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.type NOT IN ('deposit', 'balance', 'standalone', 'external') THEN
    RAISE EXCEPTION 'Invalid invoice type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$$;
