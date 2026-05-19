-- Per-round buffer between this round's delivery and the next round's
-- production start, in whole weeks. Default 1 matches today's behaviour:
-- a client requesting Round N+1 promptly after Round N delivers lands on
-- the next available production Monday (one week of idle after delivery).
--
-- buffer_weeks is read by the client modal on round creation and by the
-- subsequent-round scheduler so longer cycles (stakeholder consolidation,
-- multi-week reviews) can be set up at brief time. UI range is 1–12.
ALTER TABLE scene_rounds
  ADD COLUMN IF NOT EXISTS buffer_weeks INTEGER DEFAULT 1;
