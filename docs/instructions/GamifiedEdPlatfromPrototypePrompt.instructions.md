# Copilot Instructions — Redesign Lesson Cards in `subtree_node.html` (Concept-Art Style)

## Goal
Update the lesson cards in `subtree_node.html` so they match the new **minimal, aesthetic card design**:
- The **thumbnail is the main body** (dominant visual area).
- A small header row shows **Title + content type** (Video / Game / Quiz).
- A single primary CTA button per card: **Watch / Play / Start**.
- Cards look clean in dark mode, with soft shadows, rounded corners, and consistent spacing.

You are working in a vanilla HTML/CSS/JS codebase (no frameworks unless already present). Keep changes localized, incremental, and avoid breaking existing data flows.

---

## What to Change (High-level)
1. **Replace current compact card layout** (tiny thumbnail, stacked text) with a new structure:
   - Header: title (left) + type label + icon (right)
   - Body: large thumbnail with overlay play/indicator icon
   - Footer: one primary CTA button, optional small meta row (difficulty, duration)
2. **Unify rendering** so video/game/quiz cards share one base template, with small visual differences.
3. **Make cards responsive**: single column on narrow screens, multi-column grid on wide screens.

---

## Files Likely Involved
- `subtree_node.html` (or `subtree_node.js` if rendering is JS-driven)
- Any CSS used by subtree pages (e.g. `styles.css`, `subtree.css`, etc.)
- Data sources: `lessons.json`, `graph.json`, or the current lesson list object

> Do not rename files unless necessary. Prefer adding a small new CSS block and a render helper.

---

## Target Visual Spec (Do this)
### Card Structure (DOM)
Create cards with this structure:

```html
<div class="lesson-card lesson-card--video">
  <div class="lesson-card__header">
    <div class="lesson-card__title">The Natural Alphabet</div>
    <div class="lesson-card__type">
      <span class="lesson-card__type-text">Video</span>
      <span class="lesson-card__type-icon" aria-hidden="true">🎥</span>
    </div>
  </div>

  <div class="lesson-card__thumb" role="button" tabindex="0" aria-label="Open lesson preview">
    <img src="..." alt="Lesson thumbnail" />
    <div class="lesson-card__overlay">
      <div class="lesson-card__overlay-icon">▶</div>
    </div>
  </div>

  <div class="lesson-card__meta">
    <span class="lesson-pill">Beginner</span>
    <span class="lesson-meta-dot">•</span>
    <span class="lesson-meta-text">~3 min</span>
  </div>

  <div class="lesson-card__footer">
    <button class="lesson-btn lesson-btn--primary">Watch</button>
  </div>
</div>
```

Notes:
- The **thumbnail is the main body** (`lesson-card__thumb`).
- Title is not inside the thumb; it is in the header.
- **Only one primary button** in the footer.
- Meta row is optional but recommended.

### Content Types
Cards are visually differentiated by a subtle accent:
- Video: blue accent
- Game: green accent
- Quiz: purple accent

This should be implemented with a class modifier:
- `.lesson-card--video`
- `.lesson-card--game`
- `.lesson-card--quiz`

---

## CSS Requirements
Add CSS that works well on a dark background.

### Card Base Styles
Implement these:
- rounded corners (`border-radius: 18-22px`)
- soft shadow (no harsh outlines)
- subtle border (e.g. `rgba(255,255,255,0.06)`)

### Thumbnail Styles
- large, wide rectangle (16:9-ish)
- `overflow:hidden`, rounded corners
- overlay icon centered (play icon for video, controller for game, checklist for quiz)
- slight hover lift: transform translateY(-2px)

### Responsive Grid
Replace current single left-aligned stack with a grid:

- On large screens: `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));`
- Gap: 18–24px
- Center content within container.

---

## Implementation Steps (Do in order)
### Step 1 — Locate Rendering
Find where cards are built:
- Search for `"Step 1 Videos"`, `"Step 1 Quizzes"`, or for existing card class names.
- Identify the function that maps lesson items into DOM.
- You will replace the innerHTML/template used for each lesson item.

### Step 2 — Create a Single Renderer
Create one function:

```js
function renderLessonCard(lesson) { ... return element; }
```

Inputs:
- `lesson.title`
- `lesson.type` (`"video" | "game" | "quiz"`)
- `lesson.thumbnail` (fallback to a default image)
- `lesson.difficulty` (optional)
- `lesson.duration` (optional)
- `lesson.id` or route info (for Start/Watch/Play actions)

The renderer should:
- apply `lesson-card--${lesson.type}`
- set the icon + CTA label based on type
- bind click handlers:
  - clicking thumb should do same thing as CTA
  - pressing Enter/Space on thumb triggers same action

### Step 3 — Update the Step Sections
Currently you show:
- Step X Videos
- Step X Quizzes

Instead:
- Keep the section headers (Step 1, Step 2)
- Within each step, render one **grid** containing mixed content types, in an intentional order:
  1. Video
  2. Game (if present)
  3. Quiz

If you must keep separate “Videos/Quizzes” headers, still render with the same card component.

### Step 4 — Fix Button/Action Logic
Your current UI shows multiple buttons (e.g., Start + Watch Video). Remove duplicates:
- Video card: button label = **Watch**
- Quiz card: button label = **Start**
- Game card: button label = **Play**

If a quiz has an associated “Watch video” link, include it as a **small secondary text link** under the meta row (not as a second big button).

Example:
```html
<a class="lesson-link" href="...">Watch the related video</a>
```

### Step 5 — Replace Placeholder Thumbnails
In the screenshot, thumbnails are broken. Add a robust fallback:
- if `lesson.thumbnail` missing, use a default:
  - `/assets/img/thumb_video_default.png`
  - `/assets/img/thumb_quiz_default.png`
  - `/assets/img/thumb_game_default.png`

If those don’t exist, create them or use a gradient placeholder (CSS).

### Step 6 — Visual Polish
- Ensure typography is consistent with the rest of the app.
- Title: 18–22px, semibold
- Type label: smaller, muted
- Button: pill shape, aligned bottom-right or full-width (choose one; default: bottom-right like concept art)

---

## Acceptance Checklist
A change is “done” when:
- Cards look like the provided concept art (thumbnail dominates)
- Video/Game/Quiz are visually distinct but consistent
- Only one primary CTA button per card
- Hover and focus states work
- Layout adapts from mobile (1 column) to desktop (grid)
- Existing lesson start flows still work

---

## Guardrails
- Do not rewrite unrelated parts of the page.
- Do not change underlying lesson progression rules.
- Do not introduce a new framework.
- Keep all existing logic for “Start lesson” intact; just rewire it to the new buttons/thumb click.

---

## If You Need Clarifying Data From Code
Before coding, print (in console or log) a sample lesson object structure so you map fields correctly:
- `console.log("Lesson sample:", lesson);`

Then adapt rendering to the actual keys.

---

## Suggested Class Names (Use these)
- `.lesson-grid`
- `.lesson-card`
- `.lesson-card__header`, `__title`, `__type`
- `.lesson-card__thumb`, `__overlay`, `__overlay-icon`
- `.lesson-card__meta`
- `.lesson-btn`, `.lesson-btn--primary`
- `.lesson-link` (small secondary link)
- modifiers: `.lesson-card--video`, `--game`, `--quiz`

---

## Deliverable
Implement:
1) Updated HTML/JS rendering in `subtree_node.html` (or its JS module)
2) CSS appended to the subtree stylesheet (or in a `<style>` block if that’s how the project is structured)

Keep changes readable and easy to iterate on.
