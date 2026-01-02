import { ensureActiveUserOrRedirect, getActiveUsername, getActiveProfile } from './storage.js';
import { renderToast } from './ui.js';
import { loadPublicCatalog, savePublicCatalog, getQueryParam, incrementMetric } from './catalogStore.js';
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadPublicConcepts } from './contentLoader.js';
import { loadConceptProgress, computeMasteryTier } from './conceptProgress.js';
import { loadLessons, getLessonsForConcept } from './lessons.js';
import { loadUserTreeProgress, markNodeTouched, setLastNode } from './userTreeProgress.js';
import { renderSubtreeGraph } from './subtreeGraphView.js';

let _masterIndex = null;
let _combinedIndex = null; // master + custom concepts

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
  await loadLessons();
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
  if (!treeId) { showNotFound(); return; }
  const catalog = loadPublicCatalog();
  const tree = catalog.find(t => t.id === treeId);
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
    const lessons = getLessonsForConcept(conceptId) || [];
    const nonGame = lessons.filter(l => {
      const t = String(l?.type || '').toLowerCase();
      return t !== 'unity_game' && t !== 'game';
    });
    const total = nonGame.length;
    if (total === 0) return 0;
    const completedSet = new Set((profile?.conceptProgress?.[conceptId]?.completedLessonIds) || []);
    const done = nonGame.filter(l => completedSet.has(l.id)).length;
    return Math.round((done / total) * 100);
  }

  function nodeIsEmpty(conceptId){
    if (!conceptId) return true;
    const lessons = getLessonsForConcept(conceptId) || [];
    const nonGame = lessons.filter(l => {
      const t = String(l?.type || '').toLowerCase();
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
      window.location.href = `subtree_node.html?treeId=${encodeURIComponent(tree.id)}&conceptId=${encodeURIComponent(node.conceptId)}`;
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
    const completedSet = new Set((profile?.conceptProgress?.[cid]?.completedLessonIds) || []);
    doneNonGame += nonGame.filter(l => completedSet.has(l.id)).length;
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
    window.location.href = `subtree_node.html?treeId=${encodeURIComponent(tree.id)}&conceptId=${encodeURIComponent(last)}`;
  });
}
