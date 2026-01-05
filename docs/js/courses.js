import { getActiveProfile } from './storage.js?v=20260103';
import { subscribe, getState } from './auth/authStore.js?v=20260103';
import { renderToast } from './ui.js';
import { loadPublicCatalog, loadTreeMetrics, refreshPublicCatalogFromCloud } from './catalogStore.js';
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadAllLessons } from './contentLoader.js';
import { loadUserTreeProgress } from './userTreeProgress.js';

export async function initCourses(){
  // Courses page is browsable for guests; do not redirect.
  // If authed, header shows avatar; if guest, header shows Login/Sign Up.
  // Subscribe for potential future personalization; not required for catalog rendering.
  subscribe(() => {});
  // Load master graph for duration estimates
  await loadGraphStore();
  _masterIndex = new Map(gsGetAllNodes().map(n => [n.id, n]));
  initFilters();
  renderCatalog();
  // Refresh catalog from cloud in background, then re-render
  try {
    const ok = await refreshPublicCatalogFromCloud();
    if (ok) {
      renderCatalog();
    }
  } catch {}
  // Optionally load lessons to enhance cards with counts and progress
  try {
    _allLessons = await loadAllLessons();
    renderCatalog();
  } catch(e){ console.warn('Optional lessons load failed; continuing without counts', e); }
  // Live update on publish/unpublish via storage
  window.addEventListener('storage', (e) => {
    if (e.key === 'gep_publicCreatorTrees' || e.key === 'gep_treeMetrics') renderCatalog();
  });
}

function initFilters(){
  const domainSel = document.getElementById('domainFilter');
  const tagSel = document.getElementById('tagFilter');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const catalog = loadPublicCatalog();
  const domains = Array.from(new Set(catalog.map(c => c.primaryDomain).filter(Boolean))).sort();
  const tags = Array.from(new Set(catalog.flatMap(c => Array.isArray(c.tags) ? c.tags : []).filter(Boolean))).sort();
  domainSel.innerHTML = '';
  tagSel.innerHTML = '';
  const dAny = document.createElement('option'); dAny.value=''; dAny.textContent='All Domains'; domainSel.appendChild(dAny);
  domains.forEach(d => { const o = document.createElement('option'); o.value=d; o.textContent=d; domainSel.appendChild(o); });
  const tAny = document.createElement('option'); tAny.value=''; tAny.textContent='All Tags'; tagSel.appendChild(tAny);
  tags.forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; tagSel.appendChild(o); });
  searchInput.addEventListener('input', renderCatalog);
  domainSel.addEventListener('change', renderCatalog);
  tagSel.addEventListener('change', renderCatalog);
  sortSelect.addEventListener('change', renderCatalog);
}

let _masterIndex = null;
let _allLessons = [];

function estimateTotalMinutes(tree){
  if (!_masterIndex) return tree.nodes?.length || 0;
  let sum = 0;
  (tree.nodes||[]).forEach(n => {
    const concept = _masterIndex.get(n.conceptId);
    const est = Number(concept?.estimatedMinutesToBasicMastery || 0);
    if (Number.isFinite(est) && est > 0) sum += est;
  });
  return sum || (tree.nodes?.length || 0);
}

function renderCatalog(){
  const grid = document.getElementById('catalogGrid');
  const empty = document.getElementById('catalogEmpty');
  const searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const domainFilter = document.getElementById('domainFilter').value || '';
  const tagFilter = document.getElementById('tagFilter').value || '';
  const sort = document.getElementById('sortSelect').value || 'views_desc';
  const catalog = loadPublicCatalog();
  const metrics = loadTreeMetrics();
  let items = catalog.slice();
  if (searchTerm) {
    items = items.filter(c => {
      const text = `${c.title} ${c.description} ${c.primaryDomain} ${(c.tags||[]).join(' ')}`.toLowerCase();
      return text.includes(searchTerm);
    });
  }
  if (domainFilter) items = items.filter(c => String(c.primaryDomain).toLowerCase() === String(domainFilter).toLowerCase());
  if (tagFilter) items = items.filter(c => Array.isArray(c.tags) && c.tags.map(x => String(x).toLowerCase()).includes(String(tagFilter).toLowerCase()));
  items.sort((a,b) => {
    const ma = metrics[a.id] || { views:0, starts:0 };
    const mb = metrics[b.id] || { views:0, starts:0 };
    if (sort === 'popular') return (mb.views||0) - (ma.views||0);
    if (sort === 'newest') return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
    if (sort === 'title_asc') return String(a.title).localeCompare(String(b.title));
    if (sort === 'shortest') return estimateTotalMinutes(a) - estimateTotalMinutes(b);
    return 0;
  });
  grid.innerHTML = '';
  if (!items.length) { empty.classList.remove('hidden'); return; } else { empty.classList.add('hidden'); }
  items.forEach(c => {
    grid.appendChild(createCourseCard(c));
  });
}

// Style + logic copied to match home page course cards
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

function lessonTypeCountsForTree(tree){
  if (!_allLessons || !_allLessons.length) return { video:0, game:0, quiz:0, external:0 };
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
  if (!_allLessons || !_allLessons.length) return estimateTotalMinutes(tree);
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
  return sum || estimateTotalMinutes(tree);
}

function getCourseCompletionPercent(tree){
  try {
    // Ignore demo local profile progress when user is Supabase-authed
    const s = getState();
    if (s.status === 'authed') return { percent: 0, completed: 0, total: 0 };
    const ids = new Set();
    (tree.nodes||[]).forEach(n => {
      (n.subtreeLessonIds||[]).forEach(id => ids.add(id));
      Object.keys(n.subtreeLessonSteps||{}).forEach(id => ids.add(id));
    });
    if (!ids.size || !_allLessons || !_allLessons.length) return { percent: 0, completed: 0, total: 0 };
    const byId = new Map(_allLessons.map(l => [l.id, l]));
    const lessons = Array.from(ids).map(id => byId.get(id)).filter(Boolean);
    const nonGameNonExternal = lessons.filter(l => {
      const t = String(l?.type||'').toLowerCase();
      return t !== 'unity_game' && t !== 'game' && t !== 'external_link' && t !== 'external' && t !== 'link';
    });
    const total = nonGameNonExternal.length;
    if (!total) return { percent: 0, completed: 0, total: 0 };
    const profile = getActiveProfile();
    const completedIds = new Set();
    const cp = profile && profile.conceptProgress ? profile.conceptProgress : {};
    Object.values(cp || {}).forEach(entry => (entry?.completedLessonIds||[]).forEach(id => completedIds.add(id)));
    const completed = nonGameNonExternal.filter(l => completedIds.has(l.id)).length;
    const percent = Math.round((completed / total) * 100);
    return { percent, completed, total };
  } catch { return { percent: 0, completed: 0, total: 0 }; }
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
