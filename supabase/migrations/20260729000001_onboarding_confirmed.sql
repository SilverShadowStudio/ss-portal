-- Default true so every existing team member and every normal sign-created
-- profile counts as confirmed. Pre-signed members are set false at provisioning
-- so they get a proofread step before the portal.
alter table public.freelancer_profiles add column if not exists onboarding_confirmed boolean not null default true;
