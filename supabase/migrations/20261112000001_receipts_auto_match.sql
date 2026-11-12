-- Receipts match themselves to the bank (Fred, 12 Nov 2026).
--
-- A supplier invoice or receipt dropped in the Dropzone lands in the Ledger
-- (overheads, with its Dropbox file in dropbox_path). Until now nothing tied it
-- to the Revolut line that paid it — that only happened when someone pressed
-- Scan on the Receipts page. Now it happens on its own, both ways round:
--
--   • a receipt is filed  → look for the bank line that paid it;
--   • new bank lines land → look for receipts still waiting for theirs.
--
-- The rule is the Receipts page's own (reconcile-receipts, step 4b): same
-- amount to the penny (exactly — £12.48 never meets £12.49), within 21 days — compared in the receipt's currency
-- (a $167 Softr receipt meets the line whose original amount is $167). The
-- closest date wins; two equally close lines are left alone rather than
-- guessed. A To Pay payment's own Revolut id is an exact match and wins
-- outright.
--
-- On a match: the bank line carries the receipt (receipt_dropbox_path) and the
-- Ledger link (matched_type/matched_id), and an expense still marked unpaid
-- becomes paid on the bank's date — a card receipt was never "to pay".
--
-- Purely additive: two functions, two triggers. They act on filings from now
-- on (a receipt reaching Dropbox, or a Fixed Cost row being handed one); the
-- older Ledger rows are a separate, explicit run.

CREATE OR REPLACE FUNCTION public._link_receipt_to_bank(p_overhead uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o public.overheads%ROWTYPE;
  v_day date;
  v_bid text;
  v_date date;
  v_gap int;
  v_ties int;
BEGIN
  SELECT * INTO o FROM public.overheads WHERE id = p_overhead;
  IF NOT FOUND OR o.dropbox_path IS NULL OR coalesce(o.gross_amount, 0) <= 0 THEN RETURN NULL; END IF;

  -- Already carried by a bank line? Nothing to do.
  IF EXISTS (SELECT 1 FROM public.bank_transactions
              WHERE receipt_dropbox_path = o.dropbox_path
                 OR (matched_type = 'overhead' AND matched_id = o.id)) THEN
    RETURN NULL;
  END IF;

  -- Paid from To Pay: the payment's own Revolut id.
  IF o.revolut_transaction_id IS NOT NULL THEN
    SELECT id, date_completed INTO v_bid, v_date FROM public.bank_transactions
     WHERE id = o.revolut_transaction_id AND receipt_dropbox_path IS NULL;
  END IF;

  IF v_bid IS NULL THEN
    v_day := coalesce(o.payment_date, o.invoice_date);
    IF v_day IS NULL THEN RETURN NULL; END IF;

    WITH c AS (
      SELECT t.id, t.date_completed, abs(t.date_completed - v_day) AS gap
        FROM public.bank_transactions t
       WHERE t.classification = 'expense'
         AND t.amount < 0
         AND t.receipt_dropbox_path IS NULL
         AND t.matched_id IS NULL
         AND t.date_completed IS NOT NULL
         AND abs(t.date_completed - v_day) <= 21
         AND abs(
               CASE WHEN upper(coalesce(o.currency, 'GBP')) = 'GBP' THEN abs(t.amount)
                    WHEN upper(t.orig_currency) = upper(o.currency) THEN abs(t.orig_amount)
               END - o.gross_amount) < 0.005
    )
    SELECT id, date_completed, gap INTO v_bid, v_date, v_gap FROM c ORDER BY gap, id LIMIT 1;
    IF v_bid IS NULL THEN RETURN NULL; END IF;

    WITH c AS (
      SELECT t.id FROM public.bank_transactions t
       WHERE t.classification = 'expense' AND t.amount < 0
         AND t.receipt_dropbox_path IS NULL AND t.matched_id IS NULL
         AND t.date_completed IS NOT NULL
         AND abs(t.date_completed - v_day) = v_gap
         AND abs(
               CASE WHEN upper(coalesce(o.currency, 'GBP')) = 'GBP' THEN abs(t.amount)
                    WHEN upper(t.orig_currency) = upper(o.currency) THEN abs(t.orig_amount)
               END - o.gross_amount) < 0.005
    )
    SELECT count(*) INTO v_ties FROM c;
    IF v_ties > 1 THEN RETURN NULL; END IF;  -- two equally good lines: don't guess
  END IF;

  IF v_bid IS NULL THEN RETURN NULL; END IF;

  UPDATE public.bank_transactions
     SET receipt_dropbox_path = o.dropbox_path,
         matched_type = coalesce(matched_type, 'overhead'),
         match_confidence = CASE WHEN matched_id IS NULL THEN 'receipt' ELSE match_confidence END,
         matched_id = coalesce(matched_id, o.id),
         status = 'matched',
         updated_at = now()
   WHERE id = v_bid;

  UPDATE public.overheads
     SET payment_status = 'paid', payment_date = coalesce(v_date, payment_date), updated_at = now()
   WHERE id = o.id
     AND coalesce(payment_status, 'unpaid') <> 'paid'
     AND NOT coalesce(payment_in_progress, false);

  -- The Receipts page's catalogue, when it already knows the file.
  UPDATE public.dropbox_invoice_files
     SET matched_txn_id = v_bid, status = 'matched', match_confidence = 'receipt', updated_at = now()
   WHERE path = o.dropbox_path AND status <> 'ignored';

  RETURN v_bid;
END;
$$;

-- Every receipt (filed or touched since p_since) still waiting for its bank line,
-- oldest first so each takes the line closest to it before a later one can.
CREATE OR REPLACE FUNCTION public._match_pending_receipts(p_since timestamptz DEFAULT '2026-11-12')
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT o.id FROM public.overheads o
     WHERE o.dropbox_path IS NOT NULL AND coalesce(o.gross_amount, 0) > 0
       AND o.updated_at >= p_since
       AND NOT EXISTS (SELECT 1 FROM public.bank_transactions b
                        WHERE b.receipt_dropbox_path = o.dropbox_path
                           OR (b.matched_type = 'overhead' AND b.matched_id = o.id))
     ORDER BY coalesce(o.payment_date, o.invoice_date), o.created_at
  LOOP
    IF public._link_receipt_to_bank(r.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public._link_receipt_to_bank(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._match_pending_receipts(timestamptz) FROM PUBLIC, anon, authenticated;

-- A matching hiccup must never stop an expense or a bank import from saving.
CREATE OR REPLACE FUNCTION public.trg_receipt_filed_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public._link_receipt_to_bank(NEW.id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'receipt auto-match failed for overhead %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_bank_lines_match_receipts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public._match_pending_receipts();
  EXCEPTION WHEN others THEN
    RAISE WARNING 'receipt auto-match after bank import failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_receipt_filed_match() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bank_lines_match_receipts() FROM PUBLIC, anon, authenticated;

-- The receipt reaches Dropbox a moment after the row lands (dropbox_path is
-- written by the filing trigger), so this watches that column.
DROP TRIGGER IF EXISTS overheads_receipt_match ON public.overheads;
CREATE TRIGGER overheads_receipt_match
  AFTER INSERT OR UPDATE OF dropbox_path ON public.overheads
  FOR EACH ROW
  WHEN (NEW.dropbox_path IS NOT NULL)
  EXECUTE FUNCTION public.trg_receipt_filed_match();

-- Once per import (the daily Revolut sync, or a CSV on the Bank page).
DROP TRIGGER IF EXISTS bank_transactions_receipt_match ON public.bank_transactions;
CREATE TRIGGER bank_transactions_receipt_match
  AFTER INSERT ON public.bank_transactions
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_bank_lines_match_receipts();
