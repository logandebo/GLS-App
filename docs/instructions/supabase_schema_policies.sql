-- Supabase schema and RLS policies for Gamified Education Platform
-- Tables creation, enabling RLS, and policies

begin;

-- Create creator_trees
create table if not exists creator_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text,
  tree_json jsonb,
  is_published boolean default false,
  created_at timestamp default now()
);

-- Create user_progress
create table if not exists user_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  progress_json jsonb,
  updated_at timestamp default now()
);

-- Enable Row Level Security (RLS)
alter table creator_trees enable row level security;
alter table user_progress enable row level security;

-- Policies for creator_trees
-- Read own trees
drop policy if exists "read own trees" on creator_trees;
create policy "read own trees"
  on creator_trees
  for select
  using (auth.uid() = owner_id);

-- Insert own trees
drop policy if exists "insert own trees" on creator_trees;
create policy "insert own trees"
  on creator_trees
  for insert
  with check (auth.uid() = owner_id);

-- Public read for published trees
drop policy if exists "public read published trees" on creator_trees;
create policy "public read published trees"
  on creator_trees
  for select
  using (is_published = true);

-- Policies for user_progress
-- Read own progress
drop policy if exists "read own progress" on user_progress;
create policy "read own progress"
  on user_progress
  for select
  using (auth.uid() = owner_id);

-- Write own progress (insert + update)
drop policy if exists "write own progress" on user_progress;
create policy "write own progress"
  on user_progress
  for insert, update
  with check (auth.uid() = owner_id);

commit;
