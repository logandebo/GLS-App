// Refactored to use Master Graph GraphStore (replacing legacy graph.js direct access)
import { loadGraphStore, getNeighbors, getAllNodes } from './graphStore.js';
import { loadPublicConcepts } from './contentLoader.js';
import { loadLessons, getLessonsForConcept, getLessonById, getAllLessons, buildLessonMap } from './lessons.js';
import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
import { getOrCreateDefaultProfile, recordLessonAccess } from './user.js';
import { renderToast, createConceptCard, createLessonCard } from './ui.js';
import { getConceptMastery } from './conceptProgress.js';
import { loadUserEdges } from './userEdges.js';
import { loadPlaylists, createPlaylist, addLesson as addLessonToPlaylist } from './playlists.js';

let _activeProfile = null;
let _concept = null;
let _combinedConceptsById = null; // master + custom
let _selectedLessonForPlaylist = null;

(function initHeader() {
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

function setupPlaylistModal() {
  const modal = document.getElementById('playlistModal');
  if (!modal) return null;
  const sel = document.getElementById('plSelect');
  const toggle = document.getElementById('plCreateToggle');
  const fields = document.getElementById('plCreateFields');
  const title = document.getElementById('plNewTitle');
  const desc = document.getElementById('plNewDesc');
  const err = document.getElementById('plErr');
  const cancel = document.getElementById('plCancel');
  const add = document.getElementById('plAdd');
  toggle.addEventListener('click', () => fields.classList.toggle('hidden'));
  cancel.addEventListener('click', () => { modal.classList.add('hidden'); _selectedLessonForPlaylist = null; });
  add.addEventListener('click', () => {
    const userId = getActiveUsername();
    let playlistId = sel.value;
    if (!fields.classList.contains('hidden')) {
      const t = (title.value || '').trim();
      const d = (desc.value || '').trim();
      if (!t) { err.textContent = 'Title is required to create a playlist.'; return; }
      const pl = createPlaylist(userId, { title: t, description: d, isPublic: false });
      playlistId = pl.id;
    }
    if (!playlistId) { err.textContent = 'Select a playlist or create one.'; return; }
    if (_selectedLessonForPlaylist) {
      addLessonToPlaylist(userId, playlistId, _selectedLessonForPlaylist);
      renderToast('Added to playlist', 'success');
    } else if (_concept) {
      // Add all lessons for this concept
      const lessons = getLessonsForConcept(_concept.id);
      lessons.forEach(l => addLessonToPlaylist(userId, playlistId, l.id));
      renderToast('All concept lessons added', 'success');
    }
    modal.classList.add('hidden');
    _selectedLessonForPlaylist = null;
  });
  return { modal, sel, fields, title, desc, err };
}

function openPlaylistModalFor(lessonId) {
  _selectedLessonForPlaylist = lessonId || null;
  const modal = document.getElementById('playlistModal');
  const sel = document.getElementById('plSelect');
  const fields = document.getElementById('plCreateFields');
  const err = document.getElementById('plErr');
  if (!modal) return;
  err.textContent = '';
  fields.classList.add('hidden');
  const userId = getActiveUsername();
  const lists = loadPlaylists(userId);
  sel.innerHTML = '';
  if (!lists.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No playlists yet';
    sel.appendChild(opt);
    fields.classList.remove('hidden');
  } else {
    lists.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.title || p.id;
      sel.appendChild(opt);
    });
  }
  modal.classList.remove('hidden');
}

(async function init() {
  migrateLegacyProfileIfNeeded();
  const active = ensureActiveUserOrRedirect();
  if (!active) return;
  let profile = getActiveProfile();
  if (!profile) { profile = createDefaultProfile(active); saveActiveProfile(profile); }
  _activeProfile = profile;

  const url = new URL(window.location.href);
  const conceptId = url.searchParams.get('conceptId');
  const containerLessons = document.getElementById('lessonsGrid');
  document.getElementById('concept-hero').classList.add('mastery-card');
  setupPlaylistModal();

  try {
    // Load Master Graph via GraphStore (legacy graph access removed)
    await loadGraphStore();
    await loadLessons();
    buildLessonMap(getAllLessons());
    if (!conceptId) { renderToast('Missing conceptId', 'error'); return; }
    // Build combined concepts map (master + published public concepts)
    const master = getAllNodes();
    const publicMap = loadPublicConcepts();
    const byId = new Map(master.map(n => [n.id, n]));
    Object.keys(publicMap || {}).forEach(id => {
      const c = publicMap[id];
      if (c && c.id && !byId.has(c.id)) byId.set(c.id, c);
    });
    _combinedConceptsById = byId;
    const concept = byId.get(conceptId);
    if (!concept) { renderToast('Concept not found. This course may be missing published concept data.', 'error'); return; }
    _concept = concept;
    renderConceptHeader(concept);
    renderLessons(concept);
    renderRelated(concept);
    document.getElementById('startSessionBtn').addEventListener('click', () => startNextLesson(concept));
  } catch (e) {
    console.error('Failed to init concept page', e);
    renderToast('Failed to load concept page', 'error');
  }
})();

function renderConceptHeader(concept) {
  const titleEl = document.getElementById('conceptTitle');
  const descEl = document.getElementById('concept-desc');
  const badge = document.getElementById('masteryBadge');
  const spark = document.getElementById('sparkline');
  titleEl.textContent = concept.title;
  // Use new Master Graph field 'summary'; legacy shortDescription may not exist post-migration
  descEl.textContent = concept.summary || '';
  const userId = getActiveUsername();
  const m = getConceptMastery(userId, concept.id);
  const tier = (m?.tier || 'Unrated');
  badge.textContent = tier;
  badge.className = `badge badge--mastery badge--${tier.toLowerCase()}`;
  // Sparkline: show movingAverageScore as a filled percentage bar
  spark.innerHTML = '';
  const pct = Math.max(0, Math.min(100, Number(m?.entry?.movingAverageScore || 0)));
  const fill = document.createElement('div');
  fill.style.position = 'absolute';
  fill.style.left = '0';
  fill.style.top = '0';
  fill.style.bottom = '0';
  fill.style.width = pct + '%';
  fill.style.background = '#2563eb';
  fill.style.borderRadius = '6px';
  spark.appendChild(fill);
}

function renderLessons(concept) {
  const grid = document.getElementById('lessonsGrid');
  const empty = document.getElementById('lessonsEmpty');
  grid.innerHTML = '';
  const lessons = getLessonsForConcept(concept.id);
  if (!lessons.length) { empty.classList.remove('hidden'); return; } else { empty.classList.add('hidden'); }
  const userId = getActiveUsername();
  const playlists = loadPlaylists(userId);
  const inAnyPlaylist = new Set();
  playlists.forEach(pl => (pl.lessonIds || []).forEach(id => inAnyPlaylist.add(id)));
  lessons.forEach(l => {
    const card = createLessonCard(l, concept, { profile: _activeProfile, inPlaylist: inAnyPlaylist.has(l.id), onClick: (lesson) => {
      recordLessonAccess(getOrCreateDefaultProfile(), lesson.id);
      window.location.href = `lesson.html?lessonId=${lesson.id}`;
    }, onAddToPlaylist: (lesson) => openPlaylistModalFor(lesson.id) });
    grid.appendChild(card);
  });
}

function startNextLesson(concept) {
  const lessons = getLessonsForConcept(concept.id);
  if (!lessons.length) return;
  // next incomplete, else first
  const prof = getOrCreateDefaultProfile();
  const completed = new Set((prof?.conceptProgress?.[concept.id]?.completedLessonIds) || []);
  const next = lessons.find(l => !completed.has(l.id)) || lessons[0];
  recordLessonAccess(prof, next.id);
  window.location.href = `lesson.html?lessonId=${next.id}`;
}

function renderRelated(concept) {
  const grid = document.getElementById('relatedGrid');
  const empty = document.getElementById('relatedEmpty');
  grid.innerHTML = '';
  const userId = getActiveUsername();

  // Built-in neighbors from Master Graph (buildsOn, relatedTo, partOf + reverse partOf children)
  const neighborNodes = getNeighbors(concept.id) || [];
  const neighborIds = new Set(neighborNodes.map(n => n.id));

  // Augment with user-inferred (USER_NEXT) edges
  const uEdges = loadUserEdges(userId);
  uEdges.filter(e => e.sourceConceptId === concept.id).forEach(e => neighborIds.add(e.targetConceptId));

  if (neighborIds.size === 0) {
    empty.classList.remove('hidden');
    return;
  } else {
    empty.classList.add('hidden');
  }

  const master = getAllNodes();
  const pub = loadPublicConcepts();
  const pubList = Object.values(pub || {});
  const allConcepts = [...master, ...pubList];
  const byId = new Map(allConcepts.map(c => [c.id, c]));

  neighborIds.forEach(id => {
    const c = byId.get(id);
    if (!c) return;
    const mastery = getConceptMastery(userId, c.id);
    const card = createConceptCard(c, { masteryTier: mastery?.tier, onClick: (cc) => {
      window.location.href = `concept.html?conceptId=${cc.id}`;
    }});
    grid.appendChild(card);
  });
}
