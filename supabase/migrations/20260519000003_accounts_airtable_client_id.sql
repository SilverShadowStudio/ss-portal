-- Store the Airtable Clients-table record id directly on the portal
-- account row so portal → Airtable sync becomes a hard link, not a
-- by-name lookup. Re-resolving by company_name on every sync risks
-- duplicate Clients rows when names diverge (renames in Airtable, or
-- a typo in either system).
--
-- airtable-sync-contact and airtable-sync-project both check this
-- column first; if NULL they fall back to the existing name lookup
-- and persist the resolved id here for future syncs.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS airtable_client_id TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_airtable_client_id
  ON accounts(airtable_client_id);
