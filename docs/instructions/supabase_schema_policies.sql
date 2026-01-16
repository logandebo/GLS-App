-- Supabase schema and RLS policies for Gamified Education Platform
-- Tables creation, enabling RLS, and policies

begin;

-- Courses RLS and policies (aligned with v1 schema)
-- Assumes `courses` table is created by v1 schema script.

-- Create user_progress (aligned with v1 schema)
create table if not exists user_progress (
  id bigserial primary key,
  user_id uuid not null references auth.users(id),
  entity_type text check (entity_type in ('concept','lesson','course')),
  entity_id text not null,
  status text,
  xp int default 0,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique (user_id, entity_type, entity_id)
);

-- Enable Row Level Security (RLS)
alter table courses enable row level security;
alter table user_progress enable row level security;

-- Policies for courses
-- Public or owner can read
drop policy if exists courses_select_published_or_owner on courses;
create policy courses_select_published_or_owner
  on courses
  for select
  using (is_published = true or created_by = auth.uid());

-- Insert: owner only
drop policy if exists courses_insert_owner on courses;
create policy courses_insert_owner
  on courses
  for insert
  with check (created_by = auth.uid());

-- Update: owner only
drop policy if exists courses_update_owner on courses;
create policy courses_update_owner
  on courses
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Delete: owner only
drop policy if exists courses_delete_owner on courses;
create policy courses_delete_owner
  on courses
  for delete
  using (created_by = auth.uid());

-- Policies for user_progress
-- Read own progress
drop policy if exists "user_progress_select_own" on user_progress;
create policy "user_progress_select_own"
  on user_progress
  for select
  using (auth.uid() = user_id);

-- Insert own progress
drop policy if exists "user_progress_insert_own" on user_progress;
create policy "user_progress_insert_own"
  on user_progress
  for insert
  with check (auth.uid() = user_id);

-- Update own progress
drop policy if exists "user_progress_update_own" on user_progress;
create policy "user_progress_update_own"
  on user_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Storage bucket + policies for lesson content
-- Create private bucket 'lesson-content' if not exists
insert into storage.buckets (id, name, public)
select 'lesson-content', 'lesson-content', false
where not exists (select 1 from storage.buckets where id = 'lesson-content');

-- Note: Storage policies on `storage.objects` require table ownership.
-- In Supabase, use the Dashboard (Storage → Policies) to create these policies.
-- The statements below are provided for reference and should be applied via Dashboard.

-- Helper: derive lesson id (text) from storage path like 'lessons/{lesson_id}/...'
create or replace function public.lesson_id_from_path(path text)
returns text language plpgsql immutable as $$
declare
  m text[];
begin
  m := regexp_match(path, '^lessons/([^/]+)/');
  if m is null or array_length(m, 1) is null then
    return null;
  end if;
  return m[1];
end $$;

-- Helper: derive lesson id (uuid) from storage path when lessons.id is uuid
create or replace function public.lesson_id_uuid_from_path(path text)
returns uuid language plpgsql immutable as $$
declare
  m text[];
begin
  m := regexp_match(path, '^lessons/([^/]+)/');
  if m is null or array_length(m, 1) is null then
    return null;
  end if;
  begin
    return m[1]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end $$;

-- Reference: Owners can upload to their lesson folder
-- create policy lesson_storage_owner_insert on storage.objects for insert to authenticated
-- with check (
--   bucket_id = 'lesson-content' and exists (
--     select 1 from public.lessons l
--     where l.id = public.lesson_id_from_path(name)
--       and (l.created_by = auth.uid() or l.user_id = auth.uid())
--   )
-- );

-- Reference: Owners can update their lesson assets
-- create policy lesson_storage_owner_update on storage.objects for update to authenticated
-- using (bucket_id = 'lesson-content' and exists (
--   select 1 from public.lessons l
--   where l.id = public.lesson_id_from_path(name)
--     and (l.created_by = auth.uid() or l.user_id = auth.uid())
-- ))
-- with check (bucket_id = 'lesson-content' and exists (
--   select 1 from public.lessons l
--   where l.id = public.lesson_id_from_path(name)
--     and (l.created_by = auth.uid() or l.user_id = auth.uid())
-- ));

-- Reference: Owners can delete their lesson assets
-- create policy lesson_storage_owner_delete on storage.objects for delete to authenticated
-- using (bucket_id = 'lesson-content' and exists (
--   select 1 from public.lessons l
--   where l.id = public.lesson_id_from_path(name)
--     and (l.created_by = auth.uid() or l.user_id = auth.uid())
-- ));

-- Reference: Owners can list their lesson assets
-- create policy lesson_storage_owner_select on storage.objects for select to authenticated
-- using (bucket_id = 'lesson-content' and exists (
--   select 1 from public.lessons l
--   where l.id = public.lesson_id_from_path(name)
--     and (l.created_by = auth.uid() or l.user_id = auth.uid())
-- ));

commit;
