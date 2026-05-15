-- Add airtable_project_id to projects table for bidirectional sync.
-- Set after airtable-sync-project creates the Airtable Projects record.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS airtable_project_id TEXT;

-- Seed airtable_project_field_config (Projects table tblB4sEUfuFQOv2lA).
-- DO NOTHING so a manually-customised config is not overwritten on re-run.
INSERT INTO app_settings (key, value)
VALUES (
  'airtable_project_field_config',
  '{
    "base_id": "appyidJqOmdNB8WUd",
    "table_id": "tblB4sEUfuFQOv2lA",
    "field_project_name": "Project name",
    "field_client_facing_name": "Client Facing Project Name",
    "field_client_link": "Client",
    "field_project_type": "Project Type",
    "field_contract_or_subscription": "Contract or Subscription",
    "field_status": "Status"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
