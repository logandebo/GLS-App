# Copilot Instructions — Clean Auth + Deterministic Boot (GitHub Pages + Supabase)

Goal: Make **login state reliable and consistent** across all pages (no “looks logged out until hard refresh”). Remove race conditions caused by multiple independent module scripts, and centralize auth + config.

> Constraints:
> - Static site hosted on GitHub Pages (`/docs`)
> - Supabase JS v2 UMD is used
> - Keep current UI/HTML pages, but refactor JS orchestration + auth flow
> - Avoid **top-level await** in feature modules (headerControls, etc.). Only allow `async` inside functions.
> - Do not introduce a full framework. Vanilla ES modules only.

---

## 0) Define Done (Acceptance Criteria)

A. On **normal refresh (Ctrl+R)** of `index.html` after signing in:
- Header shows the correct state (avatar / logout) within 0–500ms after load.
- No “Login / Sign Up” flash if the user is actually logged in (use a loading/skeleton state until auth resolved).

B. On any page load:
- Exactly one boot entry module is responsible for initialization order.
- There is a single source of truth for auth state.

C. Console:
- No uncaught exceptions.
- Clear logs show boot order and auth transitions.

D. Cache coherence:
- Deploys do not produce “HTML cached with mismatched JS set” behavior.

---

## 1) Restructure Script Loading (Critical)

### 1.1 Replace multiple `<script type="module">` tags per page
For each page, reduce to **one** module entrypoint:

**Example (index.html):**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script type="module" src="./js/pages/index.main.js?v=20260103"></script>
```

Do this for:
- `index.html` → `docs/js/pages/index.main.js`
- `auth.html` → `docs/js/pages/auth.main.js`
- `courses.html` → `docs/js/pages/courses.main.js`
- `profile.html` → `docs/js/pages/profile.main.js`
- Any other page that currently loads multiple modules

**Remove** direct module tags for:
- supabaseClient.js
- headerControls.js
- debugLogging.js
- sessionBadge.js
- page modules like home.js, courses.js, etc.

These must be imported from the single entrypoint in deterministic order.

---

## 2) Centralize Supabase Config (Remove Duplication)

Create: `docs/js/config.js`

```js
export const SUPABASE_URL = "REPLACE_ME";
export const SUPABASE_ANON_KEY = "REPLACE_ME";
export const SUPABASE_STORAGE_KEY = "gls-auth";
export const APP_VERSION = "20260103";
export const IS_DEV = location.hostname === "localhost" || location.hostname === "127.0.0.1";
```

Update ALL pages/scripts to stop embedding URL/key in HTML. Only `config.js` owns it.

---

## 3) Make a Real Auth State Store (Single Source of Truth)

Create: `docs/js/auth/authStore.js`

### Requirements
- Owns state: `{ status, session, user }`
- `status`: `"unknown" | "authed" | "guest"`
- Exposes:
  - `initAuth()` — called once during boot, hydrates session
  - `subscribe(fn)` — emits on any changes; returns unsubscribe
  - `getState()` — returns current state
  - `requireAuth({ redirectTo })` — helper for gated pages
- Internally binds `supabase.auth.onAuthStateChange` once, and updates store.
- Never requires feature modules to call `supabase.auth.getSession()` themselves unless absolutely necessary.

Skeleton:
```js
import { getSupabase } from "./supabaseClient.js";

const state = { status: "unknown", session: null, user: null };
const listeners = new Set();

function emit() { for (const fn of listeners) fn({ ...state }); }

export function getState() { return { ...state }; }
export function subscribe(fn) { listeners.add(fn); fn(getState()); return () => listeners.delete(fn); }

export async function initAuth() {
	const supabase = getSupabase();

	// 1) Hydrate session deterministically
	state.status = "unknown";
	emit();

	const { data, error } = await supabase.auth.getSession();
	if (error) console.error("[AUTH] getSession error", error);

	state.session = data?.session ?? null;
	state.user = data?.session?.user ?? null;
	state.status = state.session ? "authed" : "guest";
	emit();

	// 2) Listen for changes
	supabase.auth.onAuthStateChange((_event, session) => {
		state.session = session ?? null;
		state.user = session?.user ?? null;
		state.status = session ? "authed" : "guest";
		emit();
	});
}

export function requireAuth({ redirectTo = "./auth.html" } = {}) {
	const s = getState();
	if (s.status === "unknown") return false; // caller should wait
	if (s.status === "guest") {
		location.href = redirectTo;
		return false;
	}
	return true;
}
```

---

## 4) Refactor Supabase Client Wrapper (No Global Timing Races)

Update: `docs/js/supabaseClient.js` (or move to `docs/js/auth/supabaseClient.js`)

### Requirements
- Expose a deterministic getter:
  - `initSupabase()` called once during boot
  - `getSupabase()` throws if called before init (fail fast)
- Keep storage migration logic, but make it explicit and safe.
- Remove/avoid any implicit “waitForSessionReady polling” for normal pages once authStore is in place.
  - `waitForSessionReady()` can remain for edge cases, but the main flow should be: `initSupabase()` → `initAuth()`.

Skeleton:
```js
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from "../config.js";

let supabase = null;

export function initSupabase() {
	if (supabase) return supabase;

	// optional: migrate legacy keys here (targeted)
	// DO NOT wipe broad localStorage keys.

	supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: { persistSession: true, autoRefreshToken: true, storageKey: SUPABASE_STORAGE_KEY },
	});

	return supabase;
}

export function getSupabase() {
	if (!supabase) throw new Error("Supabase not initialized. Call initSupabase() first.");
	return supabase;
}
```

---

## 5) Header Controls Must Become an Init Function + Subscribe to AuthStore

Update: `docs/js/headerControls.js`

### Requirements
- Must export: `initHeaderControls()`
- Must NOT run at module top-level (no implicit boot)
- Must NOT use top-level await
- Must subscribe to `authStore.subscribe()` and render based on `{status, user}`
- Must support 3 states:
  - `unknown` → show loading state (no login flash)
  - `guest` → show Login / Sign Up
  - `authed` → show avatar + logout

Skeleton:
```js
import { subscribe } from "./auth/authStore.js";

export function initHeaderControls() {
	console.log("[DEBUG] headerControls init");

	const unsubscribe = subscribe((s) => {
		try {
			renderHeader(s);
		} catch (e) {
			console.error("[headerControls] render error", e);
		}
	});

	return unsubscribe;
}
```

Implement `renderHeader(state)` to update DOM.

**Remove** storage event hacks unless truly required. If you keep them, they should call `initAuth()` or rely on supabase auth events, not DIY key-watching.

---

## 6) Page Entrypoints (Deterministic Orchestration)

Create folder: `docs/js/pages/`

### 6.1 Common boot helper
Create: `docs/js/pages/boot.js`

Responsibilities:
- `initSupabase()`
- start debug logging (optional)
- `await initAuth()`
- init header and common UI
- then init page module

Skeleton:
```js
import { initSupabase } from "../auth/supabaseClient.js";
import { initAuth } from "../auth/authStore.js";
import { initHeaderControls } from "../headerControls.js";

export async function bootCommon({ initPage } = {}) {
	console.log("[BOOT] start");

	initSupabase();
	await initAuth();
	initHeaderControls();

	if (initPage) await initPage();

	console.log("[BOOT] done");
}
```

### 6.2 index.main.js
Create: `docs/js/pages/index.main.js`

```js
import { bootCommon } from "./boot.js";
import { initHome } from "../home.js"; // refactor home.js to export initHome

bootCommon({ initPage: initHome }).catch((e) => console.error("[BOOT] fatal", e));
```

### 6.3 auth.main.js
Create: `docs/js/pages/auth.main.js`

```js
import { initSupabase } from "../auth/supabaseClient.js";
import { initAuth } from "../auth/authStore.js";
import { initAuthPage } from "../auth/auth_supabase.js";

async function bootAuth() {
	initSupabase();
	await initAuth(); // sets initial state; auth page can react if already authed
	initAuthPage();
}

bootAuth().catch((e) => console.error("[BOOT] fatal", e));
```

Refactor existing page scripts (home.js, courses.js, profile.js, etc.) to export `initX()` functions and remove module top-level side effects.

---

## 7) Fix Guest vs Local Demo Profile Boundary

Problem: `storage.js` manages demo profiles (gep_*), but header relies on Supabase session. This creates “two truths”.

### Requirements
- Decide policy:
  1) Supabase auth is the only “logged in” concept.
  2) Demo profile is for guest mode only.
- Implement:
  - If `authStore.status === "authed"` → ignore demo profile UI.
  - If `authStore.status === "guest"` → demo profile may render, but header must clearly show “Guest” and still show Login/Sign Up.

Update any modules that treat “has local profile” as “logged in”.

---

## 8) Sign Out Cleanup (Make it Safe)

### Requirements
- Signing out must call `supabase.auth.signOut()` only.
- Avoid broad localStorage wipes.
- If legacy key cleanup is needed, remove **only** known legacy keys:
  - `sb-*auth-token` from previous setups (targeted)
  - your own old keys if documented
- After sign out:
  - authStore should transition to `guest`
  - header updates automatically via subscription

---

## 9) Demo Seeding Gate (Prevent Production Weirdness)

Update `home.js` demo seeding:
- Only seed demo catalog when `IS_DEV === true` OR when a dedicated flag is present:
  - `?demo=1` in URL, or
  - `localStorage.gls_demo_enabled === "1"`
- Never seed silently in production on live GitHub Pages.

---

## 10) Cache Coherency on GitHub Pages (Stop HTML/JS Mismatch)

### Best practice (recommended)
Switch from `?v=...` to versioned filenames for entrypoints:
- `index.main.20260103.js` (or hashed)
- update HTML to reference the new filename each deploy

If you cannot do that yet:
- Ensure index.html changes every deploy (embed `APP_VERSION` in HTML comment)
- Apply the same `?v=` to:
  - entry script
  - CSS
  - any injected partials/templates

Optional meta tags (not guaranteed but can help):
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
```

---

## 11) Logging (Make Failures Obvious)

Add at top of each critical module:
```js
console.log("[DEBUG] <moduleName> loaded", new Date().toISOString());
```

In boot:
- `[BOOT] start`
- `[BOOT] supabase init ok`
- `[BOOT] auth init done status=...`
- `[BOOT] header init done`

Make sure any async call `.catch(console.error)`.

---

## 12) Checklist of Files to Change/Add

### Add
- `docs/js/config.js`
- `docs/js/auth/authStore.js`
- `docs/js/auth/supabaseClient.js` (or refactor existing)
- `docs/js/pages/boot.js`
- `docs/js/pages/index.main.js`
- `docs/js/pages/auth.main.js`
- (and per-page entrypoints for other pages)

### Refactor
- `docs/js/headerControls.js` → export `initHeaderControls()`, subscribe to authStore
- `docs/js/home.js` → export `initHome()`, remove top-level side effects
- `docs/js/auth/auth_supabase.js` → export `initAuthPage()`
- Any other page script → export `initX()`

### HTML
- Each HTML page should include:
  - Supabase UMD script
  - Exactly one module script (page entrypoint)

---

## 13) Final Verification Steps

1. Deploy to GitHub Pages.
2. Open `auth.html` → sign in → navigate to `index.html`.
3. Refresh with Ctrl+R five times:
   - header must remain correct every time.
4. Open a second tab to `index.html`:
   - header must match.
5. Sign out:
   - header flips to guest immediately.
6. Sign in again:
   - header flips to authed immediately.
7. Confirm no “loading stuck” states; if `status` remains `"unknown"` for >2s, log an error.

---

## Implementation Notes

- Keep the existing `window.supabaseClient` if you want, but prefer **module exports** + controlled init.
- The key is: **only boot.js controls timing**, and **authStore controls truth**.
- Avoid “polling for hydration” unless you have a proven case that `getSession()` returns null briefly. If so, add a small bounded retry inside `initAuth()` (max 500–1000ms).

