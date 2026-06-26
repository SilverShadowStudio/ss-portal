-- Multi-select published versions. is_current changes meaning from a single
-- exclusive "the published version" flag to a per-asset "show this version to
-- the client" toggle: MULTIPLE versions in a publish group can be is_current
-- =true at once, and the client sees every shown version as a switchable tab.
--
-- The old set_current_round_asset RPC was SET-EXCLUSIVE — it cleared every other
-- version in the (scene_round_id, scene_token) group, which is wrong for a
-- multi-select model. This adds a TOGGLE that flips exactly one asset's
-- is_current on or off and NEVER touches its siblings. scene_token grouping is
-- untouched (sub-scenes stay distinct); this function doesn't reference it.
--
-- set_current_round_asset is intentionally left in place (no caller after the UI
-- switches to this toggle) so nothing breaks if it is still referenced anywhere.
--
-- SECURITY DEFINER + admin gate preserved.

CREATE OR REPLACE FUNCTION public.toggle_round_asset_visible(
  p_asset_id uuid,
  p_visible  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'toggle_round_asset_visible: admin only';
  END IF;

  -- Flip exactly this one asset. No sibling rows are read or written, so any
  -- number of versions in the round / sub-scene can be shown simultaneously.
  UPDATE public.round_assets
  SET is_current = p_visible
  WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'toggle_round_asset_visible: asset % not found', p_asset_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_round_asset_visible(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_round_asset_visible(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_round_asset_visible(uuid, boolean) TO authenticated;
