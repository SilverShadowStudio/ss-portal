-- Fix the publish-control grouping. The original set_current_round_asset
-- (20260623000004, live) flipped is_current within (scene_round_id, scene_token).
-- scene_token is parsed from the filename with a regex that requires a HYPHEN
-- between the project and scene codes; Fred's files use an UNDERSCORE
-- (e.g. CP115_SC02-VS_R01_04.jpg), so the regex falls through and scene_token
-- equals the FULL filename — making every version its own group. Publishing v01
-- then never un-published v04, leaving TWO is_current=true rows in one round.
--
-- A round corresponds to exactly one scene, so all of a round's versions belong
-- to a single publish group. Group on scene_round_id ALONE: the single UPDATE
-- sets is_current = (id = p_asset_id) across the whole round, so it can only
-- ever leave exactly one row true — the published one — and false everywhere
-- else, regardless of how scene_token parsed.
--
-- SECURITY DEFINER + admin gate unchanged. scene_token is left in place (it is
-- harmless and still populated); it is simply no longer used for grouping here.

CREATE OR REPLACE FUNCTION public.set_current_round_asset(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'set_current_round_asset: admin only';
  END IF;

  SELECT scene_round_id
    INTO v_sr
  FROM public.round_assets
  WHERE id = p_asset_id;

  IF v_sr IS NULL THEN
    RAISE EXCEPTION 'set_current_round_asset: asset % not found', p_asset_id;
  END IF;

  -- Whole-round publish group: exactly one row ends up is_current=true.
  UPDATE public.round_assets
  SET is_current = (id = p_asset_id)
  WHERE scene_round_id = v_sr;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_round_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_current_round_asset(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_current_round_asset(uuid) TO authenticated;
