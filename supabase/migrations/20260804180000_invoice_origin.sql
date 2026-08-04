-- Distinguish invoices the portal generated from historical ones uploaded by
-- hand for periods that predate self-billing. Without this they'd be
-- indistinguishable, and "did we raise this?" is a question you must be able to
-- answer from the record.
alter table public.self_bill_invoices
  add column if not exists origin text not null default 'generated';

alter table public.self_bill_invoices drop constraint if exists self_bill_invoices_origin_chk;
alter table public.self_bill_invoices add constraint self_bill_invoices_origin_chk
  check (origin in ('generated', 'uploaded'));

comment on column public.self_bill_invoices.origin is
  'generated = raised by freelancer-self-bill-run; uploaded = historical PDF filed by an admin.';
