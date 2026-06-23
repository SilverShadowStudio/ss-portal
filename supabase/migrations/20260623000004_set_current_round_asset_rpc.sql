-- Admin-only publish control. Sets exactly one round_asset as the client-visible
-- (is_current) version within its (scene_round_id, scene_token) group, flipping any
-- previously-published sibling false in the SAME atomic UPDATE. Reads the stored
-- scene_token column (20260623000003) -- no filename parsing here.
--
-- The single UPDATE is the invariant: it can only ever leave one row true per group.
-- Once the partial unique index ships with the edge-function rework, the DB enforces
-- the same guarantee structurally.

CREATE OR REPLACE FUNCTION public.set_current_round_asset(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr    uuid;
  v_token text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'set_current_round_asset: admin only';
  END IF;

  SELECT scene_round_id, scene_token
    INTO v_sr, v_token
  FROM public.round_assets
  WHERE id = p_asset_id;

  IF v_sr IS NULL THEN
    RAISE EXCEPTION 'set_current_round_asset: asset % not found', p_asset_id;
  END IF;

  UPDATE public.round_assets
  SET is_current = (id = p_asset_id)
  WHERE scene_round_id = v_sr
    AND scene_token = v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_round_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_current_round_asset(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_current_round_asset(uuid) TO authenticated;
