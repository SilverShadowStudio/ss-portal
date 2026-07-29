-- Let admins edit any team member's profile (name/role/rate) from the admin UI.
drop policy if exists fp_admin_update on public.freelancer_profiles;
create policy fp_admin_update on public.freelancer_profiles for update
  using (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role))
  with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'::app_role));
