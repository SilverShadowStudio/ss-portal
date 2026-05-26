-- Manager-aware read gate: a member whose role is NOT 'client_invitee'.
-- Invitees ARE account members, so the existing is_account_member()-based
-- policies would expose finance/legal/order data to them. Swap those policies
-- to is_account_manager(). Owners (= Managers) still pass. Admin (is_admin)
-- policies and the pin/comment tables (asset_pins, asset_comments,
-- asset_pin_messages) are unchanged — invitees must read/write pins to review.
--
-- Must run AFTER 20260526000001 (this references the 'client_invitee' value).

CREATE OR REPLACE FUNCTION public.is_account_manager(_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
     WHERE user_id = auth.uid()
       AND account_id = _account_id
       AND role <> 'client_invitee'
  )
$$;

-- ALTER POLICY swaps only the USING expression (preserves cmd/roles; no window
-- where the policy is absent). Personal/project branches preserved; account-wide
-- member access narrowed to Managers.

ALTER POLICY "Members can view account agreements" ON public.agreements
  USING (
    (auth.uid() = user_id)
    OR ((account_id IS NOT NULL) AND public.is_account_manager(account_id))
  );

ALTER POLICY "Members can view account invoices" ON public.invoices
  USING (
    ((account_id IS NOT NULL) AND public.is_account_manager(account_id))
    OR (EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.id = invoices.project_id
                   AND public.is_account_manager(p.account_id)))
    OR (EXISTS (SELECT 1 FROM public.account_members am
                 WHERE am.user_id = invoices.user_id
                   AND public.is_account_manager(am.account_id)))
  );

ALTER POLICY "Members view account quotation_documents" ON public.quotation_documents
  USING (
    ((account_id IS NOT NULL) AND public.is_account_manager(account_id))
    OR (EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.id = quotation_documents.project_id
                   AND public.is_account_manager(p.account_id)))
  );

-- Orders: read + accept are both Manager-level (accepting an order is a billing
-- commitment). Closes the SELECT and the UPDATE (accept) bypass.
ALTER POLICY "clients_read_own_orders" ON public.orders
  USING (public.is_account_manager(account_id));

ALTER POLICY "clients_accept_own_orders" ON public.orders
  USING (public.is_account_manager(account_id) AND status = 'pending_acceptance');
