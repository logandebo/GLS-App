// Demo mode disabled on homepage; header and personalization rely on Supabase session only.
// Retain storage imports commented for potential future use.
import { /* getActiveUsername, getActiveProfile, migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, setActiveUsername */ } from './storage.js';
import { loadPublicCatalog, loadTreeMetrics, savePublicCatalog, saveTreeMetrics } from './catalogStore.js';
import { loadAllLessons } from './contentLoader.js';
import { loadUserTreeProgress } from './userTreeProgress.js';
import { loadUserPreferences } from './preferences.js';
import { renderToast } from './ui.js';

// Header controls are fully managed by headerControls.js

let _allLessons = [];
let _catalog = [];
let _metrics = {};
let _liveUserId = null;

async function resolveLiveUserId(){
  try {
    const sb = window.supabaseClient;
    if (sb && sb.isConfigured && sb.isConfigured()){
      const { data } = await sb.getSession();
      const user = data && data.session ? data.session.user : null;
      if (user){
        const meta = (user.user_metadata || {});
        const fallback = (user.email||'').split('@')[0] || '';
        const liveName = [meta.full_name, meta.preferred_username, meta.username, meta.name]
          .find(v => typeof v === 'string' && v.trim()) || fallback;
        return liveName || null;
      }
    }
  } catch {}
  return null;
}

(async function init(){
  const loading = document.getElementById('loading-state');
  try {
    // Wait briefly for Supabase session hydration after navigation
    try {
      if (window.supabaseClient && window.supabaseClient.isConfigured()) {
        const ok = await window.supabaseClient.waitForSessionReady(2500, 150);
        try { console.log(`[DEBUG] home.init: sessionReady=${ok}`); } catch {}
      }
    } catch {}
    // Determine live user id if signed in (no demo fallback)
    _liveUserId = await resolveLiveUserId();
    // Homepage is accessible when logged out; do not enforce demo or redirect.
    _catalog = loadPublicCatalog();
    // If no published catalog exists on this origin, seed with a small default
    if (!_catalog.length) {
      try {
        const sampleTree = {
          id: 'demo.music_scales',
          title: 'Music Scales Basics',
          description: 'A quick sampler course with two scale concepts.',
          creatorId: 'demo',
          primaryDomain: 'music',
          tags: ['beginner','music','scales'],
          ui: { layoutMode: 'top-down' },
          nodes: [
            { conceptId: 'music.c_major_scale', nextIds: ['music.g_major_scale'], ui: { x: 0, y: 0 }, unlockConditions: { requiredConceptIds: [], minBadge: 'none' } },
            { conceptId: 'music.g_major_scale', nextIds: [], ui: { x: 1, y: 0 }, unlockConditions: { requiredConceptIds: [], minBadge: 'none' } }
          ],
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        savePublicCatalog([sampleTree]);
        const metrics = loadTreeMetrics();
        metrics[sampleTree.id] = { views: 0, starts: 0, completions: 0 };
        saveTreeMetrics(metrics);
        _catalog = loadPublicCatalog();
      } catch (e) {
        console.warn('Seeding default catalog failed', e);
      }
    }
    _metrics = loadTreeMetrics();
    initHero();
    // Render immediately based on catalog; do not block on lessons
    renderFeaturedCourses();
    renderPersonalized();
    initSearchExplore();
    // Header is driven by sessionBadge.js; no manual text here
    // Load lessons in background; enhance cards when available
    try {
      _allLessons = await loadAllLessons();
      renderFeaturedCourses();
      // Ensure personalized sections use lesson data for chips/progress
      renderPersonalized();
    } catch (e){
      console.warn('Optional lessons load failed; continuing without counts', e);
    }
    // Live updates for published trees and metrics
    window.addEventListener('storage', (e) => {
      if (e.key === 'gep_publicCreatorTrees' || e.key === 'gep_treeMetrics') {
        _catalog = loadPublicCatalog();
        _metrics = loadTreeMetrics();
        renderFeaturedCourses();
        renderPersonalized();
      }
    });
    renderToast('Welcome to your learning hub', 'info');
  } catch (e) {
    console.error('Homepage init failed', e);
    renderToast('Failed to load homepage data', 'error');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
})();
function initHero(){
  const startBtn = document.getElementById('startLearningBtn');
  if (!startBtn) return;
  startBtn.addEventListener('click', () => {
    const top = pickFeatured(_catalog)[0];
    if (top) window.location.href = `subtree.html?treeId=${encodeURIComponent(top.id)}`;
    else window.location.href = 'courses.html';
  });
}

function pickFeatured(catalog){
  const items = Array.isArray(catalog) ? catalog.slice() : [];
  items.sort((a,b) => {
    const ma = _metrics[a.id] || { views:0 };
    const mb = _metrics[b.id] || { views:0 };
    return (mb.views||0) - (ma.views||0);
  });
  return items.slice(0, 6);
}

function lessonTypeCountsForTree(tree){
  const ids = new Set();
  (tree.nodes||[]).forEach(n => {
    (n.subtreeLessonIds||[]).forEach(id => ids.add(id));
    Object.keys(n.subtreeLessonSteps||{}).forEach(id => ids.add(id));
  });
  let video=0, game=0, quiz=0, external=0;
  ids.forEach(id => {
    const l = _allLessons.find(x => x.id === id);
    if (!l) return;
    const t = String(l.type || '').toLowerCase();
    if (t === 'video') video += 1;
    else if (t === 'unity_game' || t === 'game') game += 1;
    else if (t === 'quiz') quiz += 1;
    else if (t === 'external_link' || t === 'external' || t === 'link') external += 1;
  });
  return { video, game, quiz, external };
}

function estimateTotalMinutesForTree(tree){
  const ids = new Set();
  (tree.nodes||[]).forEach(n => {
    (n.subtreeLessonIds||[]).forEach(id => ids.add(id));
    Object.keys(n.subtreeLessonSteps||{}).forEach(id => ids.add(id));
  });
  let sum = 0;
  ids.forEach(id => {
    const l = _allLessons.find(x => x.id === id);
    if (l && Number.isFinite(Number(l.minutes))) sum += Number(l.minutes);
  });
  return sum;
}

function renderFeaturedCourses(){
  const grid = document.getElementById('featured-courses-grid');
  const empty = document.getElementById('featured-courses-empty');
  if (!grid) return;
  grid.innerHTML = '';
  const featured = pickFeatured(_catalog);
  if (!featured.length){ empty?.classList.remove('hidden'); return; } else { empty?.classList.add('hidden'); }
  featured.forEach(tree => grid.appendChild(createCourseCard(tree)));
}

function createCourseCard(tree){
  const card = document.createElement('div');
  card.className = 'card course-card';
  // Thumbnail
  const thumb = document.createElement('div'); thumb.className = 'course-card__thumb';
  const img = document.createElement('img');
  img.src = getCourseThumbnailUrl(tree);
  img.loading = 'lazy';
  img.alt = `${tree.title || tree.id} thumbnail`;
  thumb.appendChild(img);
  card.appendChild(thumb);
  // Body
  const body = document.createElement('div'); body.className = 'course-card__body';
  const h = document.createElement('h3'); h.className = 'course-card__title'; h.textContent = tree.title || tree.id; body.appendChild(h);
  // Publisher/Creator label
  const publisher = String(tree.creatorName || tree.creatorId || tree.publishedBy || '').trim();
  if (publisher){
    const by = document.createElement('div');
    by.className = 'meta';
    by.textContent = `by ${publisher}`;
    body.appendChild(by);
  }
  const p = document.createElement('p'); p.className = 'short'; p.textContent = tree.description || ''; body.appendChild(p);
  const counts = lessonTypeCountsForTree(tree);
  const meta = document.createElement('div'); meta.className = 'course-card__icons';
  meta.innerHTML = `${counts.video ? `<span class="chip">🎥 ${counts.video}</span>` : ''} ${counts.game ? `<span class="chip">🎮 ${counts.game}</span>` : ''} ${counts.quiz ? `<span class="chip">❓ ${counts.quiz}</span>` : ''} ${counts.external ? `<span class="chip">🔗 ${counts.external}</span>` : ''}`.trim();
  body.appendChild(meta);
  const est = estimateTotalMinutesForTree(tree);
  if (est){ const m = document.createElement('div'); m.className='meta'; m.textContent = `${tree.primaryDomain || 'general'} · ~${est} min`; body.appendChild(m); }
  const progBar = document.createElement('div'); progBar.className = 'course-progress';
  const progInner = document.createElement('div'); progInner.className = 'course-progress__bar';
  const { percent } = getCourseCompletionPercent(tree);
  progInner.style.width = `${percent}%`; progBar.appendChild(progInner); body.appendChild(progBar);
  const actions = document.createElement('div'); actions.className = 'actions';
  const open = document.createElement('a'); open.className = 'btn'; open.href = `subtree.html?treeId=${encodeURIComponent(tree.id)}`; open.textContent = percent > 0 ? 'Continue' : 'Start';
  actions.appendChild(open);
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function getCourseThumbnailUrl(tree){
  const explicit = tree.thumbnailUrl || (tree.ui && tree.ui.thumbnailUrl);
  if (explicit) return explicit;
  const defaults = [
    'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_52_10 PM.png',
    'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_53_00 PM.png',
    'assets/img/DefaultThumbnails/ChatGPT Image Dec 28, 2025, 04_54_12 PM.png'
  ];
  const key = (tree.primaryDomain || tree.title || tree.id || 'x') + '::' + (tree.tags||[]).join('|');
  let hash = 0;
  for (let i=0;i<key.length;i++){ hash = ((hash<<5)-hash) + key.charCodeAt(i); hash |= 0; }
  const idx = Math.abs(hash) % defaults.length;
  return defaults[idx];
}

function getCourseProgressPercent(treeId, nodes){
  const userId = _liveUserId;
  if (!userId) return { percent: 0, touched: 0, total: Array.isArray(nodes)?nodes.length:0 };
  const data = loadUserTreeProgress(userId);
  const entry = data[treeId] || { touchedNodeIds: [] };
  const touched = new Set(entry.touchedNodeIds || []);
  const total = Array.isArray(nodes) ? nodes.length : 0;
  const percent = total ? Math.round((touched.size / total) * 100) : 0;
  return { percent, touched: touched.size, total };
}

// New: completion-based percent excluding games for homepage course cards
function getCourseCompletionPercent(tree){
  try {
    const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
    const total = nodes.length;
    if (!total) return { percent: 0, completed: 0, total: 0 };
    const userId = _liveUserId;
    if (!userId) return { percent: 0, completed: 0, total };
    const data = loadUserTreeProgress(userId);
    const entry = data[tree.id] || { touchedNodeIds: [] };
    const touched = new Set(entry.touchedNodeIds || []);
    const percent = total ? Math.round((touched.size / total) * 100) : 0;
    return { percent, completed: touched.size, total };
  } catch { return { percent: 0, completed: 0, total: 0 }; }
}

function renderPersonalized(){
  const section = document.getElementById('personalized-section');
  const userId = _liveUserId;
  if (!section) return;
  if (!userId){ section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  renderContinueCourses(userId);
  renderRecommendedCourses(userId);
}

function renderContinueCourses(userId){
  const cont = document.getElementById('continue-course-content');
  const empty = document.getElementById('continue-course-empty');
  if (!cont) return;
  cont.innerHTML = '';
  const progress = loadUserTreeProgress(userId);
  const startedTreeIds = Object.keys(progress).filter(tid => (progress[tid]?.touchedNodeIds||[]).length > 0);
  const started = _catalog.filter(t => startedTreeIds.includes(t.id)).slice(0,3);
  if (!started.length){ empty?.classList.remove('hidden'); return; } else { empty?.classList.add('hidden'); }
  started.forEach(t => cont.appendChild(createCourseCard(t)));
}

function renderRecommendedCourses(userId){
  const grid = document.getElementById('recommended-courses-content');
  const empty = document.getElementById('recommended-courses-empty');
  if (!grid) return;
  grid.innerHTML = '';
  const prefs = loadUserPreferences(userId);
  const focus = new Set(prefs.focusTags || []);
  let items = _catalog.slice();
  if (focus.size){ items = items.filter(t => (t.tags||[]).some(tag => focus.has(String(tag)))); }
  // Fallback to popular if no focus match
  if (!items.length) items = pickFeatured(_catalog);
  items = items.slice(0,3);
  if (!items.length){ empty?.classList.remove('hidden'); return; } else { empty?.classList.add('hidden'); }
  items.forEach(t => grid.appendChild(createCourseCard(t)));
}

function initSearchExplore(){
  const input = document.getElementById('homeSearchInput');
  const results = document.getElementById('search-results');
  const empty = document.getElementById('search-empty');
  const filterBtns = Array.from(document.querySelectorAll('.filter-group .chip'));
  let mode = 'courses';
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.filter || 'courses';
      runSearch();
    });
  });
  if (filterBtns.length){ filterBtns[0].classList.add('active'); }
  input?.addEventListener('input', runSearch);
  function runSearch(){
    const term = (input?.value || '').trim().toLowerCase();
    results.innerHTML = '';
    if (!term){ empty?.classList.remove('hidden'); return; }
    empty?.classList.add('hidden');
    if (mode === 'courses'){
      const list = _catalog.filter(t => `${t.title} ${t.description} ${(t.tags||[]).join(' ')}`.toLowerCase().includes(term)).slice(0,8);
      if (!list.length){ empty?.classList.remove('hidden'); return; }
      list.forEach(t => results.appendChild(createCourseCard(t)));
    } else if (mode === 'lessons'){
      const list = _allLessons.filter(l => `${l.title} ${l.description}`.toLowerCase().includes(term)).slice(0,8);
      list.forEach(l => results.appendChild(createLessonResultCard(l)));
      if (!list.length){ empty?.classList.remove('hidden'); return; }
    } else if (mode === 'concepts'){
      // Defer to Courses-first: redirect to courses page search for now
      empty?.classList.remove('hidden');
    } else if (mode === 'creators'){
      const list = _catalog.filter(t => `${t.creatorId||''}`.toLowerCase().includes(term)).slice(0,8);
      if (!list.length){ empty?.classList.remove('hidden'); return; }
      list.forEach(t => results.appendChild(createCourseCard(t)));
    }
  }
}

function createLessonResultCard(lesson){
  const card = document.createElement('div'); card.className='card';
  const h = document.createElement('h4'); h.textContent = lesson.title || lesson.id; card.appendChild(h);
  const p = document.createElement('p'); p.className='short'; p.textContent = lesson.description || ''; card.appendChild(p);
  const actions = document.createElement('div'); actions.className='actions';
  const open = document.createElement('a'); open.className='btn secondary'; open.href = `lesson.html?lessonId=${encodeURIComponent(lesson.id)}`; open.textContent = 'Open';
  actions.appendChild(open);
  card.appendChild(actions);
  return card;
}
