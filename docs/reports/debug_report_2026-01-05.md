# Debug Report — Creator Trees Delete + Logout Regression

Date: 2026-01-05
Author: GitHub Copilot (debugging agent)

## Scope
- Diagnose and fix failures when deleting published `creator_trees` in Supabase while publishing works.
- Provide concrete code and Supabase policy changes.
- Note an observed regression: logout briefly succeeds then user is signed back in automatically.

## 1) Reproduce + Capture Evidence

How to reproduce locally:
1. Start a static server from the repo root:
   - `npx http-server docs -p 8080`
2. Visit `http://localhost:8080/auth.html`, sign in.
3. Go to `http://localhost:8080/creator.html`, create a tree, publish it.
4. Click Unpublish. Open DevTools Console + Network tabs first.

Evidence to capture (now instrumented with logs):
- Console logs (added):
  - `[DELETE-DIAG] Auth context at delete {...}` (session presence, user id)
  - `[DELETE-DIAG] deleteCreatorTree request/error ...`
  - `[DELETE-DIAG] deleteCreatorTreeByLocalId request/error ...`
  - `[DELETE-DIAG] updateCreatorTree request/error ...`
- Network tab for the DELETE request:
  - URL: `/rest/v1/creator_trees?id=eq.<uuid>&owner_id=eq.<auth_user_uuid>`
  - Method: DELETE
  - Status: expect 403 (if RLS DELETE policy missing) or 200 with row(s) when fixed
  - Request headers: `apikey`, `Authorization: Bearer <JWT>`, `Prefer: return=representation`
  - Response: JSON error when forbidden; deleted rows when allowed

Where the logs come from:
- `docs/js/creator.js` — delete-time auth context logging
- `docs/js/supabaseStore.js` — diagnostics around update/delete requests

## 2) Supabase Schema + Policies (in-repo snapshot)

Table: `creator_trees`
- Columns: `id uuid pk default gen_random_uuid()`, `owner_id uuid not null references auth.users(id)`, `title text`, `tree_json jsonb`, `is_published boolean default false`, `created_at timestamp default now()`
- RLS: ON
- Policies (original file):
  - SELECT owner: "read own trees" using `(auth.uid() = owner_id)`
  - INSERT owner: "insert own trees" with check `(auth.uid() = owner_id)`
  - SELECT public published: "public read published trees" using `(is_published = true)`
- Missing (before fix): UPDATE and DELETE owner policies

Table: `user_progress`
- Columns: `id`, `owner_id (fk auth.users)`, `progress_json`, `updated_at`
- RLS: ON
- Policies: SELECT owner; INSERT/UPDATE owner

Introspection SQL to run in Supabase to confirm real state:
- Columns
```
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name='creator_trees'
order by ordinal_position;
```
- RLS ON?
```
select relname, relrowsecurity
from pg_class
where relname='creator_trees';
```
- Policies
```
select schemaname, tablename, polname, cmd, qual, with_check
from pg_policies
where tablename='creator_trees';
```
- Foreign keys referencing `creator_trees`
```
select tc.table_schema, tc.table_name, kcu.column_name, ccu.table_name as foreign_table_name,
       ccu.column_name as foreign_column_name, rc.update_rule, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name and tc.table_schema = rc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'creator_trees';
```
- Triggers
```
select tgname, tgenabled, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relname = 'creator_trees' and not t.tgisinternal;
```

## 3) Front-end Delete Code Path

Entry point (UI):
- Button `#unpublishTreeBtn` on page: `docs/creator.html`
- Handler: `unpublishCurrentTree()` in `docs/js/creator.js`

Delete flow:
- Resolve `supabaseId` from local tree or by fetching owner rows and matching by `title` or `tree_json.id`.
- Primary delete call:
  - `deleteCreatorTree(id)` in `docs/js/supabaseStore.js`
  - Supabase query: `.from('creator_trees').delete().eq('id', id).eq('owner_id', user.id).select('id')`
- Fallback delete by local id:
  - `deleteCreatorTreeByLocalId(localTreeId)` in `docs/js/supabaseStore.js`
  - Supabase query: `.from('creator_trees').delete().eq('owner_id', user.id).contains('tree_json', { id: localTreeId }).select('id')`
- On failure, fallback to unpublish in place:
  - `updateCreatorTree(id, { is_published: false })`

Auth context at delete time:
- `docs/js/creator.js` logs `hasSession`, `user_id`, and storage key (`gls-auth`).
- Uses the centralized Supabase client from `docs/js/auth/supabaseClient.js` (UMD-based, persistSession enabled).

## 4) Diagnosis

Observed behavior:
- From user: Publishing works; deleting a published creator tree fails. After our change, user-visible delete appears to work, but there is a logout regression (see below).

Most likely root cause of delete failures:
- Missing RLS DELETE policy on `creator_trees` while RLS is enabled.
- Publishing worked because INSERT/UPDATE paths were allowed (INSERT policy present; UPDATE may have been allowed in your DB or deletion fallback set `is_published=false`).

How to prove it with evidence:
- Network DELETE response status 403 Forbidden and error JSON from PostgREST when using an authenticated request.
- Console logs from `[DELETE-DIAG]` show `error` populated on delete and `deletedCount: 0`.

Alternative causes considered:
- Auth/session missing JWT: Less likely; we log session presence + `user_id` at delete time. If missing, the logs will show it and you’d see 401/403.
- FK/constraint (409): Schema file shows no outward FKs to `creator_trees`; no triggers. A 409 would include constraint names in response; not reported.
- API misuse (filters wrong): Code filters by `id` and `owner_id`; fallback by `tree_json.id` and `owner_id`. This matches expected ownership semantics.

## 5) Changes Made

Supabase SQL (in-repo):
- File modified: `docs/instructions/supabase_schema_policies.sql`
- Added owner-only policies:
  - UPDATE policy "update own trees"
  - DELETE policy "delete own trees"

Front-end instrumentation and stability:
- File modified: `docs/js/supabaseStore.js`
  - Added `[DELETE-DIAG]` logs for update/delete calls with filters and error output.
- File modified: `docs/js/creator.js`
  - Ensure session readiness before delete with `waitForSessionReady()`.
  - Log `[DELETE-DIAG] Auth context at delete` with session details.

Logout regression mitigation (code-level):
- We have not yet changed logout behavior in this commit (see “What remains”). Root cause analysis and proposed fix are below.

## 6) What Remains / Next Steps

A) Confirm delete resolution with live Supabase:
- Apply the SQL patch in your Supabase project (see appendix below).
- Re-run the delete flow, capture Network + Console evidence to confirm status 200 and deleted row(s).

B) Logout regression — analysis and fix:
- Observed: Clicking Logout briefly shows logged-out UI, then user appears logged in again almost instantly.
- Hypothesis (based on code): `initSupabase()` migrates any legacy `sb-...auth-token` keys into the current `SUPABASE_STORAGE_KEY` (`gls-auth`) if it doesn’t exist. After `signOut()` clears `gls-auth`, a subsequent init on another page load may restore a valid session from the legacy key, effectively auto-signing in.
- Proposed fix:
  1) On logout, clear both the current `SUPABASE_STORAGE_KEY` and any legacy `sb-` keys from `localStorage` to prevent session resurrection.
  2) Optionally, remove or one-time-gate the legacy migration in `initSupabase()` with a `gls-auth-migrated` flag so it never copies legacy tokens again after a successful sign-in or sign-out.
- Deliverable: apply code changes to the logout handler to clear legacy tokens (see Code Patch below). If desired, I can follow up with an `initSupabase()` migration flag.

C) Evidence capture:
- After fixing policies and logout clearing, capture:
  - DELETE request: 200 + deleted row id(s)
  - Subsequent fetch of own trees excludes the deleted row
  - Logout: localStorage has no `gls-auth` or `sb-...auth-token` keys and session remains null across navigation

## 7) Verification Checklist
1. Apply SQL patch (UPDATE+DELETE policies) in Supabase.
2. Reload Creator page, publish a tree, then Unpublish; watch Console `[DELETE-DIAG]` and confirm DELETE returns 200 and `deletedCount >= 1`.
3. Reload the page; the cloud course no longer appears in owner lists or public catalog.
4. Click Logout on `auth.html`; verify no `gls-auth` nor `sb-` auth tokens remain in localStorage. Refresh — remains logged out.
5. Repeat sign-in and unpublish to ensure both features behave consistently.

---

## Supabase SQL Patch (ready to run)
```
begin;

-- Update own trees
drop policy if exists "update own trees" on creator_trees;
create policy "update own trees"
  on creator_trees
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Delete own trees
drop policy if exists "delete own trees" on creator_trees;
create policy "delete own trees"
  on creator_trees
  for delete
  using (auth.uid() = owner_id);

commit;
```

## Code Patch (diff-style summary)

Files changed:
- `docs/js/supabaseStore.js`
  - Added diagnostic logging for update/delete operations.
- `docs/js/creator.js`
  - Added session readiness and auth-context logging at delete time.
- Proposed logout fix (to implement): clear legacy auth tokens on sign-out in `docs/js/auth_supabase.js` (see below).

Logout fix snippet to add in `auth_supabase.js` (within Logout click handler):
```js
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await window.supabaseClient.signOut();
      // Clear current and legacy auth tokens to prevent session resurrection
      try {
        const { SUPABASE_STORAGE_KEY } = await import('./config.js');
        if (SUPABASE_STORAGE_KEY) localStorage.removeItem(SUPABASE_STORAGE_KEY);
        const keys = Object.keys(localStorage || {});
        keys.filter(k => k.startsWith('sb-') && k.includes('auth'))
            .forEach(k => localStorage.removeItem(k));
      } catch {}
      await refreshSessionUI();
    } catch (e) {
      setStatus('Logout failed.');
    }
  });
}
```

## Why This Happened
- Delete failures: RLS was enabled on `creator_trees` but no DELETE policy existed for owners, so PostgREST returned 403 on DELETE. Publishing worked via allowed INSERT/UPDATE paths.
- Logout regression: A legacy auth-token migration likely reintroduced a valid session token from `sb-...auth-token` keys after `gls-auth` was cleared on signout, effectively auto-signing in upon re-init.

## Appendix A — Exact Front-end Calls
- Delete by id: `.from('creator_trees').delete().eq('id', id).eq('owner_id', user.id).select('id')`
- Delete by local id: `.from('creator_trees').delete().eq('owner_id', user.id).contains('tree_json', { id: localTreeId }).select('id')`
- Update to unpublish: `.from('creator_trees').update({ is_published:false }) ...`

## Appendix B — Where to Look
- Policies file: `docs/instructions/supabase_schema_policies.sql`
- Creator UI: `docs/creator.html`
- Delete logic and diagnostics: `docs/js/supabaseStore.js`, `docs/js/creator.js`
- Supabase client/auth: `docs/js/auth/supabaseClient.js`, `docs/js/auth_supabase.js`, `docs/js/config.js`
