-- A salary payment can never take a month past its net (Fred, 16 Nov 2026:
-- £1,500 was part-paid against a £1,047 month and silently settled it).
-- The To Pay form refuses it first; this makes it true whatever the caller.
-- Additive: one function, one trigger; it checks new payments only.
CREATE OR REPLACE FUNCTION public.trg_salary_payment_no_overpay()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_net numeric; v_paid numeric;
BEGIN
  SELECT net INTO v_net FROM public.payslips WHERE id = NEW.payslip_id;
  IF v_net IS NULL OR v_net <= 0 THEN RETURN NEW; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.salary_payments
   WHERE payslip_id = NEW.payslip_id AND id IS DISTINCT FROM NEW.id;
  IF v_paid + NEW.amount > v_net + 0.005 THEN
    RAISE EXCEPTION 'Payment of £% is more than the £% left to pay on this month.',
      to_char(NEW.amount, 'FM999,999,990.00'), to_char(greatest(v_net - v_paid, 0), 'FM999,999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salary_payments_no_overpay ON public.salary_payments;
CREATE TRIGGER salary_payments_no_overpay
  BEFORE INSERT OR UPDATE OF amount, payslip_id ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_salary_payment_no_overpay();
