alter table public.accounts add column if not exists archived_at timestamptz;
create index if not exists accounts_archived_at_idx on public.accounts (archived_at);
