-- Give round_assets.is_current real meaning: a per-(scene_round, sub-scene)
-- publish flag chosen by an admin, replacing the legacy "always true" default.
--
-- scene_token: STORED GENERATED column parsed from the filename with the same
-- regex validated 126/126 against live data. Generated => auto-populated on every
-- insert/update, so insert paths never write it and the RPC/client never re-parse.
-- Falls back to the full filename when a name doesn't match the pattern, keeping it
-- non-null so the planned partial unique index always applies. New files carry no
-- scene letter, so the token equals the scene code for them.
--
-- NOTE: the partial unique index
--   CREATE UNIQUE INDEX ... ON round_assets (scene_round_id, scene_token) WHERE is_current
-- is intentionally NOT created here. It is coupled to the edge-function rework
-- (dropbox-webhook / dropbox-api / scan-visuals / import-legacy must write
-- is_current=false instead of true) and ships together with it; adding it before
-- those deploy would make the next auto-publishing insert violate the index and
-- silently drop a delivered render. Until then the set_current_round_asset RPC
-- (next migration) maintains the single-current invariant at the application layer.

ALTER TABLE public.round_assets
  ADD COLUMN scene_token text
  GENERATED ALWAYS AS (
    coalesce(
      (regexp_match(
        filename,
        '^(.+?)-(SC[0-9]+[A-Za-z]?)(-[A-Za-z0-9]+)?_R([0-9]+)_([0-9]+)(\.[^.]+)?$'
      ))[2],
      filename
    )
  ) STORED;

-- One-time backfill: the highest version present per (scene_round_id, scene_token)
-- becomes the published version; everything else is unpublished.
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY scene_round_id, scene_token
      ORDER BY version DESC, created_at DESC
    ) AS rn
  FROM public.round_assets
)
UPDATE public.round_assets ra
SET is_current = (r.rn = 1)
FROM ranked r
WHERE r.id = ra.id;

-- New rows must not auto-publish; an admin publishes explicitly via the RPC.
ALTER TABLE public.round_assets ALTER COLUMN is_current SET DEFAULT false;
