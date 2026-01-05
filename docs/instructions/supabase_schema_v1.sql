-- Supabase schema v1 for Luden (GLS / Learning Network)
-- Tables: profiles, user_progress, concepts, lessons, courses
-- RLS: enabled on all; policies for secure access
-- Run this entire script in Supabase SQL Editor.

begin;

-- 1) profiles ---------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

-- Policies
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own
  on profiles
  for select
  using (auth.uid() = id);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own
  on profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own
  on profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Optional: allow user to delete own profile (not required)
drop policy if exists profiles_delete_own on profiles;
create policy profiles_delete_own
  on profiles
  for delete
  using (auth.uid() = id);

-- 2) user_progress ----------------------------------------------------------
create table if not exists user_progress (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  entity_type text check (entity_type in ('concept','lesson','course')),
  entity_id text not null,
  status text,
  xp int default 0,
  meta jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique (user_id, entity_type, entity_id)
);

alter table user_progress enable row level security;

-- Indexes
create index if not exists user_progress_user_id_idx on user_progress(user_id);
create index if not exists user_progress_entity_idx on user_progress(entity_type, entity_id);

-- Policies: user can only see/change own rows
-- SELECT
drop policy if exists user_progress_select_own on user_progress;
create policy user_progress_select_own
  on user_progress
  for select
  using (user_id = auth.uid());

-- INSERT
drop policy if exists user_progress_insert_own on user_progress;
create policy user_progress_insert_own
  on user_progress
  for insert
  with check (user_id = auth.uid());

-- UPDATE
drop policy if exists user_progress_update_own on user_progress;
create policy user_progress_update_own
  on user_progress
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE
drop policy if exists user_progress_delete_own on user_progress;
create policy user_progress_delete_own
  on user_progress
  for delete
  using (user_id = auth.uid());

-- 3) concepts ---------------------------------------------------------------
create table if not exists concepts (
  id text primary key,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  summary text,
  domain text,
  tags text[],
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table concepts enable row level security;

-- Indexes
create index if not exists concepts_is_public_idx on concepts(is_public);
create index if not exists concepts_created_by_idx on concepts(created_by);
create index if not exists concepts_domain_idx on concepts(domain);

-- Policies
-- Public or owner can read
drop policy if exists concepts_select_public_or_owner on concepts;
create policy concepts_select_public_or_owner
  on concepts
  for select
  using (is_public = true or created_by = auth.uid());

-- Owner writes
drop policy if exists concepts_insert_owner on concepts;
create policy concepts_insert_owner
  on concepts
  for insert
  with check (created_by = auth.uid());

drop policy if exists concepts_update_owner on concepts;
create policy concepts_update_owner
  on concepts
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists concepts_delete_owner on concepts;
create policy concepts_delete_owner
  on concepts
  for delete
  using (created_by = auth.uid());

-- 4) lessons ---------------------------------------------------------------
create table if not exists lessons (
  id text primary key,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  content_type text check (content_type in ('video','game','quiz','article','external')),
  content_url text,
  payload jsonb default '{}'::jsonb,
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table lessons enable row level security;

-- Indexes
create index if not exists lessons_is_public_idx on lessons(is_public);
create index if not exists lessons_created_by_idx on lessons(created_by);
create index if not exists lessons_content_type_idx on lessons(content_type);

-- Policies
drop policy if exists lessons_select_public_or_owner on lessons;
create policy lessons_select_public_or_owner
  on lessons
  for select
  using (is_public = true or created_by = auth.uid());

drop policy if exists lessons_insert_owner on lessons;
create policy lessons_insert_owner
  on lessons
  for insert
  with check (created_by = auth.uid());

drop policy if exists lessons_update_owner on lessons;
create policy lessons_update_owner
  on lessons
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists lessons_delete_owner on lessons;
create policy lessons_delete_owner
  on lessons
  for delete
  using (created_by = auth.uid());

-- 5) courses ---------------------------------------------------------------
-- If an existing table 'creator_trees' is already in use, you can
-- migrate data or rename to 'courses'. This schema expects a 'courses' table.
create table if not exists courses (
  id text primary key,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  slug text unique,
  is_published boolean default false,
  tree_json jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table courses enable row level security;

-- Indexes
create index if not exists courses_is_published_idx on courses(is_published);
create index if not exists courses_created_by_idx on courses(created_by);
create index if not exists courses_slug_idx on courses(slug);
create index if not exists courses_tree_json_gin on courses using gin (tree_json);

-- Policies
-- Public or owner can read
drop policy if exists courses_select_published_or_owner on courses;
create policy courses_select_published_or_owner
  on courses
  for select
  using (is_published = true or created_by = auth.uid());

-- Owner writes
drop policy if exists courses_insert_owner on courses;
create policy courses_insert_owner
  on courses
  for insert
  with check (created_by = auth.uid());

drop policy if exists courses_update_owner on courses;
create policy courses_update_owner
  on courses
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists courses_delete_owner on courses;
create policy courses_delete_owner
  on courses
  for delete
  using (created_by = auth.uid());

commit;
