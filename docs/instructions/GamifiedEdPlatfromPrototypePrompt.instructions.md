# Copilot Instruction File — Fix “Cloud publish failed (insert). Slug conflict unresolved.”

## Problem
Publishing a course to Supabase fails with:
> “Cloud publish failed (insert). Slug conflict unresolved.”

Root cause:
- `courses.slug` is **globally unique**.
- Another course (possibly another user’s private draft) already has that slug.
- Because of RLS, the client **cannot reliably pre-check** slug availability.
So we must handle conflicts by **generating slugs that are effectively collision-proof** and **retrying on unique violations**.

---

## Success criteria
1. Publishing must succeed even when the initial slug collides.
2. Slugs should be stable once published (do not change on every publish unless forced).
3. Collision probability must be near-zero by design.
4. When a conflict happens, the UI should show a helpful message and optionally allow regenerate/edit.

---

## Approach overview (implement all)
A) Implement a robust slug generator:
- `slug = slugify(title) + "-" + <randomSuffix>`
- Use **10–12 chars** of a safe alphabet (base62 or base32), derived from `crypto.getRandomValues`.
- This avoids collisions even with global uniqueness.

B) Ensure every newly created/imported tree gets a slug immediately.

C) Make publish upsert resilient:
- Attempt upsert/insert.
- If Supabase error indicates **unique violation on slug**, regenerate slug and retry (max 3–5 tries).
- Persist the final winning slug back into local tree state and local cache.

D) Improve diagnostics:
- Surface Supabase error code/message in console (and optionally in UI toast for non-sensitive cases).

E) Optional (small UX improvement):
- Display current slug near Publish with a “Regenerate” button (and/or editable slug field with validation).

---

## Step-by-step tasks

### 1) Add a shared slug utility
Create: `docs/js/utils/slug.js` (or similar)

Functions:
- `slugifyTitle(title)`  
  - lower-case
  - trim
  - replace spaces with hyphens
  - remove unsafe chars
  - collapse multiple hyphens
  - fallback to `course` if empty
- `randomSuffix(len=12)`  
  - use `crypto.getRandomValues(new Uint8Array(len))`
  - map to base62 chars `0-9a-zA-Z` (or base32)
- `generateCourseSlug(title, len=12)`  
  - returns `${slugifyTitle(title)}-${randomSuffix(len)}`

Notes:
- DO NOT use Math.random.
- Keep deterministic slugify, random suffix for uniqueness.
- Consider maximum length (e.g., 80 chars total); truncate slugify part if needed.

### 2) Ensure slug is assigned at course creation/import time
Find where trees are created/imported:
- `createCreatorTree()`
- `importCreatorTree()`
- anywhere a new tree object is formed

Set:
- If `tree.slug` missing, set `tree.slug = generateCourseSlug(tree.title || tree.name)`

For legacy trees:
- When loading a tree that has no slug, generate one once and persist locally so it stops defaulting to common values.

### 3) Harden publish / upsert logic with retries
Locate publish flow:
- likely `docs/js/creator.js` calling DAL `upsertCourse()`.

Implement:
- `publishCourseWithRetry(tree, maxRetries=5)`
  - Ensure authenticated session ready first (keep your existing session gating).
  - Ensure tree.slug exists; if not, generate.
  - Try `upsertCourse(tree)`:
    - If success: persist returned slug to local tree + update local list.
    - If failure:
      - If **unique violation on slug**, regenerate slug and retry.
      - Else: throw / show error.

How to detect slug unique violation:
- Postgres SQLSTATE `23505` for unique violation.
- In supabase-js error, check:
  - `error.code === '23505'` OR
  - `error.message` includes `duplicate key value violates unique constraint`
  - and ideally confirm constraint name includes `courses_slug_key` (or whatever your schema creates).

If you can’t reliably get constraint name due to RLS masking:
- treat any `23505` as conflict, but log full details.

Important:
- If `upsertCourse` uses `upsert` with conflict target `id`, then a slug conflict can still fail.
- Ensure publish path either:
  - updates existing course row by `id` (owner) OR inserts if missing.
  - If the course already exists (same id), slug update should be allowed; if slug collides, retry.

### 4) Persist the “winning slug”
Once publish succeeds:
- Update the in-memory tree object
- Update localStorage cache/store for that tree
- Ensure courses list and deep-linking use the stored slug

### 5) Add UI helpers (minimal)
In `creator.html` near publish controls:
- Show: `Slug: <currentSlug>`
- Add a small button: “Regenerate”
  - `tree.slug = generateCourseSlug(tree.title)`
  - Update the UI
  - Do NOT auto-publish; user chooses publish.

Optional:
- Make slug editable with validation:
  - validate slugify format
  - enforce min length
  - show warning “Must be unique globally; we’ll auto-fix on publish if taken.”

### 6) Improve error messaging
When publish fails:
- In console: log the full supabase error object.
- In UI toast:
  - If retries exhausted due to slug conflicts: “Couldn’t find a unique URL slug. Try Regenerate.”
  - If other error: “Cloud publish failed: <short reason>”

Do not leak sensitive info in UI; console logging is fine.

---

## Files to inspect and likely edit
- `docs/js/creator.js` (publish flow)
- `docs/js/creatorTreeStore.js` (creation/import logic)
- `docs/js/dataStore.js` (upsertCourse, insert/update behavior)
- Any slug helpers currently embedded in these files

---

## Verification plan
1. Create 20 courses with similar titles (“Music Basics”) and publish: all should succeed.
2. Simulate collision:
   - Force set two local trees to same slug manually, publish both; second must auto-regenerate and succeed.
3. Confirm deep link:
   - Open `subtree.html?slug=<slug>` (or your routing) and it loads.
4. Confirm stability:
   - Republish the same course: slug remains unchanged unless conflict forces regeneration.
5. Confirm no regression:
   - Auth session gating still works
   - Delete course still works (RLS policies unaffected)

---

## Deliverables you must output
1. Code changes implementing the slug utility + creation-time slug assignment.
2. Publish retry mechanism handling unique violations robustly.
3. Minimal UI slug display + Regenerate button.
4. Short notes at end: what changed + how to test.

End.
