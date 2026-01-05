# Copilot Instruction File — Move ALL App Data to Supabase (Users, Courses, Lessons, Concepts)

Project: Luden (GLS / Learning Network)  
Current state: Creator trees (courses) are being stored in Supabase, but other data (concepts, lessons, user progress/profile) still lives in local JSON / localStorage.  
Goal: Upgrade to a Supabase-backed data layer so **all core data** is stored and loaded from Supabase:
- User data (profile + progress)
- Course data (creator trees / published trees)
- Lesson data
- Concept data

**Non-goals (v1):**
- No server-side “admin panel” required.
- No paid tiers, no advanced analytics yet.
- Keep vanilla JS static-site architecture (GitHub Pages) and Supabase JS v2 UMD.

---

## 0) Rules for implementation

1. **Single source of truth:** Supabase is the source of truth. localStorage becomes a cache only.
2. **RLS ON for all tables** storing user-specific or creator-owned content.
3. **No account enumeration** (in any “find user” / reset flows).
4. **Minimize breaking changes:** keep existing UI/UX; swap storage layer under it.
5. **Backwards compatibility migration:** On first run after upgrade, migrate any legacy localStorage data into Supabase for that signed-in user.
6. **Do not store secrets in repo:** Supabase anon key is acceptable if already used; do not add service keys.

---

## 1) Supabase schema design (v1)

Create these tables in Supabase (SQL Editor). Use UUID user IDs from `auth.users`.

### 1.1 `profiles`
User profile + display settings.

Columns:
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text`
- `avatar_url text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

RLS policies:
- SELECT: user can select own profile
- INSERT: user can insert own profile
- UPDATE: user can update own profile

### 1.2 `user_progress`
User progress per concept/lesson/course.

Columns:
- `id bigserial primary key`
- `user_id uuid references auth.users(id) on delete cascade`
- `entity_type text check (entity_type in ('concept','lesson','course'))`
- `entity_id text not null`
- `status text` (e.g., 'unseen','seen','bronze','silver','gold','completed')
- `xp int default 0`
- `meta jsonb default '{}'::jsonb`
- `updated_at timestamptz default now()`

Constraints / Indexes:
- unique `(user_id, entity_type, entity_id)`

RLS:
- SELECT/INSERT/UPDATE/DELETE: user can only access rows where `user_id = auth.uid()`.

### 1.3 `concepts`
All concept definitions, including creator custom concepts.

Columns:
- `id text primary key`
- `created_by uuid references auth.users(id) on delete set null`
- `title text not null`
- `summary text`
- `domain text`
- `tags text[]`
- `is_public boolean default false`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

RLS:
- SELECT: `(is_public = true) OR (created_by = auth.uid())`
- INSERT/UPDATE/DELETE: `(created_by = auth.uid())`

### 1.4 `lessons`
Lesson metadata and content pointers.

Columns:
- `id text primary key`
- `created_by uuid references auth.users(id) on delete set null`
- `title text not null`
- `description text`
- `content_type text check (content_type in ('video','game','quiz','article','external'))`
- `content_url text`
- `payload jsonb default '{}'::jsonb`
- `is_public boolean default false`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

RLS:
- SELECT: `(is_public = true) OR (created_by = auth.uid())`
- INSERT/UPDATE/DELETE: `(created_by = auth.uid())`

### 1.5 `courses`
If you already have `creator_trees`, either rename it to `courses` or keep it but standardize behavior.

Columns:
- `id text primary key`
- `created_by uuid references auth.users(id) on delete set null`
- `title text not null`
- `description text`
- `slug text unique`
- `is_published boolean default false`
- `tree_json jsonb not null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

RLS:
- SELECT: `(is_published = true) OR (created_by = auth.uid())`
- INSERT/UPDATE/DELETE: `(created_by = auth.uid())`

---

## 2) Supabase SQL deliverable

Copilot must output a single file: `supabase_schema_v1.sql` that includes:
- CREATE TABLE statements
- ENABLE RLS on all tables
- CREATE POLICY statements
- indexes + unique constraints

Then I (Logan) will run that SQL in Supabase.

---

## 3) Front-end architecture upgrade

### 3.1 Add a Data Access Layer (DAL)
Create: `docs/js/dataStore.js`

Functions to implement (minimum):
- Profiles:
  - `getProfile()`
  - `upsertProfile({ display_name, avatar_url })`
- Progress:
  - `getUserProgress()`
  - `upsertProgress({ entity_type, entity_id, status, xp, meta })`
  - `bulkUpsertProgress(records)`
- Concepts:
  - `getConcept(id)`
  - `getConcepts(ids[])`
  - `upsertConcept(concept)`
- Lessons:
  - `getLesson(id)`
  - `getLessons(ids[])`
  - `upsertLesson(lesson)`
- Courses:
  - `getCourseById(id)`
  - `getCourseBySlug(slug)`
  - `getCoursesPublic()`
  - `getCoursesByUser()`
  - `upsertCourse(course)`
  - `deleteCourse(id)` (owner-only)

Requirements:
- Use **one** Supabase client (from `supabaseClient.js`).
- Add simple caching in localStorage (stale-while-revalidate):
  - e.g., `cache:courses_public`, `cache:concepts`, `cache:lessons`
- Always treat Supabase as the source of truth.

### 3.2 Refactor existing code to call DAL
Search and replace:
- Any reads/writes to `localStorage` for core entities (concepts/lessons/courses/progress/profile)
- Any loads from `graph.json` / `lessons.json` used as real data (keep only as optional fallback demos)

Update pages:
- `courses.html` list should come from `getCoursesPublic()`
- `creator.html` editor should use `getCoursesByUser()` and `upsertCourse()`
- `subtree.html` viewer should use `getCourseById/Slug()` and then batch fetch referenced concepts/lessons

---

## 4) One-time migration (legacy localStorage → Supabase)

On first load AFTER upgrade (user must be signed in):
1. Detect legacy keys (examples; adjust to your actual names):
   - `gep_userProfile`
   - `gep_progress`
   - `gep_customConcepts`
   - `gep_customLessons`
   - `gep_creatorTrees`
2. For each present key, migrate:
   - Profile → `profiles` (upsert)
   - Progress → `user_progress` (bulk upsert)
   - Custom concepts → `concepts` (created_by=auth.uid(), is_public=false)
   - Custom lessons → `lessons` (created_by=auth.uid(), is_public=false)
   - Draft courses → `courses` (is_published=false)
3. Set `localStorage.setItem('migration:v1:done','1')` after success.
4. Do not rerun if flag exists.

Add a toast: “Migration completed.”

---

## 5) Publish flow requirements (critical)

When publishing a course:
1. Ensure `tree_json` includes nodes + edges + positions.
2. Extract referenced concept IDs and lesson IDs from `tree_json`.
3. Upsert any missing referenced concepts/lessons to Supabase BEFORE marking course published.
4. Set:
   - `is_published = true`
   - Ensure `slug` exists and is stable

---

## 6) Viewer flow requirements (critical)

In `subtree.html`:
1. Fetch course by id or slug from Supabase.
2. Extract needed concept IDs + lesson IDs.
3. Batch fetch those via DAL (`getConcepts`, `getLessons`).
4. Render.
5. If anything missing:
   - show placeholders
   - show message: “This course needs republishing.”

Also ensure deep-linking works with no prerequisite page visits.

---

## 7) User progress requirements

Whenever user completes a lesson / node quiz:
- write progress via DAL:
  - `entity_type` + `entity_id`
  - status + xp + meta

Render UI badges using progress map from `getUserProgress()`.

---

## 8) Testing checklist (must pass)

Authenticated:
- Create concept/lesson/course → refresh → persists
- Publish course → incognito can view course + concepts/lessons
- Progress persists across devices

Unauthenticated:
- Can browse published courses
- Cannot see private drafts

Security:
- User A cannot edit/delete User B content (RLS enforced)

---

## 9) Deliverables Copilot must output

1. `supabase_schema_v1.sql`
2. `docs/js/dataStore.js`
3. Refactors to use DAL as source of truth
4. One-time migration logic
5. Updated publish + viewer logic ensuring referenced content exists

End.
