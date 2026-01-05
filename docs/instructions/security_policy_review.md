# Security Policy Review (Supabase RLS v1)

This document reviews the RLS policies and constraints for the cloud data layer. It aligns with `supabase_schema_v1.sql` and the project instruction file.

## Summary
- RLS is enabled for all tables storing user-specific or creator-owned data.
- Owner-only writes for `concepts`, `lessons`, and `courses`.
- Public read only for published content (`courses.is_published = true` and similarly `is_public` for concepts/lessons).
- `profiles` and `user_progress` are strictly per-user.
- No account enumeration in any flows.

## Tables & Policies

### `profiles`
- Purpose: Store basic profile and display settings.
- Policies:
  - SELECT: `auth.uid() = id`
  - INSERT: `auth.uid() = id`
  - UPDATE: `auth.uid() = id`
- Notes: Primary key references `auth.users(id)`.

### `user_progress`
- Purpose: Progress per entity (concept/lesson/course).
- Constraints: Unique `(user_id, entity_type, entity_id)`.
- Policies:
  - SELECT: `user_id = auth.uid()`
  - INSERT: `user_id = auth.uid()`
  - UPDATE: `user_id = auth.uid()`
  - DELETE: `user_id = auth.uid()`
- Notes: Prevents cross-user visibility or modification.

### `concepts`
- Purpose: Concept definitions, including creator content.
- Policies:
  - SELECT: `is_public = true OR created_by = auth.uid()`
  - INSERT: `created_by = auth.uid()`
  - UPDATE: `created_by = auth.uid()`
  - DELETE: `created_by = auth.uid()`
- Notes: Users can only manage their own concepts. Public concepts are readable by anyone.

### `lessons`
- Purpose: Lesson metadata + content pointers.
- Policies:
  - SELECT: `is_public = true OR created_by = auth.uid()`
  - INSERT: `created_by = auth.uid()`
  - UPDATE: `created_by = auth.uid()`
  - DELETE: `created_by = auth.uid()`
- Notes: Same visibility and ownership semantics as `concepts`.

### `courses`
- Purpose: Creator trees (courses) with normalized `tree_json`.
- Policies:
  - SELECT: `is_published = true OR created_by = auth.uid()`
  - INSERT: `created_by = auth.uid()`
  - UPDATE: `created_by = auth.uid()`
  - DELETE: `created_by = auth.uid()`
- Notes: Public catalog is backed by `is_published = true`.

## Account Enumeration Considerations
- No API or SQL exposes existence of arbitrary accounts by email or ID.
- Reset/Recovery flows should rely on Supabase’s built-in magic links without confirming whether an email exists.
- DAL avoids any SELECTs over `auth.users`.

## Additional Recommendations
- Validate IDs client-side and enforce stable `slug` generation server-side if needed.
- Consider partial indexes for `is_public` and `is_published` for performance.
- Run periodic checks to ensure RLS policies remain enabled after migrations.

## Verification Steps
- Attempt cross-user access in an incognito session: ensure private drafts are not visible.
- Try modifying another user’s content via the DAL: operations must fail with RLS.
- Confirm published courses are readable without authentication.
- Validate that `user_progress` rows are isolated per `auth.uid()`.
