-- Persist freehand annotations made by clients/admins on round assets.
-- Mirrors asset_pins RLS so the same people who can pin can also draw.
create table if not exists public.asset_drawings (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  scene_round_id uuid not null,
  created_by uuid not null,
  -- Polyline points stored as a JSON array of { x, y } in [0..1] image space.
  points jsonb not null,
  color text not null default '#39FF14',
  created_at timestamptz not null default now()
);

create index if not exists asset_drawings_asset_id_idx
  on public.asset_drawings(asset_id);

alter table public.asset_drawings enable row level security;

-- Admins: full access.
create policy "Admins can view all drawings"
  on public.asset_drawings for select
  using (is_admin());

create policy "Admins can insert drawings"
  on public.asset_drawings for insert
  with check (is_admin());

create policy "Admins can delete drawings"
  on public.asset_drawings for delete
  using (is_admin());

-- Clients: only on their own assets, only their own rows.
create policy "Clients can view drawings on their assets"
  on public.asset_drawings for select
  using (
    exists (
      select 1
      from round_assets ra
      join scene_rounds sr on sr.id = ra.scene_round_id
      join scenes s on s.id = sr.scene_id
      join projects p on p.id = s.project_id
      where ra.id = asset_drawings.asset_id
        and p.user_id = auth.uid()
    )
  );

create policy "Clients can create drawings on their assets"
  on public.asset_drawings for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from round_assets ra
      join scene_rounds sr on sr.id = ra.scene_round_id
      join scenes s on s.id = sr.scene_id
      join projects p on p.id = s.project_id
      where ra.id = asset_drawings.asset_id
        and p.user_id = auth.uid()
    )
  );

create policy "Clients can delete their own drawings"
  on public.asset_drawings for delete
  to authenticated
  using (auth.uid() = created_by);

-- Realtime so erases/adds reflect across sessions.
alter publication supabase_realtime add table public.asset_drawings;