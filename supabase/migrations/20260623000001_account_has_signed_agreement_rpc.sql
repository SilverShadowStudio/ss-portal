-- account_has_signed_agreement — used by the route-level agreement gate
-- (src/lib/agreementStatus.ts) to answer "has this account signed?" for
-- any authenticated member, including client_invitees who otherwise
-- cannot read public.agreements rows under RLS.
--
-- SECURITY DEFINER bypasses RLS so the answer is reachable; the internal
-- is_account_member() check prevents probing arbitrary accounts. The
-- caller learns only a boolean — never row contents, signatory name,
-- signed_at, etc.
--
-- DUPLICATION — change together when bumping the agreement family:
--   - the agreement_version filter below
--   - SUPPORTED_AGREEMENT_VERSIONS in src/lib/agreements/index.ts
-- Mirrors the LOGO_URL pattern documented in CLAUDE.md.

CREATE OR REPLACE FUNCTION public.account_has_signed_agreement(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN NOT public.is_account_member(p_account_id) THEN false
      ELSE EXISTS (
        SELECT 1
        FROM public.agreements
        WHERE account_id = p_account_id
          AND agreement_version IN (
            'SSS-CA-PROJECT-v3.0',
            'SSS-CA-PARTNERSHIP-v3.0'
          )
      )
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.account_has_signed_agreement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_has_signed_agreement(uuid) TO authenticated;
