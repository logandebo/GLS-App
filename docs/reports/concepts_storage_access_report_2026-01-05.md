# Concepts Storage & Access Report (2026-01-05)

## Summary
- Currently, custom concepts are stored in the creator’s browser `localStorage` and not in the cloud. When a tree is published, the tree structure goes to Supabase, but the concept definitions referenced by that tree do not.
- Viewers can fetch the published tree from Supabase, but their browser does not have the creator’s custom concept definitions, so concept lookups fail. Practically, only the creator (whose localStorage contains those concepts) can access them.

## Where concepts live today
- Built‑in concepts: loaded from the master graph JSON at [docs/data/graph.json](docs/data/graph.json) via the loader in [docs/js/contentLoader.js](docs/js/contentLoader.js#L1-L50).
- Custom concepts (user‑created): stored in `localStorage` under `gep_customConcepts` by the creator UI in [docs/js/creator.js](docs/js/creator.js#L244-L312) and the helpers in [docs/js/contentLoader.js](docs/js/contentLoader.js#L4-L40).
- Published concepts map (for learners): cached in `localStorage` under `gep_publicConcepts` via [savePublicConcepts](docs/js/contentLoader.js#L28-L41). This cache is populated on the publisher’s browser during publish.

## Publish flow vs. viewer flow
- Cloud publish (trees):
  - Trees are saved to Supabase table `creator_trees` through [docs/js/supabaseStore.js](docs/js/supabaseStore.js#L39-L116) and marked public with `is_published=true`.
  - RLS policies in [docs/instructions/supabase_schema_policies.sql](docs/instructions/supabase_schema_policies.sql#L1-L87) allow anyone to `SELECT` rows where `is_published=true`.
- Concepts during publish:
  - The publish routine in [docs/js/catalogStore.js](docs/js/catalogStore.js#L130-L220) copies referenced custom concepts from the creator’s `gep_customConcepts` into the local `gep_publicConcepts` cache on that same browser.
  - These concept definitions are NOT written to Supabase. They only exist in the publisher’s localStorage.
- Viewer experience:
  - Viewers load public trees from Supabase via [refreshPublicCatalogFromCloud](docs/js/catalogStore.js#L54-L110).
  - The concept page merges Master Graph nodes with `loadPublicConcepts()` from localStorage in [docs/js/concept.js](docs/js/concept.js#L1-L52) and [docs/js/concept.js](docs/js/concept.js#L68-L110).
  - Since a viewer’s localStorage lacks the publisher’s `gep_publicConcepts` cache, any custom concept IDs referenced by the tree cannot be resolved, leading to errors like “Concept not found.”

## Why only the creator can access the concept
- The creator’s browser has both:
  - Their custom concepts in `gep_customConcepts`.
  - The “published” concepts cache in `gep_publicConcepts` (populated locally during publish).
- Other users do not receive those concepts because they are never fetched from the cloud, so lookups fail for custom concept IDs.

## Supabase policies are working as designed
- Supabase RLS correctly restricts `creator_trees` to owners except when `is_published=true` (public read). See [docs/instructions/supabase_schema_policies.sql](docs/instructions/supabase_schema_policies.sql#L33-L59).
- The problem is not Supabase access to trees, but the lack of a cloud source of truth for concept definitions.

## Recommended fixes
- Persist concepts centrally:
  - Add a `public_concepts` table in Supabase: `{ id text primary key, title text, summary text, subject text, tags text[], created_by uuid, created_at timestamptz, updated_at timestamptz }`.
  - RLS: `select` for all; `insert/update/delete` limited to owners or admins.
  - On publish, upsert any referenced custom concepts into `public_concepts`.
  - On viewer pages, replace `loadPublicConcepts()` with a Supabase fetch of `public_concepts` (fallback to localStorage for offline).
- Alternative short‑term options:
  - Embed minimal concept definitions into `creator_trees.tree_json` so viewers always have the needed fields alongside the tree.
  - Provide an export/import path that includes concept definitions; auto‑import on first view.

## Quick verification steps
- As Creator A:
  - Create a custom concept and a tree that references it in [creator](docs/creator.html).
  - Publish the tree; confirm it appears in the catalog and that you can open the concept.
- As Viewer B (different account or browser profile):
  - Refresh public catalog (uses [refreshPublicCatalogFromCloud](docs/js/catalogStore.js#L54-L110)); open the same tree.
  - Observe concept lookups fail because [loadPublicConcepts](docs/js/contentLoader.js#L22-L32) returns an empty map.

## Conclusion
- The storage model places custom concept definitions only in localStorage. Trees are public in Supabase, but their concepts are not. To make concepts accessible to all viewers, persist and fetch concept definitions from Supabase (or bundle them with the tree JSON).

## Non‑creator Upload Limits
- Sign‑in required: The upload/publish operations rely on an authenticated Supabase session. If a viewer is not signed in (or `SUPABASE_URL`/`SUPABASE_ANON_KEY` are not configured), uploads are blocked in the UI and by the client code in [docs/js/supabaseStore.js](docs/js/supabaseStore.js).
- Client‑side ownership checks: The client uses the signed‑in user’s `id` and filters updates with `.eq('owner_id', user.id)` (see create/update/publish helpers in [docs/js/supabaseStore.js](docs/js/supabaseStore.js)). This means only the row owner can modify or publish a given `creator_trees` record.
- Supabase RLS policies: The database enforces row ownership. Policies in [docs/instructions/supabase_schema_policies.sql](docs/instructions/supabase_schema_policies.sql) allow:
  - `select` for everyone on rows where `is_published = true` (public read).
  - `insert`, `update`, `delete` only when `auth.uid() = owner_id` (owner writes). As a result, non‑owners cannot publish another user’s tree or update its cloud record.
- What a non‑creator can do: They may export a tree locally and upload a new copy under their own account (creating a new `creator_trees` row with their `owner_id`). They cannot modify the original creator’s cloud row without an elevated policy (e.g., team/collaborator role) specifically permitting shared writes.
- Team option (advanced): Add a collaborator policy in Supabase (e.g., a role or table of `collaborators`) to permit `update`/`delete` when `auth.uid()` is in the tree’s collaborator list. Without this, uploads from non‑owners will be denied by RLS.

## Blank Course Screen (Viewer clicks “Start”)
- Symptom: When a viewer (e.g., `spaceman`) clicks Start on a course created by another user (e.g., `logandebo`), `subtree.html` opens but shows an empty graph area.
- Immediate cause in code: The course page renders nodes from the local public catalog cache using [docs/js/subtree.js](docs/js/subtree.js#L1-L55). If `tree.nodes` is missing or empty in the cache, the graph container is cleared and the “Nodes Empty” placeholder is shown.
- Why the cache can be empty:
  1) The viewer’s browser never refreshed the local public catalog from Supabase, so their cache lacks the latest `tree_json.nodes`. The Courses page calls [refreshPublicCatalogFromCloud](docs/js/catalogStore.js#L54-L110) after initial render, but deep‑linking directly to `subtree.html` skips that refresh.
  2) The cloud row’s `tree_json` did not include nodes at publish time (e.g., published a draft without nodes). On viewer fetch, `nodes` becomes an empty array in [docs/js/catalogStore.js](docs/js/catalogStore.js#L70-L105), yielding a blank graph.
  3) Rarely, a localStorage mismatch or older cache may still point to the course id but with a stale/partial payload.
- Concepts vs. nodes: Missing public concept definitions cause “Concept not found” warnings on click, but they do not remove nodes from the graph. A fully blank screen typically indicates `tree.nodes` is empty.
- Quick mitigations:
  - Ensure the viewer loads [docs/courses.html](docs/courses.html) first so the catalog refreshes from Supabase and repopulates localStorage before deep‑linking to `subtree.html`.
  - Confirm that publish writes a full `tree_json` (including `nodes`). The publish path in [docs/js/creator.js](docs/js/creator.js#L500-L610) calls `sbCreateCreatorTree`/`sbUpdateCreatorTree` with the entire local tree; verify the tree had nodes prior to publish.
  - Add a defensive refresh on the course page: call `refreshPublicCatalogFromCloud()` in `subtree.js` before loading the local catalog so deep links always hydrate the cache.
  - As a fallback, embed minimal concept data and nodes directly in `tree_json` to guarantee the viewer page has everything it needs.