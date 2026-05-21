-- Recipient email for engagement contracts. Persisted on the draft so the
-- admin doesn't re-enter it; consumed at "Send to portal for signature"
-- (Commit 5) to create the auth user. Additive, nullable.
ALTER TABLE public.team_contracts ADD COLUMN IF NOT EXISTS recipient_email TEXT;
