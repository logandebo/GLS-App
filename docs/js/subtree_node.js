import { ensureActiveUserOrRedirect, getActiveUsername } from './storage.js';
import { getOrCreateDefaultProfile } from './user.js';
import { renderToast } from './ui.js';
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadPublicConcepts } from './contentLoader.js';
import { loadPublicCatalog, getQueryParam, incrementMetric, refreshPublicCatalogFromCloud } from './catalogStore.js';
import { getCourseById, getCourseBySlug, listConcepts } from './dataStore.js';
import { loadLessons, getLessonsForConcept, getAllLessons } from './lessons.js';
import { loadUserTreeProgress, markNodeTouched, setLastNode } from './userTreeProgress.js';

let _masterIndex = null;
let _combinedIndex = null; // master + public concepts from Supabase

(function initHeader(){
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function init(){
  console.log('[subtree_node] INIT START');
  // Changed: Allow guest access, don't require auth
  const username = getActiveUsername();
  console.log('[subtree_node] Username:', username || 'guest');
  await loadGraphStore();
  const nodes = gsGetAllNodes();
  console.log('[subtree_node] Master nodes loaded:', nodes.length);
  _masterIndex = new Map(nodes.map(n => [n.id, n]));
  
  // Load all concepts from Supabase (returns all published concepts)
  const mergedById = new Map(nodes.map(n => [n.id, n]));
  try {
    console.log('[subtree_node] Loading concepts from Supabase...');
    const { concepts } = await listConcepts();
    console.log('[subtree_node] Loaded concepts:', concepts ? concepts.length : 0);
    if (Array.isArray(concepts)) {
      concepts.forEach(c => {
        if (c && c.id && !mergedById.has(c.id)) {
          console.log('[subtree_node] Adding concept to index:', c.id, c.title);
          mergedById.set(c.id, c);
        }
      });
    }
  } catch (e) {
    console.error('[subtree_node] Failed to load concepts from Supabase:', e);
    // Fallback to localStorage if Supabase fails
    const publicConcepts = loadPublicConcepts();
    Object.keys(publicConcepts || {}).forEach(id => {
      const c = publicConcepts[id];
      if (c && c.id && !mergedById.has(c.id)) mergedById.set(c.id, c);
    });
  }
  _combinedIndex = mergedById;
  console.log('[subtree_node] Total concepts in index:', _combinedIndex.size);
  console.log('[subtree_node] Concept IDs:', Array.from(_combinedIndex.keys()));

  const treeId = getQueryParam('treeId');
  const conceptId = getQueryParam('conceptId');
  console.log('[subtree_node] URL params - treeId:', treeId, 'conceptId:', conceptId);
  if (!treeId || !conceptId){ 
    console.error('[subtree_node] Missing params - treeId:', treeId, 'conceptId:', conceptId);
    renderToast('Missing tree or concept context', 'error'); 
    return; 
  }
  // Ensure local catalog cache is hydrated from Supabase for deep links
  console.log('[subtree_node] Refreshing catalog from cloud...');
  try { 
    await refreshPublicCatalogFromCloud(); 
    console.log('[subtree_node] Catalog refresh complete');
  } catch (e) {
    console.error('[subtree_node] Catalog refresh failed:', e);
  }
  const catalog = loadPublicCatalog();
  console.log('[subtree_node] Catalog loaded, courses:', catalog ? catalog.length : 0);
  let tree = catalog.find(t => t.id === treeId);
  console.log('[subtree_node] Tree found in catalog:', !!tree);
  // Fallback: fetch from Supabase directly and normalize if not cached
  if (!tree) {
    console.log('[subtree_node] Tree not in catalog, fetching from Supabase...');
    try {
      let course = null;
      if (treeId) {
        console.log('[subtree_node] Calling getCourseById with treeId:', treeId);
        const res = await getCourseById(treeId);
        console.log('[subtree_node] getCourseById result:', res);
        course = res.course;
      }
      // Optional slug fallback
      if (!course) {
        const slug = getQueryParam('slug');
        if (slug) {
          const res = await getCourseBySlug(slug);
          course = res.course;
        }
      }
      if (course && course.tree_json) {
        const row = course;
        const t = row.tree_json || {};
        const nlist = Array.isArray(t.nodes) ? t.nodes.map(n => ({
          conceptId: n.conceptId,
          nextIds: Array.isArray(n.nextIds) ? n.nextIds.slice() : [],
          ...(Array.isArray(n.subtreeLessonIds) ? { subtreeLessonIds: n.subtreeLessonIds.slice() } : {}),
          ...(n.subtreeLessonSteps && typeof n.subtreeLessonSteps === 'object' ? { subtreeLessonSteps: { ...n.subtreeLessonSteps } } : {}),
          ...(n.ui ? { ui: { x: Number(n.ui.x)||0, y: Number(n.ui.y)||0 } } : {}),
          unlockConditions: {
            requiredConceptIds: Array.isArray(n.unlockConditions?.requiredConceptIds) ? n.unlockConditions.requiredConceptIds.slice() : [],
            minBadge: n.unlockConditions?.minBadge || 'none',
            ...(n.unlockConditions?.customRuleId ? { customRuleId: n.unlockConditions.customRuleId } : {})
          }
        })) : [];
        tree = {
          id: row.id,
          title: t.title || row.title || 'Untitled Tree',
          description: t.description || '',
          creatorId: t.creatorId || 'unknown',
          primaryDomain: t.primaryDomain || 'general',
          tags: Array.isArray(t.tags) ? t.tags.slice() : [],
          rootConceptId: t.rootConceptId || '',
          introVideoUrl: t.introVideoUrl || '',
          ui: { layoutMode: (t.ui && t.ui.layoutMode) ? String(t.ui.layoutMode) : 'top-down' },
          nodes: nlist,
          version: Number.isFinite(t.version) ? t.version : 1,
          createdAt: t.createdAt || row.created_at || new Date().toISOString(),
          updatedAt: t.updatedAt || row.created_at || new Date().toISOString()
        };
        console.log('[subtree_node] Tree constructed from course:', tree.id, tree.title);
      }
    } catch (e) {
      console.error('[subtree_node] Error fetching/constructing tree:', e);
    }
  }
  if (!tree){ 
    console.error('[subtree_node] Tree not found after all attempts - treeId:', treeId);
    renderToast('Course not found or unpublished', 'error'); 
    return; 
  }
  console.log('[subtree_node] Tree loaded successfully:', tree.title);
  console.log('[subtree_node] Looking up concept with ID:', conceptId);
  console.log('[subtree_node] _combinedIndex has', _combinedIndex.size, 'concepts');
  console.log('[subtree_node] Available concept IDs:', Array.from(_combinedIndex.keys()));
  const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId);
  console.log('[subtree_node] Concept lookup result:', concept ? `Found: ${concept.title || concept.id}` : 'NOT FOUND');
  if (!concept){ 
    console.error('[subtree_node] CONCEPT NOT FOUND - conceptId:', conceptId);
    console.error('[subtree_node] _combinedIndex keys:', Array.from(_combinedIndex.keys()));
    console.error('[subtree_node] _masterIndex keys:', Array.from(_masterIndex.keys()));
    renderToast('Concept not found', 'error'); 
    return; 
  }
  // Set Back to Course to return to the subtree page for this course
  const back = document.getElementById('backToCourse');
  if (back) back.href = `subtree.html?treeId=${encodeURIComponent(treeId)}`;
  console.log('[subtree_node] Back button set to subtree.html');
  // Populate concept title in header
  const titleEl = document.getElementById('conceptTitle');
  if (titleEl) titleEl.textContent = (concept.title || concept.id || 'Concept');
  console.log('[subtree_node] Title element set:', titleEl ? titleEl.textContent : 'NOT FOUND');
  console.log('[subtree_node] Calling renderSubtreeLessons...');
  await renderSubtreeLessons(tree, conceptId);
  console.log('[subtree_node] Calling renderAllLessons...');
  await renderAllLessons(conceptId);
  console.log('[subtree_node] INIT COMPLETE');
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
  console.log('[renderSubtreeLessons] START - tree:', tree.id, 'conceptId:', conceptId);
  try {
    console.log('[renderSubtreeLessons] Loading lessons...');
    await loadLessons();
    const all = getLessonsForConcept(conceptId) || [];
    console.log('[renderSubtreeLessons] Lessons for concept:', all.length);
    const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId) || {};
    // Subtree-specific selection: if tree nodes include explicit subtreeLessonIds for this concept, use them; otherwise fall back to creator-authored lessons
    const node = (Array.isArray(tree.nodes) ? tree.nodes : []).find(n => n.conceptId === conceptId) || null;
    console.log('[renderSubtreeLessons] Node found:', !!node, 'has subtreeLessonIds:', node?.subtreeLessonIds?.length || 0);
    let mine = [];
    if (node && Array.isArray(node.subtreeLessonIds) && node.subtreeLessonIds.length){
      console.log('[renderSubtreeLessons] Using explicit subtreeLessonIds:', node.subtreeLessonIds);
      const allLessons = getAllLessons();
      const byId = new Map(allLessons.map(l => [l.id, l]));
      mine = node.subtreeLessonIds.map(id => byId.get(id)).filter(Boolean);
    } else {
      console.log('[renderSubtreeLessons] Using creator-authored lessons, creatorId:', tree.creatorId);
      mine = all.filter(l => String(l.createdBy || '') === String(tree.creatorId || ''));
    }
    console.log('[renderSubtreeLessons] Filtered lessons:', mine.length);
    const list = document.getElementById('subtreeLessonsList');
    const empty = document.getElementById('subtreeLessonsEmpty');
    console.log('[renderSubtreeLessons] List element:', !!list, 'Empty element:', !!empty);
    list.innerHTML = '';
    if (!mine.length){ 
      console.log('[renderSubtreeLessons] No lessons found, showing empty state');
      empty.classList.remove('hidden'); 
      return; 
    } else { 
      empty.classList.add('hidden'); 
    }
    console.log('[renderSubtreeLessons] Rendering', mine.length, 'lesson cards...');
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
  console.log('[renderAllLessons] START - conceptId:', conceptId);
  try {
    console.log('[renderAllLessons] Loading lessons...');
    await loadLessons();
    const all = getLessonsForConcept(conceptId) || [];
    console.log('[renderAllLessons] Total lessons for concept:', all.length);
    const concept = _combinedIndex.get(conceptId) || _masterIndex.get(conceptId) || {};
    const list = document.getElementById('allLessonsList');
    const empty = document.getElementById('allLessonsEmpty');
    console.log('[renderAllLessons] List element:', !!list, 'Empty element:', !!empty);
    list.innerHTML = '';
    if (!all.length){ 
      console.log('[renderAllLessons] No lessons, showing empty state');
      empty.classList.remove('hidden'); 
      return; 
    } else { 
      empty.classList.add('hidden'); 
    }
    console.log('[renderAllLessons] Rendering', all.length, 'lesson cards...');
    // Debug: inspect lesson object structure for mapping
    try { console.debug('All lessons sample:', all[0]); } catch {}

    // Use unified lesson grid and card renderer
    list.className = 'lesson-grid';
    all.forEach(l => {
      const el = renderLessonCard(l, { conceptThumbnail: concept.thumbnail, originContext: { conceptId } });
      list.appendChild(el);
    });
    console.log('[renderAllLessons] COMPLETE - rendered', all.length, 'cards');
  } catch (e) { 
    console.error('[renderAllLessons] ERROR:', e);
    console.error('[renderAllLessons] Stack:', e.stack);
  }
}
