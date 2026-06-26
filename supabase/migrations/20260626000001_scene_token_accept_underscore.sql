-- Fix the scene_token grouping at its ROOT: the regex, not the RPC grouping.
--
-- round_assets.scene_token (20260623000003) is a STORED generated column that
-- parses the sub-scene key from the filename. Its regex requires a HYPHEN
-- between the project code and the scene code:
--     ^(.+?)-(SC...)...
-- CP106 names are hyphenated (CP106-SC01A-VS_R01_03.jpg) and parse correctly to
-- a real sub-scene token (SC01A / SC01B), so a CP106 round legitimately carries
-- one is_current per sub-scene. CP115 names use an UNDERSCORE between project and
-- scene (CP115_SC02-VS_R01_04.jpg), so the regex fails and scene_token falls
-- through to the FULL filename — making every version its own group, which is
-- why the publish RPC could not un-publish siblings for CP115.
--
-- Fix: accept EITHER separator between project and scene code by replacing the
-- literal '-' with the character class [-_]. Everything else in the pattern is
-- unchanged, so hyphenated names parse identically and only underscore-style
-- names start resolving to their real scene code.
--
--   OLD:  ^(.+?)-(SC[0-9]+[A-Za-z]?)(-[A-Za-z0-9]+)?_R([0-9]+)_([0-9]+)(\.[^.]+)?$
--   NEW:  ^(.+?)[-_](SC[0-9]+[A-Za-z]?)(-[A-Za-z0-9]+)?_R([0-9]+)_([0-9]+)(\.[^.]+)?$
--                ^^^^  only this token changed: '-'  ->  '[-_]'
--
-- Verified against live filenames:
--   CP115_SC02-VS_R01_04.jpg  -> SC02   (was the full filename)
--   CP115_SC02_R01_04.jpg     -> SC02   (bare, no -VS suffix)
--   CP106-SC01A-VS_R01_03.jpg -> SC01A  (unchanged)
--   CP106-SC01B-VS_R01_01.jpg -> SC01B  (unchanged)
-- Blast radius on current data: 8 rows change (CP115 SC01 x4, SC02 x4); 126 rows
-- unchanged; no project other than CP115 is affected.
--
-- scene_token is GENERATED ALWAYS STORED, so its value is physically stored.
-- Postgres 17's ALTER COLUMN ... SET EXPRESSION changes the generation
-- expression AND rewrites the table, RE-DERIVING the stored value for every
-- existing row. So existing CP115 rows pick up the corrected token immediately
-- (no separate backfill needed). The RPC and any reader keep using the same
-- (scene_round_id, scene_token) grouping unchanged.

ALTER TABLE public.round_assets
  ALTER COLUMN scene_token
  SET EXPRESSION AS (
    coalesce(
      (regexp_match(
        filename,
        '^(.+?)[-_](SC[0-9]+[A-Za-z]?)(-[A-Za-z0-9]+)?_R([0-9]+)_([0-9]+)(\.[^.]+)?$'
      ))[2],
      filename
    )
  );
