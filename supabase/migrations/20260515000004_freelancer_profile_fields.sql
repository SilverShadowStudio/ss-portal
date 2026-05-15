-- Extend freelancer_profiles with granular address fields and rate meta.
ALTER TABLE freelancer_profiles
  ADD COLUMN IF NOT EXISTS flat_number   TEXT,
  ADD COLUMN IF NOT EXISTS house_number  TEXT,
  ADD COLUMN IF NOT EXISTS street_name   TEXT,
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS postcode      TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS rate_currency TEXT DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS rate_period   TEXT DEFAULT 'day';
