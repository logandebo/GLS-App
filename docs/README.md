# Gamified Education Platform Prototype

Browser-based MVP using vanilla HTML/CSS/JS. No backend.

## Structure
See instruction file for authoritative spec.

## Running
Serve the root directory with any static server (needed for `fetch`). Example using PowerShell:
```
python -m http.server 8000
```
Then open: `http://localhost:8000/index.html`

## Unity Web MIDI Bridge (ScaleTrainerV2WebGL)
Live MIDI → JS → Unity WebGL forwarding via Web MIDI API.

### Quickstart
```pwsh
npm run start
```
Open: http://localhost:3000/gls

- Click "Enable MIDI" (user gesture required).
- Choose a device in the dropdown (default: All Inputs).
- Press keys and sustain pedal; console shows forwarded events.
- Unity receives JSON via `SendMessage("WebGLMidiReceiver", "OnMIDINote", json)`.

Notes:
- Use Chrome/Edge. Allow MIDI access when prompted.
- If your Unity build uses different file names, adjust paths in `gls_unity_embed.html` under the `config` object.

## Unity WebGL Upload Guide

To host a Unity WebGL build inside lessons (type: `unity_game`):

- Folder layout:
	- Place your exported build under `UnityBuilds/YourBuildName/`
	- Ensure Unity’s generated structure remains intact:
		- `UnityBuilds/YourBuildName/Build/` (contains `.wasm`, `.data`, `.framework.js`, `.loader.js` or `.unityweb` files)
		- `UnityBuilds/YourBuildName/TemplateData/`
		- `UnityBuilds/YourBuildName/StreamingAssets/` (if used)
- URL to use in Lesson Creator:
	- Set `Unity Build URL` to `/UnityBuilds/YourBuildName/index.html`
	- The lesson runner will embed this URL in an iframe.
- Server support:
	- `server.js` serves the repo root statically and sets correct types for `.wasm`, `.data`, `.unityweb`, and compression (`.br`, `.gz`).
	- Start the dev server with `npm start` and open `http://localhost:3000/`.
	- You can directly open your build at `http://localhost:3000/UnityBuilds/YourBuildName/index.html` to debug.
- Tips:
	- Use Chrome/Edge. If the frame is blank, open the URL directly and check DevTools console.
	- Keep Unity’s relative paths unchanged; don’t move files out of the generated folders.
	- For large builds, prefer Brotli/Gzip compression in Unity’s Player Settings.

## Features
- Concept graph (`data/graph.json`)
- Lessons (`data/lessons.json`): video, quiz, and a simple game stub
- XP + mastery tracked per user (multi-user storage) in `localStorage`
- Concept & lesson cards with thumbnail fallback (lesson.media.thumbnail → concept.thumbnail → default asset)
- Recommended concepts section (top 3) + refresh button
- Continue last lesson shortcut and daily streak tracking
- Concept relationships contextualized in recommendations
- Quiz pass threshold 60% with per-question explanations
- Mastery tiers: Unrated / Bronze / Silver / Gold (visual dots on map & bubbles)
- Loading/error states with accessible toast notifications
- List / Map toggle for browsing concepts
- Lesson preview panel for selected concept
- Auth page & header username (Iteration 4 Step 2)

## Pages
- `index.html`: Home hub (Continue, Recommended, Browse All list/map, Lesson Preview panel)
- `lesson.html?lessonId=...`: Play lesson (video), take quiz (explanations), or game stub
- `profile.html`: View XP, streak, concept mastery summary per active user
- `auth.html`: Login / switch-user page

## Courses & Subtree (Valid as of Dec 17, 2025)
Public catalog of curated Creator Trees (courses) with simple metrics and a viewer.

- Catalog Storage: `gep_publicCreatorTrees` (array of published trees)
- Metrics Storage: `gep_treeMetrics` (map: treeId → { views, starts, completions })
- Publish/Unpublish: From `creator.html` via “Publish”/“Unpublish” buttons
- Courses Page: `courses.html` — search, domain/tag filter, sort (Popular/Newest/A–Z/Shortest)
- Subtree Viewer: `subtree.html?treeId=...` — shows nodes with lock/unlock (uses mastery badges + required concepts)
- Live Updates: Courses list updates on publish/unpublish via `storage` events
- User Progress: `gep_userTreeProgress_<userId>` tracks `{ touchedNodeIds, lastNodeId }` for Continue

### Try It (Dec 17, 2025)
1. Start a static server and open `index.html`.
2. Go to `Creator` → create a tree (add concepts) → Save → Publish.
3. Open `Courses`; your published course should appear.
4. Click `View` to open the Subtree viewer; locked nodes show based on your mastery. Use `Start` to record a start and update progress.
5. Use `Unpublish` from Creator to remove it; Courses updates live.

### Quick Tests (Dec 17, 2025)
Basic publish/unpublish and metrics test:

```pwsh
npm run test:courses
```
Expected: “Courses/Subtree publish/metrics test PASSED”.

## Iteration 2 Highlights
- XP integrity: XP derived from unique completed lessons. `addXp` deprecated.
- Mastery refactor: minutes completed vs `concept.estimatedMinutesToBasicMastery`.
- Central lesson map: O(1) lesson lookups via cached map.
- Recommendation heuristic: weights start state, skillScore, relatedness, difficulty, time.
- Accessibility: keyboard activation (Enter/Space), ARIA live toasts.
- Analytics: first-time lesson completion events in `xpEvents`.

## Iteration 3 Highlights
- Thumbnails fallback & onerror default.
- Home layout segmentation and concept map.
- Active concept highlights (cards + bubbles).
- Data extension: `concept.thumbnail` additive.
- Mastery dots color-coded.

## Iteration 4 (Step 1) – Multi-User Storage Foundation
- Storage Refactor: Introduced `gep_users` and `gep_activeUser` keys.
- Migration: `migrateLegacyProfileIfNeeded()` converts legacy single-user keys; assigns username (default `player1`).
- Helper Module: `js/storage.js` with user load/save, active management, profile creation.
- Behavior Preservation: Core learning logic unchanged; UI still single-user.
- Verification: `npm run test:migration` validates migration & integrity.

## Iteration 4 (Step 2) – Auth Flow & Active User Header
- Auth Page: `auth.html` form + existing user list for quick switching.
- Username Normalization: Lowercased for consistent storage keys.
- Guard Logic: `ensureActiveUserOrRedirect()` redirects unauthenticated requests before heavy initialization.
- Header UI: Displays `Logged in as: <username>` and provides "Switch user" button (routes to auth page).
- Isolation: XP, mastery, streaks, analytics operate per active user; switching preserves separate progress.
- Tests: `tests/auth_flow_test.mjs` passes (redirect, creation, switching, XP isolation). Migration tests still valid.
- Non-Disruptive: No lesson/concept schema changes.
- Future Path: Creator tools & graph views will build on authenticated context.

## Iteration 4 (Step 3) – Creator & Custom Content
- Unified Loader: `js/contentLoader.js` merges built-in `data/graph.json`/`data/lessons.json` with local custom arrays.
- Custom Storage Keys: `gep_customConcepts` (Concept[]), `gep_customLessons` (Lesson[]). New items include `isCustom: true` and `createdBy: "<username>"`.
- Creator Page: `creator.html` + `js/creator.js` lets an authenticated user create/update concepts and lessons locally.
- App Integration: `js/lessons.js` and `js/graph.js` refactored to use merged loaders so custom content appears in Browse list, map view, lesson previews, and player.
- Visual Badge: Custom items show a small green `Creator` badge.
- Tests: `tests/custom_content_test.mjs` validates merging and XP accrual for a custom lesson.

## Phase 5 – Standardized Lesson Model & Wizard (In Progress)
Phase 5 introduces a unified lesson schema and a multi-step creation wizard to support richer content types.

### New Lesson Schema (Normalized)
- `id`: unique string
- `conceptId`: parent concept reference
- `title`: display title
- `description`: longer text (optional)
- `type`: one of `video | unity_game | quiz`
- `minutes`: estimated time to complete (number)
- `difficulty`: `beginner | intermediate | advanced`
- `xpReward`: awarded XP on completion/pass
- `contentConfig`: object keyed by type
	- Video: `{ video: { url } }`
	- Unity Game: `{ unity_game: { url } }`
	- Quiz: `{ quiz: { questions: [ { prompt, choices: [ { text, isCorrect } ] } ] } }`

Legacy fields (e.g. `contentType`, `estimatedMinutes`, numeric `difficulty`, legacy quiz structure) are automatically mapped inside `contentLoader.js` so older content still works.

### Creator Wizard (`creator.html` + `js/creator.js`)
Steps:
1. Concept: Select existing or create new (ID uniqueness enforced).
2. Basics: Lesson ID, title, description, minutes, difficulty, type, XP reward.
3. Content: Dynamic form based on type (video URL, Unity build URL, quiz question builder with choices & correctness).
4. Review & Publish: Summary + persist normalized lesson directly.

### Validation Helpers
`js/validation.js` centralizes checks: unique IDs, URL validation, difficulty whitelist, quiz question integrity.

### Runners
`js/lessonRunner.js` and `js/quizRunner.js` consume normalized lessons; `lesson.html` now delegates rendering through these modules.

### UI Updates
Lesson cards chips now reflect `type`, `minutes`, string `difficulty`, and `xpReward` consistently. A new XP chip (`15 XP`) appears when available.

### Tests Added / Updated
- `tests/quiz_builder_test.mjs`: Ensures a saved quiz lesson retains normalized quiz structure.
- `tests/custom_content_test.mjs`: Updated to assert normalized fields (`type`, `minutes`, string `difficulty`, `contentConfig`).

### Remaining Phase 5 Tasks
- README finalization (this section will be refined upon completion).
- Manual verification of all lesson types end-to-end.
- Additional validation & runner polish.

## Data & Content
- Concepts included:
	- Music: `C Major Scale`, `G Major Scale`, `Rhythm Basics`
	- Math: `Fractions Basics`
- Each concept has at least a video and a quiz; scales include a game stub.
- Thumbnails: Provided at lesson and (optionally) concept level.
- Default thumbnail: `assets/img/thumb_default.png` fallback.

## Next Ideas
- Smarter recommendations (tags, prerequisites)
- Richer games & real media assets
- Server-backed profiles / analytics
- Creator tools & graph visualization (future Iteration 4 steps)

## Development Notes
- Storage keys (multi-user): `gep_users` (username → profile), `gep_activeUser` (active username). Legacy `userProfile` / `gep_profile` migrated automatically.
- Storage keys (custom content): `gep_customConcepts` and `gep_customLessons`.
- Toast container id: `toast-container` with `aria-live="polite" aria-atomic="true"`.
- Clear a specific user via DevTools:
```js
const users = JSON.parse(localStorage.getItem('gep_users')||'{}');
delete users['username_here'];
localStorage.setItem('gep_users', JSON.stringify(users));
```
- Reset active user:
```js
localStorage.removeItem('gep_activeUser');
```
- Code style: vanilla modules, tabs indentation, minimal dependencies.

### Try It (Step 3)
1. Start a static server and open `index.html`.
2. Log in (auth) if prompted.
3. Click `Creator` in the header to add a concept and a lesson.
4. Return to Home and verify your concept appears with a `Creator` badge; open its lesson.
5. Complete the lesson and confirm XP increases under your profile.

