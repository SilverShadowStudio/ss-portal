alter table public.leads add column if not exists linkedin_url text;
comment on column public.leads.linkedin_url is
  'The contact''s LinkedIn profile. Only ever set from a URL actually returned by a web search — never constructed from a name.';
