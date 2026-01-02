import { ensureActiveUserOrRedirect, getActiveUsername } from './storage.js';
import { getOrCreateDefaultProfile } from './user.js';
import { renderToast } from './ui.js';
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadPublicConcepts } from './contentLoader.js';
import { loadPublicCatalog, getQueryParam, incrementMetric } from './catalogStore.js';
import { loadLessons, getLessonsForConcept, getAllLessons } from './lessons.js';
import { loadUserTreeProgress, markNodeTouched, setLastNode } from './userTreeProgress.js';

let _masterIndex = null;
let _combinedIndex = null; // master + public concepts

(function initHeader(){
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function init(){
  const ok = ensureActiveUserOrRedirect();
  if (!ok) return;
  await loadGraphStore();
  const nodes = gsGetAllNodes();
  _masterIndex = new Map(nodes.map(n => [n.id, n]));
  const publicConcepts = loadPublicConcepts();
  const mergedById = new Map(nodes.map(n => [n.id, n]));
  Object.keys(publicConcepts || {}).forEach(id => {
    const c = publicConcepts[id];
    if (c && c.id && !mergedById.has(c.id)) mergedById.set(c.id, c);
  });
  _combinedIndex = mergedById;

  const treeId = getQueryParam('treeId');
  const conceptId = getQueryParam('conceptId');
  if (!treeId || !conceptId){ renderToast('Missing tree or concept context', 'error'); return; }
  const catalog = loadPublicCatalog();
  const tree = catalog.find(t => t.id === treeId);
  if (!tree){ renderToast('Course not found or unpublished', 'error'); return; }
  const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId);
  if (!concept){ renderToast('Concept not found', 'error'); return; }
  // Set Back to Course to return to the subtree page for this course
  const back = document.getElementById('backToCourse');
  if (back) back.href = `subtree.html?treeId=${encodeURIComponent(treeId)}`;
  // Populate concept title in header
  const titleEl = document.getElementById('conceptTitle');
  if (titleEl) titleEl.textContent = (concept.title || concept.id || 'Concept');
  await renderSubtreeLessons(tree, conceptId);
  await renderAllLessons(conceptId);
})();

// Concept header and Next Steps panel removed from this page per design update.

// --- Card rendering helpers (unified lesson card) ---
function normalizeType(t){
  const m = String(t||'').toLowerCase();
  if (m === 'unity_game' || m === 'game') return 'game';
  if (m === 'video') return 'video';
  if (m === 'quiz') return 'quiz';
  if (m === 'article') return 'article';
  return 'lesson';
}

function ctaLabelFor(type){
  const m = normalizeType(type);
  if (m === 'video') return 'Watch';
  if (m === 'game') return 'Play';
  if (m === 'quiz') return 'Start';
  if (m === 'article') return 'Read';
  return 'Start';
}

function typeIconFor(type){
  const m = normalizeType(type);
  if (m === 'video') return '▶';
  if (m === 'game') return '🕹️';
  if (m === 'quiz') return '✔';
  if (m === 'article') return '✎';
  return '★';
}

function defaultThumbFor(type){
  const m = normalizeType(type);
  // Prefer type-specific defaults under DefaultThumbnails, else generic thumb
  // Note: using provided filenames in DefaultThumbnails folder
  if (m === 'video') return 'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_52_10 PM.png';
  if (m === 'game') return 'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_53_00 PM.png';
  if (m === 'quiz') return 'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_54_12 PM.png';
  return 'assets/img/thumb_default.png';
}

function onThumbKeyActivate(evt, action){
  const k = evt.key || evt.code;
  if (k === 'Enter' || k === 'Space' || k === ' ') {
    evt.preventDefault();
    if (typeof action === 'function') action();
  }
}

function renderLessonCard(lesson, opts={}){
  // Inputs: lesson fields and optional relatedVideo for quizzes
  const {
    relatedVideo,
    conceptThumbnail,
    originContext,
    useSubtreeLessonPage
  } = opts;

  const type = normalizeType(lesson.type);
  const ctaLabel = ctaLabelFor(type);
  const typeIcon = typeIconFor(type);
  const minutes = lesson.minutes || lesson.duration || null;
  const difficulty = String(lesson.difficulty || '').trim();
  const thumbSrc = lesson.thumbnail || conceptThumbnail || defaultThumbFor(type);
  let href = `lesson.html?lessonId=${encodeURIComponent(lesson.id)}`;
  if (useSubtreeLessonPage && originContext && originContext.treeId && originContext.conceptId){
    href = `lesson_subtree.html?lessonId=${encodeURIComponent(lesson.id)}&treeId=${encodeURIComponent(originContext.treeId)}&conceptId=${encodeURIComponent(originContext.conceptId)}`;
  }

  const card = document.createElement('div');
  card.className = `lesson-card lesson-card--${type}`;

  // Header
  const header = document.createElement('div');
  header.className = 'lesson-card__header';
  const titleEl = document.createElement('div');
  titleEl.className = 'lesson-card__title';
  titleEl.textContent = lesson.title || lesson.id;
  const typeEl = document.createElement('div');
  typeEl.className = 'lesson-card__type';
  const typeText = document.createElement('span'); typeText.className='lesson-card__type-text'; typeText.textContent = (type.charAt(0).toUpperCase()+type.slice(1));
  const typeIconEl = document.createElement('span'); typeIconEl.className='lesson-card__type-icon'; typeIconEl.setAttribute('aria-hidden','true'); typeIconEl.textContent = typeIcon;
  // Completion indicator: show ✓ when this lesson is completed for the concept
  let isCompleted = false;
  try {
    const cid = originContext && originContext.conceptId ? originContext.conceptId : null;
    if (cid){
      const prof = getOrCreateDefaultProfile();
      const done = new Set(((prof && prof.conceptProgress && prof.conceptProgress[cid] && prof.conceptProgress[cid].completedLessonIds) || []));
      isCompleted = done.has(lesson.id);
    }
  } catch { /* ignore */ }
  typeEl.appendChild(typeText); typeEl.appendChild(typeIconEl);
  header.appendChild(titleEl); header.appendChild(typeEl);
  card.appendChild(header);

  // Thumb
  const thumb = document.createElement('div');
  thumb.className = 'lesson-card__thumb';
  thumb.setAttribute('role', 'button');
  thumb.setAttribute('tabindex', '0');
  thumb.setAttribute('aria-label', `Open ${type} lesson`);
  const img = document.createElement('img');
  img.alt = 'Lesson thumbnail';
  img.src = thumbSrc;
  // Two-tier fallback: first type-specific default, then generic
  img.onerror = () => {
    const typeDefault = defaultThumbFor(type);
    const generic = 'assets/img/thumb_default.png';
    if (img.src !== typeDefault) {
      img.src = typeDefault;
    } else if (img.src !== generic) {
      img.src = generic;
      img.onerror = null;
    } else {
      img.onerror = null;
    }
  };
  const overlay = document.createElement('div'); overlay.className = 'lesson-card__overlay';
  const overlayIcon = document.createElement('div'); overlayIcon.className = 'lesson-card__overlay-icon'; overlayIcon.textContent = typeIconFor(type);
  overlay.appendChild(overlayIcon);
  thumb.appendChild(img);
  thumb.appendChild(overlay);
  card.appendChild(thumb);

  // Meta row
  const meta = document.createElement('div'); meta.className = 'lesson-card__meta';
  if (difficulty){ const pill = document.createElement('span'); pill.className='lesson-pill'; pill.textContent = difficulty; meta.appendChild(pill); }
  if (minutes){ const dot = document.createElement('span'); dot.className='lesson-meta-dot'; dot.textContent = '•'; meta.appendChild(dot); const mt = document.createElement('span'); mt.className='lesson-meta-text'; mt.textContent = `~${minutes} min`; meta.appendChild(mt); }
  card.appendChild(meta);

  // Optional small secondary link under meta for quiz with related video
  if (type === 'quiz' && relatedVideo && relatedVideo.id){
    const link = document.createElement('a');
    link.className = 'lesson-link';
    link.textContent = 'Watch the related video';
    link.href = `lesson.html?lessonId=${encodeURIComponent(relatedVideo.id)}`;
    card.appendChild(link);
  }

  // Footer (status label + primary CTA)
  const footer = document.createElement('div'); footer.className = 'lesson-card__footer';
  // Bottom-left completion status label
  const statusEl = document.createElement('span');
  statusEl.textContent = isCompleted ? 'Completed' : 'Uncomplete';
  statusEl.setAttribute('aria-live','polite');
  statusEl.style.display = 'inline-flex';
  statusEl.style.alignItems = 'center';
  statusEl.style.padding = '0.25rem 0.5rem';
  statusEl.style.borderRadius = '12px';
  statusEl.style.background = isCompleted ? '#16a34a' : '#6b7280';
  statusEl.style.color = '#fff';
  statusEl.style.marginRight = 'auto';
  footer.style.display = 'flex';
  footer.style.alignItems = 'center';
  footer.appendChild(statusEl);
  const btn = document.createElement('a');
  btn.className = 'lesson-btn lesson-btn--primary';
  btn.textContent = ctaLabel;
  btn.href = href;
  footer.appendChild(btn);
  card.appendChild(footer);

  // Bind actions: thumb triggers same as CTA
  const go = () => { window.location.href = href; };
  thumb.addEventListener('click', go);
  thumb.addEventListener('keydown', (e) => onThumbKeyActivate(e, go));

  return card;
}

async function renderSubtreeLessons(tree, conceptId){
  try {
    await loadLessons();
    const all = getLessonsForConcept(conceptId) || [];
    const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId) || {};
    // Subtree-specific selection: if tree nodes include explicit subtreeLessonIds for this concept, use them; otherwise fall back to creator-authored lessons
    const node = (Array.isArray(tree.nodes) ? tree.nodes : []).find(n => n.conceptId === conceptId) || null;
    let mine = [];
    if (node && Array.isArray(node.subtreeLessonIds) && node.subtreeLessonIds.length){
      const allLessons = getAllLessons();
      const byId = new Map(allLessons.map(l => [l.id, l]));
      mine = node.subtreeLessonIds.map(id => byId.get(id)).filter(Boolean);
    } else {
      mine = all.filter(l => String(l.createdBy || '') === String(tree.creatorId || ''));
    }
    const list = document.getElementById('subtreeLessonsList');
    const empty = document.getElementById('subtreeLessonsEmpty');
    list.innerHTML = '';
    if (!mine.length){ empty.classList.remove('hidden'); return; } else { empty.classList.add('hidden'); }
    // Debug: inspect lesson object structure for mapping
    try { console.debug('Subtree lessons sample:', mine[0]); } catch {}
    // Group by step from published mapping (default step 1 if none assigned)
    const stepMap = (node && node.subtreeLessonSteps && typeof node.subtreeLessonSteps==='object') ? node.subtreeLessonSteps : {};
    const grouped = new Map(); // step -> { videos:[], quizzes:[], games:[], articles:[], other:[] }
    function bucketFor(step){
      const s = Number(step)||1;
      if (!grouped.has(s)) grouped.set(s, { videos:[], quizzes:[], games:[], articles:[], other:[] });
      return grouped.get(s);
    }
    mine.forEach(l => {
      const s = stepMap[l.id] || 1;
      const b = bucketFor(s);
      const t = String(l.type||'').toLowerCase();
      if (t === 'video') b.videos.push(l);
      else if (t === 'quiz') b.quizzes.push(l);
      else if (t === 'unity_game') b.games.push(l);
      else if (t === 'article') b.articles.push(l);
      else b.other.push(l);
    });

    const sortedSteps = Array.from(grouped.keys()).sort((a,b)=>a-b);
    sortedSteps.forEach(stepNum => {
      const grp = grouped.get(stepNum);
      const stepSection = document.createElement('section'); stepSection.className='card subtle'; stepSection.style.marginBottom='0.75rem';
      const h = document.createElement('h4'); h.textContent = `Step ${stepNum}`; stepSection.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'lesson-grid';

      const ordered = [];
      (grp.videos||[]).forEach(l => ordered.push(l));
      (grp.games||[]).forEach(l => ordered.push(l));
      (grp.quizzes||[]).forEach(l => ordered.push(l));
      (grp.articles||[]).forEach(l => ordered.push(l));
      (grp.other||[]).forEach(l => ordered.push(l));

      const relatedVideo = (grp.videos && grp.videos.length) ? grp.videos[0] : null;
      ordered.forEach(l => {
        const cardEl = renderLessonCard(l, { relatedVideo, conceptThumbnail: concept.thumbnail, originContext: { treeId: (tree && tree.id) || null, conceptId }, useSubtreeLessonPage: true });
        grid.appendChild(cardEl);
      });

      stepSection.appendChild(grid);
      list.appendChild(stepSection);
    });
  } catch { /* ignore */ }
}

async function renderAllLessons(conceptId){
  try {
    await loadLessons();
    const all = getLessonsForConcept(conceptId) || [];
    const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId) || {};
    const list = document.getElementById('allLessonsList');
    const empty = document.getElementById('allLessonsEmpty');
    list.innerHTML = '';
    if (!all.length){ empty.classList.remove('hidden'); return; } else { empty.classList.add('hidden'); }
    // Debug: inspect lesson object structure for mapping
    try { console.debug('All lessons sample:', all[0]); } catch {}

    // Use unified lesson grid and card renderer
    list.className = 'lesson-grid';
    all.forEach(l => {
      const el = renderLessonCard(l, { conceptThumbnail: concept.thumbnail, originContext: { conceptId } });
      list.appendChild(el);
    });
  } catch { /* ignore */ }
}
