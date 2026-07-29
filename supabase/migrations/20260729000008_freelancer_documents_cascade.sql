-- freelancer_documents blocked account deletion (NO ACTION). Cascade it so a
-- member with signed documents can be deleted; the edge fn removes the files.
alter table public.freelancer_documents drop constraint if exists freelancer_documents_account_id_fkey;
alter table public.freelancer_documents
  add constraint freelancer_documents_account_id_fkey
  foreign key (account_id) references public.accounts(id) on delete cascade;
