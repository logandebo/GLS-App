import { ensureActiveUserOrRedirect, getActiveUsername, getActiveProfile } from './storage.js';
import { renderToast } from './ui.js';
import { loadPublicCatalog, savePublicCatalog, getQueryParam, incrementMetric, refreshPublicCatalogFromCloud } from './catalogStore.js';
import { getCourseById, getCourseBySlug, getUserProgress as dsGetUserProgress, getLessons as dsGetLessons, getConcepts as dsGetConcepts } from './dataStore.js';
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadPublicConcepts } from './contentLoader.js';
import { loadConceptProgress, computeMasteryTier } from './conceptProgress.js';
import { loadLessons, getLessonsForConcept } from './lessons.js';
import { loadUserTreeProgress, markNodeTouched, setLastNode } from './userTreeProgress.js';
import { renderSubtreeGraph } from './subtreeGraphView.js';

let _masterIndex = null;
let _combinedIndex = null; // master + custom concepts
let _cloudCompletedByConcept = new Map(); // conceptId -> Set(lessonId)
let _cloudLessonsByConcept = new Map(); // conceptId -> Array(lesson)

(function initHeader(){
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function init(){
  // Allow guest viewing: do not block when no active local user
  ensureActiveUserOrRedirect();
  await loadGraphStore();
  await loadLessons();
  // Fetch cloud user progress to render badges
  try {
    const { progress } = await dsGetUserProgress();
    const byConcept = new Map();
    (Array.isArray(progress) ? progress : []).forEach(r => {
      if (r.entity_type === 'lesson' && (r.status || '').toLowerCase() === 'completed') {
        const cid = (r.meta && r.meta.conceptId) || null;
        if (cid) {
          if (!byConcept.has(cid)) byConcept.set(cid, new Set());
          byConcept.get(cid).add(r.entity_id);
        }
      }
    });
    _cloudCompletedByConcept = byConcept;
  } catch {}
  // Hydrate local public catalog cache from Supabase for deep links
  try { await refreshPublicCatalogFromCloud(); } catch {}
  const nodes = gsGetAllNodes();
  _masterIndex = new Map(nodes.map(n => [n.id, n]));
  // Build combined index with custom concepts
  const publicConcepts = loadPublicConcepts();
  const mergedById = new Map(nodes.map(n => [n.id, n]));
  Object.keys(publicConcepts || {}).forEach(id => {
    const c = publicConcepts[id];
    if (c && c.id && !mergedById.has(c.id)) mergedById.set(c.id, c);
  });
  _combinedIndex = mergedById;
  const treeId = getQueryParam('treeId');
  const slug = getQueryParam('slug');
  if (!treeId && !slug) { showNotFound(); return; }
  let catalog = loadPublicCatalog();
  let tree = treeId ? catalog.find(t => t.id === treeId) : null;
  // Fallback: fetch directly from Supabase via DAL and normalize into local shape
  if (!tree) {
    try {
      let course = null;
      if (slug) {
        const res = await getCourseBySlug(slug);
        course = res.course;
      } else if (treeId) {
        const res = await getCourseById(treeId);
        course = res.course;
      }
      if (course && course.tree_json) {
        const row = course;
        const t = row.tree_json || {};
        const nodes = Array.isArray(t.nodes) ? t.nodes.map(n => ({
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
          nodes,
          version: Number.isFinite(t.version) ? t.version : 1,
          createdAt: t.createdAt || row.created_at || new Date().toISOString(),
          updatedAt: t.updatedAt || row.created_at || new Date().toISOString()
        };

        // Batch-fetch referenced concepts and lessons via DAL
        try {
          const conceptIds = Array.from(new Set(nodes.map(n => n.conceptId).filter(Boolean)));
          if (conceptIds.length) {
            const { concepts } = await dsGetConcepts(conceptIds);
            (Array.isArray(concepts) ? concepts : []).forEach(c => {
              if (c && c.id && !_combinedIndex.has(c.id)) _combinedIndex.set(c.id, c);
            });
          }
          const lessonIdsSet = new Set();
          nodes.forEach(n => {
            (Array.isArray(n.subtreeLessonIds) ? n.subtreeLessonIds : []).forEach(id => lessonIdsSet.add(id));
            Object.keys(n.subtreeLessonSteps || {}).forEach(id => lessonIdsSet.add(id));
          });
          const lessonIds = Array.from(lessonIdsSet);
          if (lessonIds.length) {
            const { lessons } = await dsGetLessons(lessonIds);
            // Group cloud lessons by conceptId for progress rendering
            const byConcept = new Map();
            (Array.isArray(lessons) ? lessons : []).forEach(ls => {
              const cid = ls.concept_id || ls.conceptId || null;
              if (!cid) return;
              if (!byConcept.has(cid)) byConcept.set(cid, []);
              byConcept.get(cid).push(ls);
            });
            _cloudLessonsByConcept = byConcept;
          }
        } catch {}
      }
    } catch {}
  }
  if (!tree) { showNotFound(); return; }
  migrateTreeConceptIdsIfNeeded(tree, catalog);
  incrementMetric(tree.id, 'views', 1);
  renderOverview(tree);
  renderGraph(tree);
  renderProgress(tree);
  setupContinue(tree);
})();

function migrateTreeConceptIdsIfNeeded(tree, catalog){
  if (!tree || !Array.isArray(tree.nodes)) return;
  let changed = false;
  tree.nodes.forEach(n => {
    if (!n) return;
    if (!n.conceptId && n.conceptID){ n.conceptId = n.conceptID; delete n.conceptID; changed = true; }
    if (!n.conceptId && n.concept_id){ n.conceptId = n.concept_id; delete n.concept_id; changed = true; }
  });
  if (changed){
    try {
      const idx = catalog.findIndex(t => t.id === tree.id);
      if (idx !== -1){ catalog[idx] = tree; savePublicCatalog(catalog); }
    } catch {}
  }
}

function renderOverview(tree){
  const ov = document.getElementById('overviewSection');
  document.getElementById('treeTitle').textContent = tree.title || tree.id;
  const p = document.createElement('p'); p.className='short'; p.textContent = tree.description || '';
  const meta = document.createElement('div'); meta.className='short'; meta.textContent = `${tree.primaryDomain || 'general'} · ${(tree.tags||[]).join(', ')}`;
  ov.innerHTML = ''; ov.appendChild(p); ov.appendChild(meta);
  // Intro video button
  if (tree.introVideoUrl){
    const actions = document.createElement('div'); actions.className='actions';
    const btn = document.createElement('button'); btn.className='btn'; btn.type='button'; btn.textContent='Watch Intro';
    btn.addEventListener('click', () => openIntroModal(tree.introVideoUrl));
    actions.appendChild(btn);
    ov.appendChild(actions);
  }
}

function showNotFound(){
  const msg = document.getElementById('notFoundMsg');
  const list = document.getElementById('nodeList');
  const empty = document.getElementById('nodesEmpty');
  if (msg) msg.classList.remove('hidden');
  if (list) list.innerHTML = '';
  if (empty) empty.classList.add('hidden');
}

function tierRank(t){
  const m = String(t||'').toLowerCase();
  if (m === 'gold') return 3;
  if (m === 'silver') return 2;
  if (m === 'bronze') return 1;
  return 0; // none/unrated
}

function isUnlocked(node, userId){
  const reqs = Array.isArray(node.unlockConditions?.requiredConceptIds) ? node.unlockConditions.requiredConceptIds : [];
  const minBadge = String(node.unlockConditions?.minBadge || 'none').toLowerCase();
  if (!reqs.length || minBadge === 'none') return true;
  const progress = loadConceptProgress(userId);
  return reqs.every(rc => {
    const entry = progress[rc] || {};
    const tier = computeMasteryTier(entry);
    const t = String(tier || 'Unrated').toLowerCase();
    const rank = t === 'gold' ? 3 : t === 'silver' ? 2 : t === 'bronze' ? 1 : 0;
    const minRank = tierRank(minBadge);
    return rank >= minRank;
  });
}

function renderNodes(tree){
  // Deprecated in favor of graph view
}

function renderGraph(tree){
  const container = document.getElementById('graphContainer');
  const empty = document.getElementById('nodesEmpty');
  container.innerHTML = '';
  if (!Array.isArray(tree.nodes) || !tree.nodes.length){ empty.classList.remove('hidden'); return; } else { empty.classList.add('hidden'); }
  const userId = getActiveUsername();
  const profile = getActiveProfile();

  function nodeProgressPercent(conceptId){
    if (!conceptId || !profile) return 0;
    const localLessons = getLessonsForConcept(conceptId) || [];
    const cloudLessons = _cloudLessonsByConcept.get(conceptId) || [];
    const lessons = [...localLessons, ...cloudLessons];
    const nonGame = lessons.filter(l => {
      const t = String(l?.type || '').toLowerCase();
      const ct = String(l?.content_type || '').toLowerCase();
      return t !== 'unity_game' && t !== 'game';
    });
    const total = nonGame.length;
    if (total === 0) return 0;
    const completedLocal = new Set((profile?.conceptProgress?.[conceptId]?.completedLessonIds) || []);
    const completedCloud = _cloudCompletedByConcept.get(conceptId) || new Set();
    const done = nonGame.filter(l => completedLocal.has(l.id) || completedCloud.has(l.id)).length;
    return Math.round((done / total) * 100);
  }

  function nodeIsEmpty(conceptId){
    if (!conceptId) return true;
    const localLessons = getLessonsForConcept(conceptId) || [];
    const cloudLessons = _cloudLessonsByConcept.get(conceptId) || [];
    const lessons = [...localLessons, ...cloudLessons];
    const nonGame = lessons.filter(l => {
      const t = String(l?.type || '').toLowerCase();
      const ct = String(l?.content_type || '').toLowerCase();
      return t !== 'unity_game' && t !== 'game';
    });
    return nonGame.length === 0;
  }
  const api = renderSubtreeGraph(container, tree, {
    mode: 'viewer',
    onNodeClick: (node) => {
      // Block navigate if unbound or locked
      if (!node.conceptId){ renderToast("This node isn’t linked to a concept yet.", 'warning'); return; }
      // Optional hardening: ensure concept can be resolved (built-in or public)
      const exists = (_combinedIndex && _combinedIndex.get(node.conceptId)) || (_masterIndex && _masterIndex.get(node.conceptId));
      if (!exists){ renderToast('Concept not found. This course may be missing published concept data.', 'warning'); return; }
      if (!isUnlocked(node, userId)) return;
      incrementMetric(tree.id, 'starts', 1);
      markNodeTouched(userId, tree.id, node.conceptId);
      setLastNode(userId, tree.id, node.conceptId);
      const slugParam = tree.slug ? `&slug=${encodeURIComponent(tree.slug)}` : '';
      window.location.href = `subtree_node.html?treeId=${encodeURIComponent(tree.id)}&conceptId=${encodeURIComponent(node.conceptId)}${slugParam}`;
    },
    isNodeLocked: (node) => !isUnlocked(node, userId),
    getNodeStatus: (node) => {
      const locked = !isUnlocked(node, userId);
      const data = loadUserTreeProgress(userId)[tree.id] || { touchedNodeIds: [] };
      const visited = node.conceptId && Array.isArray(data.touchedNodeIds) && data.touchedNodeIds.includes(node.conceptId);
      const unbound = !node.conceptId;
      const percent = nodeProgressPercent(node.conceptId);
      const completed = percent >= 100;
      return { locked, visited, unlocked: !locked && !unbound, unbound, completed };
    },
    getNodeTitle: (node) => node.conceptId ? ((_combinedIndex && _combinedIndex.get(node.conceptId)?.title) || _masterIndex.get(node.conceptId)?.title || node.conceptId) : '(Unbound)',
    getLockedReason: (node) => {
      const reqs = node.unlockConditions?.requiredConceptIds || [];
      const badge = node.unlockConditions?.minBadge || 'none';
      if (!reqs.length && badge === 'none') return 'Locked: prerequisites not met.';
      const reqTitles = reqs.map(rc => (_combinedIndex && _combinedIndex.get(rc)?.title) || _masterIndex.get(rc)?.title || rc);
      return `Requires: ${reqTitles.join(', ')} · Badge: ${badge}`;
    },
    getNodeProgressPercent: (node) => nodeProgressPercent(node.conceptId),
    getNodeIsEmpty: (node) => nodeIsEmpty(node.conceptId)
  });
  const fitBtn = document.getElementById('fitBtn');
  fitBtn.addEventListener('click', () => api.fitGraphToViewport());
  // Auto-fit on open for learner view
  try { api.fitGraphToViewport(); } catch {}
  // Retry on next frame in case fonts/layout adjust sizes after first render
  try { window.requestAnimationFrame && window.requestAnimationFrame(() => api.fitGraphToViewport()); } catch {}
}

function openIntroModal(url){
  const modal = document.getElementById('introModal');
  const closeBtn = document.getElementById('introCloseBtn');
  const port = document.getElementById('introVideoPort');
  if (!modal || !closeBtn || !port) return;
  port.innerHTML='';
  const vid = document.createElement('video');
  vid.controls = true; vid.src = url; vid.className='video-player';
  port.appendChild(vid);
  modal.classList.remove('hidden');
  function close(){ modal.classList.add('hidden'); try { vid.pause(); } catch {} }
  closeBtn.onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

function renderProgress(tree){
  const el = document.getElementById('progressSummary');
  if (!el) return;
  const profile = getActiveProfile();
  // Compute course completion percentage excluding game lessons
  let totalNonGame = 0;
  let doneNonGame = 0;
  (tree.nodes || []).forEach(n => {
    const cid = n && n.conceptId;
    if (!cid) return;
    const lessons = getLessonsForConcept(cid) || [];
    const nonGame = lessons.filter(l => {
      const t = String(l?.type || '').toLowerCase();
      return t !== 'unity_game' && t !== 'game';
    });
    totalNonGame += nonGame.length;
    const completedLocal = new Set((profile?.conceptProgress?.[cid]?.completedLessonIds) || []);
    const completedCloud = _cloudCompletedByConcept.get(cid) || new Set();
    doneNonGame += nonGame.filter(l => completedLocal.has(l.id) || completedCloud.has(l.id)).length;
  });
  const percent = totalNonGame > 0 ? Math.round((doneNonGame / totalNonGame) * 100) : 0;
  el.textContent = `${percent}% completed`;
}

function setupContinue(tree){
  const btn = document.getElementById('continueBtn');
  const userId = getActiveUsername();
  const data = loadUserTreeProgress(userId)[tree.id] || { lastNodeId: null };
  btn.disabled = !data.lastNodeId;
  btn.addEventListener('click', () => {
    const last = (loadUserTreeProgress(userId)[tree.id] || {}).lastNodeId;
    if (!last) return;
    const node = tree.nodes.find(n => n.conceptId === last);
    if (!node) return;
    const unlocked = isUnlocked(node, userId);
    if (!unlocked) { renderToast('Last node is locked', 'warning'); return; }
    incrementMetric(tree.id, 'starts', 1);
    const slugParam = tree.slug ? `&slug=${encodeURIComponent(tree.slug)}` : '';
    window.location.href = `subtree_node.html?treeId=${encodeURIComponent(tree.id)}&conceptId=${encodeURIComponent(last)}${slugParam}`;
  });
}
