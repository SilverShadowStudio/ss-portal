-- Add 'draft' to scene_rounds.status — a client-only state used by the
-- Save Draft flow in NewRoundModal. Draft rounds live exclusively in the
-- portal database and must NOT trigger any external sync (Airtable,
-- Dropbox, notification email, PDF generation). The sync edge functions
-- are updated in the same commit to early-return on status='draft'.
--
-- Partial unique index enforces one draft per scene — when the client
-- clicks to add a round on a scene that already has a draft, the modal
-- reopens the existing draft rather than creating a new row.

ALTER TABLE scene_rounds DROP CONSTRAINT IF EXISTS scene_rounds_status_check;
ALTER TABLE scene_rounds ADD CONSTRAINT scene_rounds_status_check
  CHECK (status IN (
    'pending',
    'draft',
    'in_production',
    'delivered',
    'approved',
    'client_review',
    'awaiting_review'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_rounds_one_draft_per_scene
  ON scene_rounds (scene_id)
  WHERE status = 'draft';
