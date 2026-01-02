import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
// Transition to Master Graph GraphStore; legacy graph.js removed for this view
import { loadGraphStore, getAllNodes as gsGetAllNodes, getNode as gsGetNode, buildAdjacency as gsBuildAdjacency, getNeighbors as gsGetNeighbors } from './graphStore.js';
import { loadLessons, getAllLessons, buildLessonMap, getLessonMap, getLessonsForConcept, getLessonById } from './lessons.js';
import { getOrCreateDefaultProfile, computeTotalXpFromCompletedLessons, recomputeAllConceptProgress } from './user.js';
import { renderToast } from './ui.js';
import { loadUserEdges } from './userEdges.js';
import { getConceptMastery } from './conceptProgress.js';
import { loadPlaylists, createPlaylist, addLesson as addLessonToPlaylist } from './playlists.js';
import { loadGoals, addGoal as storeAddGoal, removeGoal as storeRemoveGoal } from './goalsStore.js';

let _profile = null;
let _selectedGoals = new Set();
let _route = [];

(function initHeader() {
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function initGoalsPage(){
  migrateLegacyProfileIfNeeded();
  const active = ensureActiveUserOrRedirect();
  if (!active) return;
  let profile = getActiveProfile();
  if (!profile) { profile = createDefaultProfile(active); saveActiveProfile(profile); }
  try {
    await loadGraphStore();
    await loadLessons();
    _profile = getOrCreateDefaultProfile();
    buildLessonMap(getAllLessons());
    computeTotalXpFromCompletedLessons(_profile, getLessonMap());
    recomputeAllConceptProgress(_profile, gsGetAllNodes(), getLessonMap());
    setupControls();
  } catch (e) {
    console.error('Failed to init goals page', e);
    renderToast('Failed to load graph/lessons', 'error');
  }
})();

function setupControls(){
  const startSel = document.getElementById('startSelect');
  const goalSearch = document.getElementById('goalSearch');
  const searchResults = document.getElementById('searchResults');
  const selectedGoals = document.getElementById('selectedGoals');
  const generateBtn = document.getElementById('generateBtn');
  const saveBtn = document.getElementById('savePlaylistBtn');

  // Build start options
  const concepts = gsGetAllNodes();
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Auto (from last activity)';
  startSel.appendChild(noneOpt);
  // Preselect last concept if available
  let lastConceptId = '';
  if (_profile.lastLessonId) {
    const lastLesson = getLessonById(_profile.lastLessonId);
    if (lastLesson && lastLesson.conceptId) lastConceptId = lastLesson.conceptId;
  }
  concepts.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.title + (c.subject ? ` · ${c.subject}` : '');
    if (c.id === lastConceptId) o.selected = true;
    startSel.appendChild(o);
  });

  // Live search
  function matchesConcept(c, term){
    const t = term.trim().toLowerCase(); if (!t) return false;
    const name = (c.title || c.id || '').toLowerCase();
    const subject = (c.subject || '').toLowerCase();
    const tags = Array.isArray(c.tags) ? c.tags.join(' ').toLowerCase() : '';
    return name.includes(t) || subject.includes(t) || tags.includes(t);
  }
  function renderSearch(){
    const term = goalSearch.value || '';
    searchResults.innerHTML = '';
    if (!term.trim()) return;
    const items = concepts.filter(c => matchesConcept(c, term)).slice(0, 12);
    items.forEach(c => {
      const row = document.createElement('div');
      row.className = 'row';
      const title = document.createElement('span');
      title.textContent = `${c.title}${c.subject ? ' · ' + c.subject : ''}`;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn small';
      add.textContent = _selectedGoals.has(c.id) ? 'Added' : 'Add Goal';
      add.disabled = _selectedGoals.has(c.id);
      add.addEventListener('click', () => {
        _selectedGoals.add(c.id);
        storeAddGoal(getActiveUsername(), c.id);
        renderSelectedGoals();
        renderSearch();
      });
      row.appendChild(title);
      row.appendChild(add);
      searchResults.appendChild(row);
    });
  }
  goalSearch.addEventListener('input', renderSearch);

  function renderSelectedGoals(){
    selectedGoals.innerHTML = '';
    if (_selectedGoals.size === 0) {
      const ghost = document.createElement('span');
      ghost.className = 'short';
      ghost.textContent = 'No goals selected yet.';
      selectedGoals.appendChild(ghost);
      return;
    }
    Array.from(_selectedGoals).forEach(id => {
      const c = gsGetNode(id);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = c ? c.title : id;
      const x = document.createElement('button');
      x.className = 'btn subtle small';
      x.textContent = '×';
      x.title = 'Remove';
      x.addEventListener('click', () => { _selectedGoals.delete(id); storeRemoveGoal(getActiveUsername(), id); renderSelectedGoals(); });
      chip.appendChild(x);
      selectedGoals.appendChild(chip);
    });
  }
  renderSelectedGoals();
  // Preload any stored goals and render again
  try {
    const stored = loadGoals(getActiveUsername());
    stored.forEach(id => _selectedGoals.add(id));
    renderSelectedGoals();
  } catch {}

  generateBtn.addEventListener('click', () => {
    const startId = startSel.value || lastConceptId;
    const skipGold = document.getElementById('skipGoldToggle').checked;
    if (_selectedGoals.size === 0) { renderToast('Add at least one goal', 'warning'); return; }
    const res = generatePath(startId || null, Array.from(_selectedGoals), { skipGold });
    _route = res.route;
    renderRoute(res);
  });

  saveBtn.addEventListener('click', () => {
    if (!_route || _route.length === 0) { renderToast('Generate a path first', 'warning'); return; }
    const userId = getActiveUsername();
    const title = `Path: ${new Date().toLocaleDateString()} (${_route.length} steps)`;
    const description = 'Auto-generated from Goals & Path.';
    const pl = createPlaylist(userId, { title, description, isPublic: false });
    // choose representative lesson per concept and append via API
    _route.forEach(step => { if (step.lessonId) addLessonToPlaylist(userId, pl.id, step.lessonId); });
    renderToast('Saved path as playlist', 'success');
  });

  // Recommended goals
  renderRecommendedGoals();
}

function generatePath(startConceptId, goalConceptIds, options){
  const userId = getActiveUsername();
  const skipGold = !!(options && options.skipGold);
  const concepts = gsGetAllNodes();
  const conceptIds = new Set(concepts.map(c => c.id));

  // Build adjacency from built-in relationships + user edges
  const adj = new Map();
  function ensureNode(id){ if (!adj.has(id)) adj.set(id, new Set()); }
  // Base adjacency from Master Graph relationships (buildsOn, relatedTo, partOf)
  const baseAdj = gsBuildAdjacency();
  baseAdj.forEach((set, id) => { ensureNode(id); set.forEach(n => { ensureNode(id); adj.get(id).add(n); }); });
  const uEdges = loadUserEdges(userId) || [];
  uEdges.forEach(e => {
    if (conceptIds.has(e.sourceConceptId) && conceptIds.has(e.targetConceptId)) {
      ensureNode(e.sourceConceptId); ensureNode(e.targetConceptId);
      adj.get(e.sourceConceptId).add(e.targetConceptId);
    }
  });

  // Helper: isGold
  function isGold(id){
    const m = getConceptMastery(userId, id);
    return m && m.tier === 'gold';
  }

  // For each goal, BFS from start (or from any node if no start) avoiding Gold nodes if configured
  const routes = [];
  const sources = [];
  if (startConceptId && conceptIds.has(startConceptId)) sources.push(startConceptId);
  if (sources.length === 0) {
    // fallback: allow search from all nodes that are not gold
    concepts.forEach(c => { if (!skipGold || !isGold(c.id)) sources.push(c.id); });
  }

  function bfsTo(targetId){
    const q = [];
    const prev = new Map();
    const seen = new Set();
    sources.forEach(s => { q.push(s); seen.add(s); prev.set(s, null); });
    while (q.length){
      const u = q.shift();
      if (u === targetId) break;
      const neighbors = Array.from(adj.get(u) || []);
      for (const v of neighbors){
        if (seen.has(v)) continue;
        if (skipGold && isGold(v) && v !== targetId) continue;
        seen.add(v);
        prev.set(v, u);
        q.push(v);
      }
    }
    if (!seen.has(targetId)) return null;
    const path = [];
    let cur = targetId;
    while (cur !== null){
      path.push(cur);
      cur = prev.get(cur) ?? null;
    }
    path.reverse();
    return path;
  }

  goalConceptIds.forEach(goalId => {
    const p = bfsTo(goalId);
    if (p && p.length) routes.push(p);
  });

  // Merge routes into a unique ordered sequence (preserving order of discovery)
  const merged = [];
  const seen = new Set();
  routes.forEach(p => {
    p.forEach(id => { if (!seen.has(id)) { seen.add(id); merged.push(id); } });
  });

  // Ensure all selected goals appear even if start==goal
  goalConceptIds.forEach(id => { if (!seen.has(id)) { seen.add(id); merged.push(id); } });

  // Build step list with lesson selection per concept
  const steps = [];
  let totalMinutes = 0;
  merged.forEach(id => {
    const concept = gsGetNode(id);
    if (!concept) return;
    const lessons = getLessonsForConcept(id) || [];
    // prefer first uncompleted lesson, else shortest
    const completedSet = new Set((_profile?.conceptProgress?.[id]?.completedLessonIds) || []);
    let chosen = lessons.find(l => !completedSet.has(l.id));
    if (!chosen) {
      chosen = lessons.slice().sort((a,b) => (Number(a.minutes||a.estimatedMinutes||0) - Number(b.minutes||b.estimatedMinutes||0)))[0];
    }
    const minutes = chosen ? Number(chosen.minutes || chosen.estimatedMinutes || chosen.estimatedMinutesToComplete || 10) : 10;
    totalMinutes += minutes;
    steps.push({ conceptId: id, conceptTitle: concept.title, lessonId: chosen ? chosen.id : null, lessonTitle: chosen ? chosen.title : 'Explore concept', minutes });
  });

  return { route: steps, totalMinutes };
}

function renderRoute(result){
  const sec = document.getElementById('pathSection');
  const mini = document.getElementById('miniRoute');
  const list = document.getElementById('pathSteps');
  const summary = document.getElementById('pathSummary');
  if (!sec) return;
  sec.classList.remove('hidden');
  mini.innerHTML = '';
  list.innerHTML = '';
  summary.textContent = '';

  // mini route chips
  result.route.forEach((step, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = step.conceptTitle;
    mini.appendChild(chip);
    if (idx < result.route.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = '→';
      sep.style.margin = '0 0.25rem';
      mini.appendChild(sep);
    }
  });

  // steps list
  result.route.forEach((step, idx) => {
    const row = document.createElement('div');
    row.className = 'row';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${idx+1}.</strong> ${step.conceptTitle}`;
    const right = document.createElement('div');
    const mins = document.createElement('span');
    mins.className = 'chip chip--minutes';
    mins.textContent = `${step.minutes} min`;
    right.appendChild(mins);
    if (step.lessonTitle) {
      const lt = document.createElement('span');
      lt.className = 'chip';
      lt.textContent = step.lessonTitle;
      lt.title = 'Selected lesson';
      right.appendChild(lt);
    }
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });

  summary.textContent = `${result.route.length} steps • ~${result.totalMinutes} minutes`;
}

function renderRecommendedGoals(){
  const container = document.getElementById('recommendedGoals');
  if (!container) return;
  container.innerHTML = '';
  const concepts = gsGetAllNodes();
  const userId = getActiveUsername();
  const uEdges = loadUserEdges(userId);
  let relatedSet = new Set();
  let edgeWeights = new Map();
  if (_profile.lastLessonId) {
    const lastLesson = getLessonById(_profile.lastLessonId);
    if (lastLesson && lastLesson.conceptId) {
      (gsGetNeighbors(lastLesson.conceptId) || []).forEach(n => relatedSet.add(n.id));
      uEdges.filter(e => e.sourceConceptId === lastLesson.conceptId).forEach(e => {
        relatedSet.add(e.targetConceptId);
        edgeWeights.set(e.targetConceptId, (edgeWeights.get(e.targetConceptId) || 0) + (Number(e.weight) || 1));
      });
    }
  }
  function isGold(id){ const m = getConceptMastery(userId, id); return m && m.tier === 'gold'; }
  const scored = concepts
    .filter(c => !isGold(c.id))
    .map(c => {
      const cp = _profile.conceptProgress[c.id];
      let score = 0;
      const difficulty = Number(c.difficulty) || 1;
      if (!cp || (cp.completedLessonIds || []).length === 0) score += 100;
      else if ((cp.skillScore || 0) < 60) score += 60;
      else if ((cp.skillScore || 0) >= 100) score -= 120;
      if (relatedSet.has(c.id)) score += 30;
      const w = edgeWeights.get(c.id) || 0; if (w) score += Math.min(60, 15 * w);
      score -= difficulty * 5;
      const est = Number(c.estimatedMinutesToBasicMastery) || 30; score -= Math.min(10, Math.floor(est / 10));
      return { concept: c, score };
    })
    .sort((a,b) => b.score - a.score)
    .slice(0, 8);

  if (scored.length === 0) {
    const none = document.createElement('div');
    none.className = 'short';
    none.textContent = 'No recommendations right now. Try searching for a goal above.';
    container.appendChild(none);
    return;
  }

  scored.forEach(item => {
    const c = item.concept;
    const row = document.createElement('div');
    row.className = 'row';
    const title = document.createElement('span');
    title.textContent = `${c.title}${c.subject ? ' · ' + c.subject : ''}`;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn small secondary';
    add.textContent = _selectedGoals.has(c.id) ? 'Added' : 'Add Goal';
    add.disabled = _selectedGoals.has(c.id);
    add.addEventListener('click', () => { _selectedGoals.add(c.id); storeAddGoal(getActiveUsername(), c.id); renderSelectedGoalsExternal(); });
    row.appendChild(title);
    row.appendChild(add);
    container.appendChild(row);
  });

  function renderSelectedGoalsExternal(){
    const selectedGoals = document.getElementById('selectedGoals');
    selectedGoals.innerHTML = '';
    Array.from(_selectedGoals).forEach(id => {
      const c = gsGetNode(id);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = c ? c.title : id;
      const x = document.createElement('button');
      x.className = 'btn subtle small';
      x.textContent = '×';
      x.title = 'Remove';
      x.addEventListener('click', () => { _selectedGoals.delete(id); storeRemoveGoal(getActiveUsername(), id); renderSelectedGoalsExternal(); renderRecommendedGoals(); });
      chip.appendChild(x);
      selectedGoals.appendChild(chip);
    });
    // Also refresh the recommended list buttons to reflect disabled state
    renderRecommendedGoals();
  }
}
