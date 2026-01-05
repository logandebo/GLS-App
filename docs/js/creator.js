import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadCustomConcepts, loadAllLessons, CUSTOM_LESSONS_KEY } from './contentLoader.js';
import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
import { renderToast } from './ui.js';
import { publishTree as publishToCatalog, unpublishTree as unpublishFromCatalog, getLastPublishMissingConceptIds } from './catalogStore.js';
import { getCoursesByUser as dsGetCoursesByUser, upsertCourse as dsUpsertCourse, deleteCourse as dsDeleteCourse, upsertConcept as dsUpsertConcept, upsertLesson as dsUpsertLesson } from './dataStore.js';
import { deleteCreatorTreeByLocalId as sbDeleteByLocalId, unpublishCreatorTreeByLocalId as sbUnpublishByLocalId } from './supabaseStore.js';
import { loadPublicConcepts, savePublicConcepts } from './contentLoader.js';
import { loadCreatorTrees, createCreatorTree, getCreatorTree, addNodeToTree, connectNodes, updateCreatorTree, saveCreatorTrees, exportCreatorTree, importCreatorTree, validateCreatorTree, buildMasterIndex, updateUnlockConditions, deleteCreatorTree, setNodeNextIds } from './creatorTreeStore.js';
import { renderSubtreeGraph } from './subtreeGraphView.js';
import { loadLessons } from './lessons.js';

let _activeProfile = null;
let _masterNodes = [];
let _masterIndex = null;
let _customConcepts = [];
let _titleIndex = null; // combined map of id -> concept (master or custom)
let _combinedIndex = null; // alias for validation (master + custom)
let _searchConcepts = [];
let _currentTreeId = null;
let _sequence = []; // ordered conceptIds
let _unlockEditConceptId = null;
let _linkEditConceptId = null;
let _graphApi = null;
let _selectedNodeCid = null;
let _allLessons = [];
let _lessonById = new Map();
// Render guard to prevent async double-append in Selected Lessons list
let _insLessonsSelectedRenderTick = 0;
// Render guard to prevent async double-append in Search Results list
let _insLessonsSearchRenderTick = 0;
// Watch for lesson store changes to update visual editor counts live
let _lessonsWatchTimer = null;
let _lastLessonsRaw = null;

(function initHeader() {
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  const username = getActiveUsername();
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function initBuilder(){
  migrateLegacyProfileIfNeeded();
  const active = ensureActiveUserOrRedirect();
  if (!active) return;
  let profile = getActiveProfile();
  if (!profile) { profile = createDefaultProfile(active); saveActiveProfile(profile); }
  _activeProfile = profile;
  try {
    await loadGraphStore();
    _masterNodes = gsGetAllNodes();
    _masterIndex = buildMasterIndex(_masterNodes);
    _customConcepts = loadCustomConcepts();
    // Build combined title index for display and combined search set
    const mergedById = new Map();
    _masterNodes.forEach(n => { if (n && n.id) mergedById.set(n.id, n); });
    _customConcepts.forEach(n => { if (n && n.id && !mergedById.has(n.id)) mergedById.set(n.id, n); });
    _titleIndex = mergedById;
    _combinedIndex = mergedById;
    _searchConcepts = Array.from(mergedById.values());
    // Preload lessons for editor node meta counts
    try {
      await loadLessons();
      const merged = await loadAllLessons();
      _allLessons = Array.isArray(merged) ? merged : (merged?.lessons || []);
      _lessonById = new Map(_allLessons.map(l => [l.id, l]));
      _lastLessonsRaw = localStorage.getItem(CUSTOM_LESSONS_KEY) || '';
      startLessonsWatcher();
      window.addEventListener('storage', (e) => {
        if (e.key === CUSTOM_LESSONS_KEY) {
          reloadLessonsCache(true);
        }
      });
    } catch {}
    initControls();
    loadTreeSelect();
    renderSearchResults();
  } catch (e) {
    console.error('Failed to init creator builder', e);
    renderToast('Failed to initialize creator builder', 'error');
  }
})();

function initControls(){
  const searchInput = document.getElementById('searchInput');
  const newBtn = document.getElementById('newTreeBtn');
  const saveBtn = document.getElementById('saveTreeBtn');
  const exportBtn = document.getElementById('exportTreeBtn');
  const importBtn = document.getElementById('importTreeBtn');
  const importInput = document.getElementById('importTreeInput');
  const deleteBtn = document.getElementById('deleteTreeBtn');
  const publishBtn = document.getElementById('publishTreeBtn');
  const publishHelpBtn = document.getElementById('publishHelpBtn');
  const unpublishBtn = document.getElementById('unpublishTreeBtn');
  const editorMode = document.getElementById('editorMode');
  const autoLayoutBtn = document.getElementById('autoLayoutBtn');
  const fitGraphBtn = document.getElementById('fitGraphBtn');
  const saveLayoutBtn = document.getElementById('saveLayoutBtn');
  const snapToggle = document.getElementById('snapToggle');
  const treeSelect = document.getElementById('treeSelect');
  const createConceptBtn = document.getElementById('createConceptBtn');
  const introVideoInput = document.getElementById('introVideoInput');
  const introVideoUploadBtn = document.getElementById('introVideoUploadBtn');
  const introVideoClearBtn = document.getElementById('introVideoClearBtn');
  searchInput.addEventListener('input', renderSearchResults);
  newBtn.addEventListener('click', createNewTree);
  saveBtn.addEventListener('click', saveCurrentTree);
  exportBtn.addEventListener('click', exportCurrentTree);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImportTree);
  deleteBtn && deleteBtn.addEventListener('click', deleteCurrentTree);
  publishBtn.addEventListener('click', publishCurrentTree);
  publishHelpBtn && publishHelpBtn.addEventListener('click', showPublishHelp);
  unpublishBtn.addEventListener('click', unpublishCurrentTree);
  treeSelect.addEventListener('change', () => loadSelectedTree(treeSelect.value));
  editorMode && editorMode.addEventListener('change', onModeChange);
  autoLayoutBtn && autoLayoutBtn.addEventListener('click', applyAutoLayout);
  fitGraphBtn && fitGraphBtn.addEventListener('click', () => _graphApi?.fitGraphToViewport && _graphApi.fitGraphToViewport());
  saveLayoutBtn && saveLayoutBtn.addEventListener('click', () => saveCurrentLayout());
  snapToggle && snapToggle.addEventListener('change', () => { if (_graphApi && _graphApi.setSnapEnabled) _graphApi.setSnapEnabled(snapToggle.checked); });
  createConceptBtn && createConceptBtn.addEventListener('click', () => createNewConcept());
  introVideoUploadBtn && introVideoUploadBtn.addEventListener('click', () => uploadIntroVideo());
  introVideoClearBtn && introVideoClearBtn.addEventListener('click', () => clearIntroVideo());
}

function showPublishHelp(){
  const lines = [
    'Cloud publish requires:',
    '1) SUPABASE_URL and SUPABASE_ANON_KEY configured (js/config.js).',
    '2) Supabase UMD script loaded (already on this page).',
    '3) Signed-in user (use Login/Sign Up in the header).',
    "4) Supabase table 'creator_trees' with RLS policies: public can select when is_published=true; owners can insert/update/delete their rows.",
    '5) Click Publish; you should see Cloud success toasts and the banner change to Cloud: Published.'
  ];
  try { renderToast(lines.join(' '), 'info'); }
  catch { alert(lines.join('\n')); }
}

function startLessonsWatcher(){
  try {
    if (_lessonsWatchTimer) return;
    _lessonsWatchTimer = setInterval(() => {
      try {
        const raw = localStorage.getItem(CUSTOM_LESSONS_KEY) || '';
        if (raw !== _lastLessonsRaw) {
          _lastLessonsRaw = raw;
          reloadLessonsCache(true);
        }
      } catch {}
    }, 1500);
  } catch {}
}

async function reloadLessonsCache(refreshGraph = false){
  try {
    const merged = await loadAllLessons();
    _allLessons = Array.isArray(merged) ? merged : (merged?.lessons || []);
    _lessonById = new Map(_allLessons.map(l => [l.id, l]));
    if (refreshGraph) {
      try { refreshVisualEditor(); } catch {}
    }
  } catch {}
}

function loadTreeSelect(){
  const sel = document.getElementById('treeSelect');
  sel.innerHTML = '';
  const trees = loadCreatorTrees(getActiveUsername());
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = trees.length ? 'Select tree…' : 'No trees yet';
  sel.appendChild(placeholder);
  trees.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.title || t.id;
    sel.appendChild(opt);
  });
	renderTreeList();
}

function createNewTree(){
  const userId = getActiveUsername();
  const title = (document.getElementById('treeTitle').value || '').trim() || 'Untitled Tree';
  const description = document.getElementById('treeDesc').value || '';
  const primaryDomain = (document.getElementById('treeDomain').value || '').trim() || 'general';
  const tags = (document.getElementById('treeTags').value || '').split(',').map(s => s.trim()).filter(Boolean);
  const tree = createCreatorTree(userId, { title, description, primaryDomain, tags });
  _currentTreeId = tree.id;
  _sequence = [];
  loadTreeSelect();
  document.getElementById('treeSelect').value = tree.id;
  renderSequence();
  // Default to visual editor for immediate feedback
  const modeSel = document.getElementById('editorMode');
  if (modeSel) { modeSel.value = 'visual'; onModeChange(); }
  renderToast('New tree created', 'success');
}

function loadSelectedTree(treeId){
  if (!treeId) return;
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, treeId);
  if (!tree) return;
  migratePrivateTreeIfNeeded(userId, tree);
  _currentTreeId = tree.id;
  document.getElementById('treeTitle').value = tree.title || '';
  document.getElementById('treeDesc').value = tree.description || '';
  document.getElementById('treeDomain').value = tree.primaryDomain || '';
  document.getElementById('treeTags').value = (tree.tags || []).join(', ');
  // Derive linear sequence from nodes ordering & nextIds (assume single chain for now)
  // If nodes stored originally in order, use that.
  _sequence = tree.nodes.map(n => n.conceptId);
  renderSequence();
  // Auto-switch to visual view so nodes are visible
  const modeSel = document.getElementById('editorMode');
  if (modeSel) { modeSel.value = 'visual'; onModeChange(); }
  refreshVisualEditor();
  renderIntroVideoPreview();
  renderCloudPublishStatus();
}

function migratePrivateTreeIfNeeded(userId, tree){
  if (!tree) return;
  // Ensure ui.layoutMode default
  tree.ui = tree.ui || { layoutMode: 'top-down' };
  if (!tree.ui.layoutMode) tree.ui.layoutMode = 'top-down';
  // Migrate legacy conceptID / concept_id
  if (Array.isArray(tree.nodes)){
    let changed = false;
    tree.nodes.forEach(n => {
      if (!n) return;
      if (!n.conceptId && n.conceptID){ n.conceptId = n.conceptID; delete n.conceptID; changed = true; }
      if (!n.conceptId && n.concept_id){ n.conceptId = n.concept_id; delete n.concept_id; changed = true; }
    });
    if (changed){
      saveCreatorTrees(userId, loadCreatorTrees(userId));
    } else {
      // Still persist ui layout defaults if newly added
      saveCreatorTrees(userId, loadCreatorTrees(userId));
    }
  }
}

function renderSearchResults(){
  const term = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '';
  if (!term) return;
  const filtered = _searchConcepts.filter(n => {
    const name = (n.title || n.id).toLowerCase();
    const domain = (n.primaryDomain || n.subject || '').toLowerCase();
    const tags = (n.tags || []).join(' ').toLowerCase();
    return name.includes(term) || domain.includes(term) || tags.includes(term);
  }).slice(0, 20);
  filtered.forEach(n => {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = (n.title || n.id) + ((n.primaryDomain || n.subject) ? ' · ' + (n.primaryDomain || n.subject) : '');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn small';
    const already = _sequence.includes(n.id);
    addBtn.textContent = already ? 'Added' : 'Add';
    addBtn.disabled = already || !_currentTreeId;
    addBtn.addEventListener('click', () => {
      if (!_currentTreeId) { renderToast('Create or select a tree first', 'warning'); return; }
      appendConceptToSequence(n.id);
    });
    row.appendChild(label);
    row.appendChild(addBtn);
    resultsEl.appendChild(row);
  });
}

function appendConceptToSequence(conceptId){
  const userId = getActiveUsername();
  let tree = getCreatorTree(userId, _currentTreeId);
  if (!tree) return;
  addNodeToTree(userId, tree.id, conceptId);
  // Re-fetch to ensure we operate on the latest nodes snapshot
  tree = getCreatorTree(userId, _currentTreeId);
  // connect previous to new for linear path
  if (_sequence.length) connectNodes(userId, tree.id, _sequence[_sequence.length - 1], conceptId);
  _sequence.push(conceptId);
  syncTreeLinearEdges(tree);
  renderSequence();
  renderSearchResults();
  // Ensure visual editor is active and refreshed
  const modeSel = document.getElementById('editorMode');
  if (modeSel) { modeSel.value = 'visual'; }
  refreshVisualEditor();
}

function slugifyId(text){
  const base = String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  const ts = Date.now().toString(36);
  return `custom.${getActiveUsername() || 'user'}.${base || 'concept'}.${ts}`;
}

function rebuildConceptIndexes(){
  try {
    _customConcepts = loadCustomConcepts();
    const mergedById = new Map();
    _masterNodes.forEach(n => { if (n && n.id) mergedById.set(n.id, n); });
    _customConcepts.forEach(n => { if (n && n.id && !mergedById.has(n.id)) mergedById.set(n.id, n); });
    _titleIndex = mergedById;
    _combinedIndex = mergedById;
    _searchConcepts = Array.from(mergedById.values());
  } catch {}
}

async function createNewConcept(){
  const msgEl = document.getElementById('createConceptMsg');
  if (msgEl) msgEl.textContent = '';
  const title = (document.getElementById('newConceptTitle')?.value || '').trim();
  const subject = (document.getElementById('newConceptSubject')?.value || '').trim();
  const tagsStr = (document.getElementById('newConceptTags')?.value || '').trim();
  if (!title){ renderToast('Enter a concept title', 'warning'); return; }
  const userId = getActiveUsername();
  if (!userId){ renderToast('No active user', 'error'); return; }
  const idCandidate = slugifyId(title);
  const existing = loadCustomConcepts();
  const allIds = new Set([...(existing || []).map(c => c.id), ..._masterNodes.map(n => n.id)]);
  let id = idCandidate;
  let ctr = 0;
  while (allIds.has(id)) { ctr++; id = idCandidate + '.' + ctr; }
  const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  const concept = {
    id,
    title,
    subject: subject || 'general',
    tags,
    estimatedMinutesToBasicMastery: 20,
    isCustom: true,
    createdBy: userId
  };
  const nextList = Array.isArray(existing) ? existing.slice() : [];
  nextList.push(concept);
  try {
    // Persist
    const { saveCustomConcepts } = await import('./contentLoader.js');
    saveCustomConcepts(nextList);
    rebuildConceptIndexes();
    renderToast('Concept created', 'success');
    // If a node is selected and unbound, bind it; otherwise append to sequence
    const userId2 = getActiveUsername();
    const tree = _currentTreeId ? getCreatorTree(userId2, _currentTreeId) : null;
    const selectedNode = tree && _selectedNodeCid ? tree.nodes.find(n => n.conceptId === _selectedNodeCid) : null;
    if (selectedNode && !selectedNode.conceptId){
      selectedNode.conceptId = concept.id;
      updateCreatorTree(userId2, tree.id, { nodes: tree.nodes });
      renderToast('Bound new concept to selected node', 'success');
      renderInspector();
    } else {
      appendConceptToSequence(concept.id);
    }
    if (msgEl) msgEl.textContent = `Created: ${concept.id}`;
  } catch (e) {
    console.error('Failed to create concept', e);
    renderToast('Failed to create concept', 'error');
  }
}

function syncTreeLinearEdges(tree){
  // For branching mode: only assign a linear nextId if node currently has none.
  const linearEnabled = !!document.getElementById('sequenceLinearToggle')?.checked;
  if (!linearEnabled) { updateCreatorTree(getActiveUsername(), tree.id, { nodes: tree.nodes }); return; }
	const byId = new Map(tree.nodes.map(n => [n.conceptId, n]));
	_sequence.forEach((cid, idx) => {
		const node = byId.get(cid);
		if (!node) return;
		if (!node.nextIds || node.nextIds.length === 0) {
			if (idx < _sequence.length - 1) node.nextIds = [_sequence[idx + 1]]; else node.nextIds = [];
		}
	});
  // Persist updated nodes
  updateCreatorTree(getActiveUsername(), tree.id, { nodes: tree.nodes });
}

function renderSequence(){
  const list = document.getElementById('sequenceList');
  const empty = document.getElementById('sequenceEmpty');
  list.innerHTML = '';
  if (_sequence.length === 0){ empty.classList.remove('hidden'); } else { empty.classList.add('hidden'); }
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  _sequence.forEach((cid, idx) => {
    const concept = (_titleIndex && _titleIndex.get(cid)) || _masterIndex.get(cid);
    const row = document.createElement('div');
    row.className = 'row';
    const title = document.createElement('span');
    title.textContent = `${idx+1}. ${concept ? concept.title : cid}`;
    const controls = document.createElement('div');
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'btn subtle small'; up.textContent = '↑'; up.disabled = idx === 0;
    up.addEventListener('click', () => { moveSequence(idx, idx - 1); });
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'btn subtle small'; down.textContent = '↓'; down.disabled = idx === _sequence.length - 1;
    down.addEventListener('click', () => { moveSequence(idx, idx + 1); });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn subtle small'; remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => { removeSequence(idx); });
		const editUnlock = document.createElement('button');
		editUnlock.type = 'button'; editUnlock.className = 'btn subtle small'; editUnlock.textContent = 'Unlock';
		editUnlock.title = 'Edit unlock conditions';
		editUnlock.addEventListener('click', () => openUnlockEditor(cid));
		const editLinks = document.createElement('button');
		editLinks.type = 'button'; editLinks.className = 'btn subtle small'; editLinks.textContent = 'Links';
		editLinks.title = 'Edit branching links';
		editLinks.addEventListener('click', () => openLinkEditor(cid));
    controls.appendChild(up);
    controls.appendChild(down);
    controls.appendChild(remove);
		controls.appendChild(editUnlock);
		controls.appendChild(editLinks);
    row.appendChild(title);
    row.appendChild(controls);
    list.appendChild(row);
  });
  validateAndShow(tree);
}

function moveSequence(fromIdx, toIdx){
  if (toIdx < 0 || toIdx >= _sequence.length) return;
  const [item] = _sequence.splice(fromIdx, 1);
  _sequence.splice(toIdx, 0, item);
  const tree = getCreatorTree(getActiveUsername(), _currentTreeId);
  if (tree) syncTreeLinearEdges(tree);
  renderSequence();
  refreshVisualEditor();
}

function removeSequence(idx){
  _sequence.splice(idx,1);
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (tree){
    tree.nodes = tree.nodes.filter(n => _sequence.includes(n.conceptId));
    // Adjust root if removed first item
    if (tree.rootConceptId && !tree.nodes.some(n => n.conceptId === tree.rootConceptId)) {
      tree.rootConceptId = tree.nodes.length ? tree.nodes[0].conceptId : '';
    }
    syncTreeLinearEdges(tree);
  }
  renderSequence();
  renderSearchResults();
  refreshVisualEditor();
}

function saveCurrentTree(){
  if (!_currentTreeId){ renderToast('No tree selected', 'warning'); return; }
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (!tree){ renderToast('Tree not found', 'error'); return; }
  // Preserve existing links exactly as-is
  const prevLinks = new Map(tree.nodes.map(n => [n.conceptId, Array.isArray(n.nextIds) ? n.nextIds.slice() : []]));
  // Snapshot current visual positions (even if nodes weren’t dragged)
  try {
    if (_graphApi && typeof _graphApi.getNodePositions === 'function'){
      const pos = _graphApi.getNodePositions();
      tree.nodes.forEach(n => {
        const p = pos.get(n.conceptId);
        if (p && typeof p.x === 'number' && typeof p.y === 'number') n.ui = { x: Math.round(p.x), y: Math.round(p.y) };
      });
    }
  } catch {}
  tree.title = (document.getElementById('treeTitle').value || '').trim() || tree.title;
  tree.description = document.getElementById('treeDesc').value || '';
  tree.primaryDomain = (document.getElementById('treeDomain').value || '').trim() || tree.primaryDomain;
  tree.tags = (document.getElementById('treeTags').value || '').split(',').map(s => s.trim()).filter(Boolean);
  tree.rootConceptId = _sequence.length ? _sequence[0] : '';
  // Persist metadata + nodes in one update (do not alter links on save)
  updateCreatorTree(userId, tree.id, { 
    title: tree.title,
    description: tree.description,
    primaryDomain: tree.primaryDomain,
    tags: tree.tags,
    rootConceptId: tree.rootConceptId,
    nodes: tree.nodes
  });
  // Force-restore links to their previous state, in case any downstream code touched them
  try {
    const restored = getCreatorTree(userId, _currentTreeId);
    if (restored && Array.isArray(restored.nodes)){
      restored.nodes.forEach(n => { const keep = prevLinks.get(n.conceptId); if (keep) n.nextIds = keep.slice(); });
      updateCreatorTree(userId, restored.id, { nodes: restored.nodes });
    }
  } catch {}
  // Intentionally avoid recomputing links here so save doesn't change edges
  renderToast('Tree saved', 'success');
  loadTreeSelect();
  document.getElementById('treeSelect').value = tree.id;
  validateAndShow(tree);
	renderTreeList();
  refreshVisualEditor();
  renderIntroVideoPreview();
}

function publishCurrentTree(){
  if (!_currentTreeId){ renderToast('No tree selected', 'warning'); return; }
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (!tree){ renderToast('Tree not found', 'error'); return; }
  const result = validateCreatorTree(tree, _combinedIndex || _masterIndex);
  if (!result.ok){ renderToast('Fix validation errors before publishing', 'error'); return; }
  try {
    const pub = publishToCatalog(tree);
    renderToast('Published to Courses', 'success');
    // Warn if publish dependency sync found missing concepts
    const missing = getLastPublishMissingConceptIds();
    if (Array.isArray(missing) && missing.length){
      renderToast(`Warning: ${missing.length} concepts referenced by this course were not found and may appear broken for learners.`, 'warning');
    }
    // Attempt cloud publish to Supabase (DAL courses) so courses are public to everyone
    (async () => {
      try {
        // Snapshot current visual positions before publish
        try {
          if (_graphApi && typeof _graphApi.getNodePositions === 'function'){
            const pos = _graphApi.getNodePositions();
            tree.nodes.forEach(n => {
              const p = pos.get(n.conceptId);
              if (p && typeof p.x === 'number' && typeof p.y === 'number') n.ui = { x: Math.round(p.x), y: Math.round(p.y) };
            });
            updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
          }
        } catch {}

        // Pre-publish: upsert referenced concepts and lessons to Supabase (set public)
        const conceptIds = Array.from(new Set((tree.nodes || []).map(n => n.conceptId).filter(Boolean)));
        const lessonIds = new Set();
        (tree.nodes || []).forEach(n => {
          (Array.isArray(n.subtreeLessonIds) ? n.subtreeLessonIds : []).forEach(id => lessonIds.add(id));
          Object.keys(n.subtreeLessonSteps || {}).forEach(id => lessonIds.add(id));
        });
        let conceptsSynced = 0, lessonsSynced = 0;
        for (const cid of conceptIds) {
          const c = (_titleIndex && _titleIndex.get(cid)) || _masterIndex.get(cid) || null;
          if (c && c.id) {
            const payload = { id: c.id, title: c.title || c.id, summary: c.shortDescription || c.longDescription || c.summary || '', domain: c.subject || c.primaryDomain || 'general', tags: Array.isArray(c.tags) ? c.tags : [], is_public: true };
            const { error } = await dsUpsertConcept(payload);
            if (!error) conceptsSynced++;
          }
        }
        for (const lid of Array.from(lessonIds)) {
          const l = _lessonById ? _lessonById.get(lid) : null;
          if (l && l.id) {
            const payload = { id: l.id, title: l.title || l.id, description: l.description || l.summary || '', content_type: l.type || l.contentType || 'article', content_url: (l.media && l.media.url) || l.videoUrl || '', payload: l.contentConfig || {}, is_public: true };
            const { error } = await dsUpsertLesson(payload);
            if (!error) lessonsSynced++;
          }
        }
        if (conceptsSynced || lessonsSynced) {
          renderToast(`Synced ${conceptsSynced} concepts, ${lessonsSynced} lessons to cloud`, 'info');
        }

        // If this tree already has a Supabase row id, update it; else create then mark published
        const supabaseId = tree.supabaseId || null;
        const stableSlug = tree.slug || tree.id;
        if (supabaseId) {
          const { error: upErr } = await dsUpsertCourse({ id: supabaseId, title: tree.title || 'Untitled', description: tree.description || '', slug: stableSlug, tree_json: tree, is_published: true });
          if (!upErr) { renderToast('Cloud course updated', 'info'); renderCloudPublishStatus(); }
        } else {
          const { id, error: upErr } = await dsUpsertCourse({ id: tree.id, title: tree.title || 'Untitled', description: tree.description || '', slug: stableSlug, tree_json: tree, is_published: true });
          if (id && !upErr) { updateCreatorTree(userId, tree.id, { supabaseId: id }); renderToast('Cloud course published', 'success'); renderCloudPublishStatus(); }
        }
      } catch {}
    })();
  } catch(err){ renderToast('Publish failed', 'error'); }
}

function unpublishCurrentTree(){
  if (!_currentTreeId){ renderToast('No tree selected', 'warning'); return; }
  const ok = confirm('Remove this tree from Courses?');
  if (!ok) return;
  try {
    const removed = unpublishFromCatalog(_currentTreeId);
    renderToast(removed ? 'Unpublished from Courses' : 'Not found in Courses', removed ? 'info' : 'warning');
    renderCloudPublishStatus();
    // Also remove from Supabase for the owner if it exists
    (async () => {
      try {
        try {
          // Ensure session is ready before attempting cloud operations
          if (window.supabaseClient && window.supabaseClient.isConfigured()) {
            await window.supabaseClient.waitForSessionReady(2000, 150);
          }
        } catch {}
        // Log auth/session context at delete time
        try {
          const { data } = await (window.supabaseClient ? window.supabaseClient.getSession() : Promise.resolve({ data: null }));
          const sessUser = data && data.session ? data.session.user : null;
          console.debug('[DELETE-DIAG] Auth context at delete', {
            hasSession: !!(data && data.session),
            user_id: sessUser ? sessUser.id : null,
            storageKey: (await import('./config.js')).SUPABASE_STORAGE_KEY || null
          });
        } catch {}
        const userId = getActiveUsername();
        const tree = getCreatorTree(userId, _currentTreeId);
        let supabaseId = tree && tree.supabaseId;
        // If supabaseId is missing, try to resolve by title or tree_json.id from owner trees
        if (!supabaseId) {
          try {
            const { courses } = await dsGetCoursesByUser();
            const match = (courses || []).find(r => {
              const tj = r?.tree_json || {};
              return (r.title === (tree.title || '')) || (tj.id && tj.id === tree.id);
            });
            if (match && match.id) {
              supabaseId = match.id;
              updateCreatorTree(userId, tree.id, { supabaseId });
            }
          } catch {}
        }
        if (supabaseId) {
          const { ok, error } = await dsDeleteCourse(supabaseId);
          if (ok && !error) {
            updateCreatorTree(userId, tree.id, { supabaseId: null });
            renderToast('Cloud course removed', 'info');
            renderCloudPublishStatus();
          } else {
            console.warn('Cloud delete failed', error);
            // Fallback: mark as not published in cloud so it is no longer public
            const { error: upErr } = await dsUpsertCourse({ id: supabaseId, is_published: false });
            if (!upErr) {
              renderToast('Cloud course set to draft (unpublished)', 'info');
              renderCloudPublishStatus();
            } else {
              renderToast('Cloud unpublish failed', 'error');
            }
          }
        } else {
          // Try by local id match inside tree_json as a fallback
          const del = await sbDeleteByLocalId(tree.id);
          if (del.ok) {
            updateCreatorTree(userId, tree.id, { supabaseId: null });
            renderToast('Cloud course removed (by local id)', 'info');
            renderCloudPublishStatus();
          } else {
            const up = await sbUnpublishByLocalId(tree.id);
            if (up.ok) {
              renderToast('Cloud course set to draft (by local id)', 'info');
              renderCloudPublishStatus();
            } else {
              renderToast('Cloud id not found; could not unpublish', 'warning');
            }
          }
        }
      } catch {}
    })();
  } catch{ renderToast('Unpublish failed', 'error'); }
}

function renderCloudPublishStatus(){
  try {
    const el = document.getElementById('cloudPublishStatus');
    if (!el) return;
    const sb = window.supabaseClient;
    if (!sb || !sb.isConfigured || !sb.isConfigured()) { el.textContent = 'Cloud: Not connected — local only'; return; }
    sb.getSession().then(({ data }) => {
      const user = data && data.session ? data.session.user : null;
      if (!user) { el.textContent = 'Cloud: Not signed in — local only'; return; }
      const userId = getActiveUsername();
      const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
      if (!tree || !tree.supabaseId) { el.textContent = 'Cloud: Local only — not published'; return; }
      // Verify published state from cloud for owner (DAL)
      (async () => {
        try {
          const { courses } = await dsGetCoursesByUser();
          const row = (courses || []).find(r => r.id === tree.supabaseId);
          if (row && row.is_published) el.textContent = 'Cloud: Published';
          else el.textContent = 'Cloud: Draft — not public';
        } catch {
          el.textContent = 'Cloud: Published (status sync unavailable)';
        }
      })();
    }).catch(() => { el.textContent = 'Cloud: Local only — not published'; });
  } catch {}
}

function deleteCurrentTree(){
  if (!_currentTreeId){ renderToast('No tree selected', 'warning'); return; }
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (!tree){ renderToast('Tree not found', 'error'); return; }
  const ok = confirm('Delete this tree from your workspace? This cannot be undone.');
  if (!ok) return;
  try {
    // Attempt to unpublish from catalog if present
    try { unpublishFromCatalog(tree.id); } catch {}
    // Delete from user storage
    deleteCreatorTree(userId, tree.id);
    // Reset editor state
    _currentTreeId = null; _sequence = []; _selectedNodeCid = null;
    // Clear form fields
    document.getElementById('treeTitle').value = '';
    document.getElementById('treeDesc').value = '';
    document.getElementById('treeDomain').value = '';
    document.getElementById('treeTags').value = '';
    // Refresh UI
    loadTreeSelect();
    renderSequence();
    refreshVisualEditor();
    renderIntroVideoPreview();
    renderToast('Tree deleted', 'info');
  } catch (e) {
    console.error('Delete tree failed', e);
    renderToast('Failed to delete tree', 'error');
  }
}

function exportCurrentTree(){
  if (!_currentTreeId){ renderToast('Select a tree first', 'warning'); return; }
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (!tree){ renderToast('Tree not found', 'error'); return; }
  const data = exportCreatorTree(tree);
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    const safeTitle = (tree.title||'tree').replace(/[^a-z0-9-_]+/gi,'_').toLowerCase();
    a.download = `creator_tree_${safeTitle}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    renderToast('Tree exported', 'success');
  } catch { renderToast('Export failed', 'error'); }
	renderTreeList();
}

function handleImportTree(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  file.text().then(text => {
    try {
      const data = JSON.parse(text);
      const userId = getActiveUsername();
      const tree = importCreatorTree(userId, data, _combinedIndex || _masterIndex);
      _currentTreeId = tree.id;
      _sequence = tree.nodes.map(n => n.conceptId);
      renderToast('Tree imported', 'success');
      loadTreeSelect();
      document.getElementById('treeSelect').value = tree.id;
      renderSequence();
      refreshVisualEditor();
    } catch (err){
      renderToast(err.message || 'Import failed', 'error');
    } finally { e.target.value=''; }
		renderTreeList();
  });
}

function saveCurrentLayout(){
  if (!_currentTreeId){ renderToast('No tree selected', 'warning'); return; }
  const userId = getActiveUsername();
  const tree = getCreatorTree(userId, _currentTreeId);
  if (!tree){ renderToast('Tree not found', 'error'); return; }
  if (!_graphApi || typeof _graphApi.getNodePositions !== 'function'){ renderToast('Open Visual Editor to save layout', 'warning'); return; }
  try {
    // Preserve existing links exactly as-is
    const prevLinks = new Map(tree.nodes.map(n => [n.conceptId, Array.isArray(n.nextIds) ? n.nextIds.slice() : []]));
    // Snapshot positions
    const pos = _graphApi.getNodePositions();
    tree.nodes.forEach(n => {
      const p = pos.get(n.conceptId);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') n.ui = { x: Math.round(p.x), y: Math.round(p.y) };
    });
    updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
    // Restore links just in case any downstream logic touched them
    try {
      const restored = getCreatorTree(userId, _currentTreeId);
      if (restored && Array.isArray(restored.nodes)){
        restored.nodes.forEach(n => { const keep = prevLinks.get(n.conceptId); if (keep) n.nextIds = keep.slice(); });
        updateCreatorTree(userId, restored.id, { nodes: restored.nodes });
      }
    } catch {}
    renderToast('Layout saved', 'success');
    refreshVisualEditor();
  } catch {
    renderToast('Failed to save layout', 'error');
  }
}

function validateAndShow(tree){
  const errorsEl = document.getElementById('validationErrors');
  if (!tree){ errorsEl.textContent=''; return; }
  const result = validateCreatorTree(tree, _combinedIndex || _masterIndex);
  if (result.ok) {
    errorsEl.textContent = 'Tree valid';
    errorsEl.classList.remove('error-text');
    errorsEl.classList.add('success-text');
  } else {
    errorsEl.textContent = result.errors.join('\n');
    errorsEl.classList.remove('success-text');
    errorsEl.classList.add('error-text');
  }
}

function renderTreeList(){
	const list = document.getElementById('treeList');
	if (!list) return;
	const userId = getActiveUsername();
	const trees = loadCreatorTrees(userId);
	list.innerHTML = '';
	if (!trees.length){
		const empty = document.createElement('div');
		empty.className = 'short';
		empty.textContent = 'No trees created yet.';
		list.appendChild(empty);
		return;
	}
	trees.forEach(t => {
		const row = document.createElement('div');
		row.className = 'row';
		const title = document.createElement('span');
		title.textContent = t.title || t.id;
		const actions = document.createElement('div');
		const loadBtn = document.createElement('button');
		loadBtn.type = 'button'; loadBtn.className = 'btn subtle small'; loadBtn.textContent = 'Load';
		loadBtn.addEventListener('click', () => { loadSelectedTree(t.id); document.getElementById('treeSelect').value = t.id; });
		const expBtn = document.createElement('button');
		expBtn.type = 'button'; expBtn.className = 'btn subtle small'; expBtn.textContent = 'Export';
		expBtn.addEventListener('click', () => {
			const data = exportCreatorTree(t);
			try {
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
				const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url;
				const safeTitle = (t.title||'tree').replace(/[^a-z0-9-_]+/gi,'_').toLowerCase();
				a.download = `creator_tree_${safeTitle}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
				renderToast('Tree exported', 'success');
			} catch { renderToast('Export failed', 'error'); }
		});
		const delBtn = document.createElement('button');
		delBtn.type = 'button'; delBtn.className = 'btn subtle small'; delBtn.textContent = 'Delete';
		delBtn.addEventListener('click', () => {
			const ok = confirm('Delete this tree?');
			if (!ok) return;
			deleteCreatorTree(userId, t.id);
			if (_currentTreeId === t.id){ _currentTreeId = null; _sequence = []; }
			renderToast('Tree deleted', 'info');
			loadTreeSelect();
			renderSequence();
		});
		actions.appendChild(loadBtn);
		actions.appendChild(expBtn);
		actions.appendChild(delBtn);
		row.appendChild(title);
		row.appendChild(actions);
		list.appendChild(row);
	});
}

function renderIntroVideoPreview(){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  const preview = document.getElementById('introVideoPreview');
  if (!preview) return;
  if (!tree || !tree.introVideoUrl){
    preview.textContent = 'No intro video uploaded.';
  } else {
    preview.innerHTML = `Intro video set: <a href="${tree.introVideoUrl}" target="_blank">${tree.introVideoUrl}</a>`;
  }
}

async function uploadIntroVideo(){
  renderToast('Uploads are not supported on GitHub Pages. Please host your video (e.g., in assets/video) and use a direct URL.', 'warning');
}

function clearIntroVideo(){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree){ renderToast('Select or create a tree first', 'warning'); return; }
  updateCreatorTree(userId, tree.id, { introVideoUrl: '' });
  renderToast('Intro video removed', 'info');
  renderIntroVideoPreview();
}

// Unlock editor logic
const unlockEditor = document.getElementById('unlockEditor');
const unlockTarget = document.getElementById('unlockTarget');
const unlockRequiredIds = document.getElementById('unlockRequiredIds');
const unlockMinBadge = document.getElementById('unlockMinBadge');
const unlockSaveBtn = document.getElementById('unlockSaveBtn');
const unlockCancelBtn = document.getElementById('unlockCancelBtn');
const unlockErr = document.getElementById('unlockErr');

// Link editor elements
const linkEditor = document.getElementById('linkEditor');
const linkTarget = document.getElementById('linkTarget');
const linkOptions = document.getElementById('linkOptions');
const linkSaveBtn = document.getElementById('linkSaveBtn');
const linkCancelBtn = document.getElementById('linkCancelBtn');
const linkErr = document.getElementById('linkErr');

function openUnlockEditor(conceptId){
	const userId = getActiveUsername();
	const tree = getCreatorTree(userId, _currentTreeId);
	if (!tree) { renderToast('No tree loaded', 'warning'); return; }
	_unlockEditConceptId = conceptId;
  const node = tree.nodes.find(n => n.conceptId === conceptId);
  const concept = (_titleIndex && _titleIndex.get(conceptId)) || _masterIndex.get(conceptId);
	unlockTarget.textContent = concept ? `Editing: ${concept.title}` : conceptId;
	unlockRequiredIds.value = (node?.unlockConditions?.requiredConceptIds || []).join(', ');
	unlockMinBadge.value = (node?.unlockConditions?.minBadge || 'none');
	unlockErr.textContent = '';
	unlockEditor.classList.remove('hidden');
}

unlockCancelBtn.addEventListener('click', () => {
	unlockEditor.classList.add('hidden');
	_unlockEditConceptId = null;
	unlockErr.textContent='';
});

unlockSaveBtn.addEventListener('click', () => {
	if (!_unlockEditConceptId){ return; }
	const userId = getActiveUsername();
	const tree = getCreatorTree(userId, _currentTreeId);
	if (!tree){ renderToast('Tree not found', 'error'); return; }
	const requiredRaw = unlockRequiredIds.value.split(',').map(s => s.trim()).filter(Boolean);
	// Validate concept IDs exist in Master Graph
  for (const rc of requiredRaw){
    if (!((_combinedIndex && _combinedIndex.get(rc)) || _masterIndex.get(rc))){ unlockErr.textContent = `Unknown conceptId: ${rc}`; return; }
  }
	const minBadge = unlockMinBadge.value || 'none';
	updateUnlockConditions(userId, tree.id, _unlockEditConceptId, { requiredConceptIds: requiredRaw, minBadge });
	unlockEditor.classList.add('hidden');
	_unlockEditConceptId = null;
	unlockErr.textContent='';
	renderToast('Unlock conditions saved', 'success');
	// Revalidate
  validateAndShow(tree);
});

function openLinkEditor(conceptId){
	const userId = getActiveUsername();
	const tree = getCreatorTree(userId, _currentTreeId);
	if (!tree){ renderToast('No tree loaded', 'warning'); return; }
	_linkEditConceptId = conceptId;
  const node = tree.nodes.find(n => n.conceptId === conceptId);
  const concept = (_titleIndex && _titleIndex.get(conceptId)) || _masterIndex.get(conceptId);
	linkTarget.textContent = concept ? `Links for: ${concept.title}` : conceptId;
	linkErr.textContent='';
	// Build options: other nodes except this
	linkOptions.innerHTML = '';
	const currentLinks = new Set((node?.nextIds || []));
	tree.nodes.filter(n => n.conceptId !== conceptId).forEach(n => {
		const optRow = document.createElement('div'); optRow.className='row';
		const label = document.createElement('label'); label.style.display='flex'; label.style.alignItems='center'; label.style.gap='0.5rem';
		const cb = document.createElement('input'); cb.type='checkbox'; cb.value=n.conceptId; cb.checked=currentLinks.has(n.conceptId);
		cb.addEventListener('change', () => {});
		label.appendChild(cb);
    const span = document.createElement('span'); span.textContent = (_titleIndex && _titleIndex.get(n.conceptId)?.title) || _masterIndex.get(n.conceptId)?.title || n.conceptId; label.appendChild(span);
		optRow.appendChild(label); linkOptions.appendChild(optRow);
	});
	linkEditor.classList.remove('hidden');
}

linkCancelBtn && linkCancelBtn.addEventListener('click', () => {
	linkEditor.classList.add('hidden');
	_linkEditConceptId = null; linkErr.textContent='';
});

linkSaveBtn && linkSaveBtn.addEventListener('click', () => {
	if (!_linkEditConceptId) return;
	const userId = getActiveUsername();
	const tree = getCreatorTree(userId, _currentTreeId);
	if (!tree){ renderToast('Tree not found', 'error'); return; }
	const chosen = [...linkOptions.querySelectorAll('input[type="checkbox"]')].filter(cb => cb.checked).map(cb => cb.value);
	// Basic cycle guard (prevent direct self link - already excluded; deeper cycles caught by validation)
	setNodeNextIds(userId, tree.id, _linkEditConceptId, chosen);
	linkEditor.classList.add('hidden'); _linkEditConceptId = null; linkErr.textContent='';
	renderToast('Links saved', 'success');
	validateAndShow(tree);
  refreshVisualEditor();
});
// NOTE: Removed legacy concept/lesson creation wizard code to avoid duplicate imports and redeclarations.

function onModeChange(){
  const mode = document.getElementById('editorMode')?.value;
  const ve = document.getElementById('visualEditor');
  if (!ve) return;
  if (mode === 'visual') { ve.classList.remove('hidden'); refreshVisualEditor(); }
  else { ve.classList.add('hidden'); }
}

function refreshVisualEditor(){
  const mode = document.getElementById('editorMode')?.value;
  if (mode !== 'visual') return;
  const container = document.getElementById('creatorGraphContainer');
  if (!container) return;
  // Preserve current viewport transform across re-render
  let prevTransform = null;
  if (_graphApi && typeof _graphApi.getTransform === 'function'){
    try { prevTransform = _graphApi.getTransform(); } catch {}
  }
  container.innerHTML='';
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !tree.nodes || !tree.nodes.length) return;
  _graphApi = renderSubtreeGraph(container, tree, {
    mode: 'editor',
    getNodeTitle: (node) => node.conceptId ? (((_titleIndex && _titleIndex.get(node.conceptId)?.title) || _masterIndex.get(node.conceptId)?.title || node.conceptId)) : '(Unbound)',
    getNodeStatus: (node) => ({ locked:false, visited:false, unlocked: !!node.conceptId, unbound: !node.conceptId }),
    getNodeLessonCounts: (node) => getLessonTypeCountsForNode(tree, node),
    onSelect: (node) => { _selectedNodeCid = node.conceptId || null; renderInspector(); },
    onNodePositionChanged: (cid, x, y) => {
      const t = getCreatorTree(userId, _currentTreeId);
      const n = t.nodes.find(nn => nn.conceptId === cid);
      n.ui = { x: Math.round(x), y: Math.round(y) };
      updateCreatorTree(userId, t.id, { nodes: t.nodes });
    }
  });
  // Restore previous transform if available
  if (prevTransform && _graphApi && typeof _graphApi.setGraphTransform === 'function'){
    _graphApi.setGraphTransform(prevTransform);
  } else if (_graphApi && typeof _graphApi.fitGraphToViewport === 'function') {
    // Auto-fit on initial render when no prior transform
    try { _graphApi.fitGraphToViewport(); } catch {}
  }
  const snapToggle = document.getElementById('snapToggle');
  if (snapToggle && _graphApi && _graphApi.setSnapEnabled){ _graphApi.setSnapEnabled(snapToggle.checked); }
  renderInspector();
}

function getLessonTypeCountsForNode(tree, node){
  try {
    const cid = node && node.conceptId;
    if (!cid) return { video:0, game:0, quiz:0, external:0 };
    // Count only lessons explicitly attached to this node (selected in inspector)
    const ids = new Set();
    (Array.isArray(node.subtreeLessonIds) ? node.subtreeLessonIds : []).forEach(id => ids.add(id));
    Object.keys(node.subtreeLessonSteps || {}).forEach(id => ids.add(id));
    if (!ids.size) return { video:0, game:0, quiz:0, external:0 };
    const list = Array.from(ids).map(id => _lessonById.get(id)).filter(Boolean);
    let video=0, game=0, quiz=0, external=0;
    list.forEach(l => {
      const t = String(l?.type || '').toLowerCase();
      if (t === 'video') video += 1;
      else if (t === 'unity_game' || t === 'game') game += 1;
      else if (t === 'quiz') quiz += 1;
      else if (t === 'external_link' || t === 'external' || t === 'link') external += 1;
    });
    return { video, game, quiz, external };
  } catch { return { video:0, game:0, quiz:0, external:0 }; }
}

function renderInspector(){
  const panel = document.getElementById('inspectorPanel');
  if (!panel) return;
  const titleEl = document.getElementById('insSelTitle');
  const idEl = document.getElementById('insSelId');
  const boundRow = document.getElementById('insBoundRow');
  const msg = document.getElementById('insBindMsg');
  const searchInput = document.getElementById('insSearchInput');
  const resultsEl = document.getElementById('insResults');
  const delBtn = document.getElementById('insDeleteBtn');
  const lessonsEmpty = document.getElementById('insLessonsEmpty');
  const lessonsSearchInput = document.getElementById('insLessonsSearchInput');
  const lessonsResultsEl = document.getElementById('insLessonsResults');
  const lessonsSelectedEl = document.getElementById('insLessonsSelected');
  resultsEl.innerHTML = '';
  msg.textContent = '';
  if (lessonsResultsEl) lessonsResultsEl.innerHTML = '';
  if (lessonsSelectedEl) lessonsSelectedEl.innerHTML = '';
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !_selectedNodeCid){
    titleEl.textContent = 'No node selected';
    idEl.textContent = '';
    boundRow.classList.add('hidden');
    if (delBtn) { delBtn.disabled = true; }
    if (lessonsEmpty) lessonsEmpty.classList.remove('hidden');
    if (lessonsSearchInput) { lessonsSearchInput.disabled = true; }
    return;
  }
  const node = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  const label = node?.conceptId ? (_masterIndex.get(node.conceptId)?.title || node.conceptId) : '(Unbound)';
  // Prefer combined title if available
  const combined = (node?.conceptId && _titleIndex && _titleIndex.get(node.conceptId)?.title) || null;
  if (combined) { titleEl.textContent = combined; } else { titleEl.textContent = label; }
  idEl.textContent = node?.conceptId || '';
  if (node?.conceptId){
    boundRow.textContent = 'Node is bound. Use “Link to Concept” below to add child links.';
    boundRow.classList.remove('hidden');
    if (lessonsEmpty) lessonsEmpty.classList.add('hidden');
    if (lessonsSearchInput && !lessonsSearchInput._wired){
      lessonsSearchInput._wired = true;
      lessonsSearchInput.addEventListener('input', () => renderInspectorLessonSearchResults());
    }
    if (lessonsSearchInput) lessonsSearchInput.disabled = false;
    // Populate initial results without requiring a search term
    renderInspectorLessonSearchResults();
    renderInspectorLessonsSelectedList(node.conceptId);
    // Also render current links for this node
    renderInspectorCurrentLinks(node.conceptId);
  } else {
    boundRow.textContent = 'Unbound node. Link tool requires a bound node.';
    boundRow.classList.remove('hidden');
    if (lessonsEmpty) lessonsEmpty.classList.remove('hidden');
    if (lessonsSearchInput) { lessonsSearchInput.disabled = true; }
    if (searchInput) { searchInput.disabled = true; }
    const cl = document.getElementById('insCurrentLinks');
    if (cl) cl.innerHTML = '';
  }
  if (delBtn && !delBtn._wired){
    delBtn._wired = true;
    delBtn.addEventListener('click', () => deleteSelectedNode());
  }
  if (delBtn) { delBtn.disabled = false; }
  if (searchInput && !searchInput._wired){
    searchInput._wired = true;
    searchInput.addEventListener('input', () => renderInspectorResults());
  }
  renderInspectorResults();
}

async function renderInspectorLessonsSelectedList(conceptId){
  const renderId = ++_insLessonsSelectedRenderTick;
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  const listEl = document.getElementById('insLessonsSelected');
  const emptyEl = document.getElementById('insLessonsEmpty');
  if (!tree || !conceptId || !listEl) return;
  listEl.innerHTML = '';
  const node = tree.nodes.find(n => n.conceptId === conceptId) || null;
  // Normalize to unique IDs to prevent duplicate rows lingering in state
  let ids = (node && Array.isArray(node.subtreeLessonIds)) ? node.subtreeLessonIds.slice() : [];
  if (ids.length){
    const uniq = Array.from(new Set(ids));
    if (uniq.length !== ids.length){
      ids = uniq;
      node.subtreeLessonIds = uniq;
      updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
    }
  }
  if (!ids.length){ emptyEl && emptyEl.classList.remove('hidden'); return; } else { emptyEl && emptyEl.classList.add('hidden'); }
  const lessons = await loadAllLessons();
  // Abort if a newer render started while awaiting lessons
  if (renderId !== _insLessonsSelectedRenderTick) return;
  const byId = new Map(lessons.map(l => [l.id, l]));
  ids.forEach(id => {
    if (renderId !== _insLessonsSelectedRenderTick) return;
    const l = byId.get(id);
    if (!l) return;
    const row = document.createElement('div'); row.className = 'row';
    const title = document.createElement('span'); title.textContent = l.title || l.id; row.appendChild(title);
    const meta = document.createElement('span'); meta.className='short muted'; meta.style.marginLeft='auto'; meta.textContent = `${String(l.difficulty||'beginner')}`; row.appendChild(meta);
    const stepWrap = document.createElement('label'); stepWrap.className='short muted'; stepWrap.style.marginLeft='0.5rem'; stepWrap.style.display='flex'; stepWrap.style.alignItems='center'; stepWrap.style.gap='0.25rem';
    stepWrap.textContent = 'Step:';
    const stepSel = document.createElement('select');
    for (let i=1;i<=10;i++){ const opt=document.createElement('option'); opt.value=String(i); opt.textContent=String(i); stepSel.appendChild(opt);}    
    const stepMap = (node && node.subtreeLessonSteps && typeof node.subtreeLessonSteps === 'object') ? node.subtreeLessonSteps : {};
    const currentStep = Number(stepMap[id] || 1);
    stepSel.value = String(currentStep);
    stepSel.addEventListener('change', () => {
      const s = Number(stepSel.value)||1;
      const freshTree = getCreatorTree(userId, _currentTreeId);
      const freshNode = freshTree.nodes.find(n => n.conceptId === conceptId);
      freshNode.subtreeLessonSteps = freshNode.subtreeLessonSteps && typeof freshNode.subtreeLessonSteps==='object' ? freshNode.subtreeLessonSteps : {};
      freshNode.subtreeLessonSteps[id] = s;
      updateCreatorTree(userId, freshTree.id, { nodes: freshTree.nodes });
      renderToast(`Assigned to Step ${s}`, 'success');
    });
    stepWrap.appendChild(stepSel);
    row.appendChild(stepWrap);
    const removeBtn = document.createElement('button'); removeBtn.type='button'; removeBtn.className='btn small secondary'; removeBtn.textContent='Remove';
    removeBtn.addEventListener('click', () => removeSelectedLessonFromNode(id));
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  });
}

async function renderInspectorLessonSearchResults(){
  const renderId = ++_insLessonsSearchRenderTick;
  const resultsEl = document.getElementById('insLessonsResults');
  const searchInput = document.getElementById('insLessonsSearchInput');
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!resultsEl || !searchInput || !tree || !_selectedNodeCid) return;
  resultsEl.innerHTML = '';
  const node = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  if (!node || !node.conceptId) return;
  const term = (searchInput.value || '').trim().toLowerCase();
  const allLessons = await loadAllLessons();
  // Abort if a newer render started while awaiting lessons
  if (renderId !== _insLessonsSearchRenderTick) return;
  const existingIds = new Set(Array.isArray(node.subtreeLessonIds) ? node.subtreeLessonIds : []);
  // Deduplicate by lesson id before filtering to prevent duplicate rows
  const byId = new Map();
  (allLessons || []).forEach(l => {
    if (!l || !l.id) return;
    if (l.conceptId !== node.conceptId) return;
    if (!byId.has(l.id)) byId.set(l.id, l);
  });
  const pool = Array.from(byId.values());
  const hits = pool.filter(l => {
    const t = (l.title || l.id || '').toLowerCase();
    const d = (l.description || '').toLowerCase();
    return !term || t.includes(term) || d.includes(term);
  }).slice(0, 25);
  hits.forEach(l => {
    if (renderId !== _insLessonsSearchRenderTick) return;
    const row = document.createElement('div'); row.className = 'row';
    const title = document.createElement('span'); title.textContent = l.title || l.id; row.appendChild(title);
    // Add lesson type label next to title for clarity
    const rawType = (l.type || l.contentType || 'core').toString();
    const typeLabel = rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const typeChip = document.createElement('span');
    typeChip.className = 'chip chip--type';
    typeChip.title = 'Lesson type';
    typeChip.textContent = typeLabel;
    // Place type chip before the Add button
    row.appendChild(typeChip);
    const add = document.createElement('button'); add.type='button'; add.className='btn small'; add.textContent = existingIds.has(l.id) ? 'Added' : 'Add';
    add.disabled = existingIds.has(l.id);
    add.addEventListener('click', () => addSelectedLessonToNode(l.id));
    row.appendChild(add);
    resultsEl.appendChild(row);
  });
}

function addSelectedLessonToNode(lessonId){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !_selectedNodeCid) return;
  const node = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  if (!node || !node.conceptId) { renderToast('Bind to a concept first', 'warning'); return; }
  const ids = Array.isArray(node.subtreeLessonIds) ? node.subtreeLessonIds : [];
  if (!ids.includes(lessonId)) ids.push(lessonId);
  // Enforce uniqueness to avoid duplicates from rapid clicks or prior state
  node.subtreeLessonIds = Array.from(new Set(ids));
  // Default new lessons to Step 1 unless specified later
  node.subtreeLessonSteps = node.subtreeLessonSteps && typeof node.subtreeLessonSteps==='object' ? node.subtreeLessonSteps : {};
  if (!node.subtreeLessonSteps[lessonId]) node.subtreeLessonSteps[lessonId] = 1;
  updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
  renderToast('Lesson selected for subtree', 'success');
  // Refresh node chips in the visual editor immediately
  try { refreshVisualEditor(); } catch {}
}

function removeSelectedLessonFromNode(lessonId){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !_selectedNodeCid) return;
  const node = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  if (!node || !Array.isArray(node.subtreeLessonIds)) return;
  node.subtreeLessonIds = Array.from(new Set(node.subtreeLessonIds.filter(id => id !== lessonId)));
  if (node.subtreeLessonSteps && typeof node.subtreeLessonSteps==='object'){ delete node.subtreeLessonSteps[lessonId]; }
  updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
  renderToast('Lesson removed from subtree', 'info');
  // Refresh node chips to reflect removal
  try { refreshVisualEditor(); } catch {}
}

function renderInspectorResults(){
  const resultsEl = document.getElementById('insResults');
  const searchInput = document.getElementById('insSearchInput');
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  resultsEl.innerHTML = '';
  if (!tree || !_selectedNodeCid) return;
  const node = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  if (!node || !node.conceptId){
    const msg = document.getElementById('insBindMsg');
    if (msg) msg.textContent = 'Select a bound node to link concepts.';
    return;
  }
  const term = (searchInput?.value || '').trim().toLowerCase();
  // Restrict to concepts already present in the current tree (excluding selected)
  const candidates = (tree.nodes || [])
    .filter(n => n.conceptId && n.conceptId !== _selectedNodeCid)
    .map(n => {
      const c = (_titleIndex && _titleIndex.get(n.conceptId)) || _masterIndex.get(n.conceptId) || { id:n.conceptId, title:n.conceptId };
      return {
        id: n.conceptId,
        title: c.title || n.conceptId,
        domain: (c.primaryDomain || c.subject || ''),
        tags: Array.isArray(c.tags) ? c.tags : []
      };
    });
  const filtered = (term ? candidates.filter(c => {
    const t = (c.title || c.id).toLowerCase();
    const d = String(c.domain || '').toLowerCase();
    const tg = (c.tags || []).join(' ').toLowerCase();
    return t.includes(term) || d.includes(term) || tg.includes(term);
  }) : candidates).slice(0,25);
  filtered.forEach(c => {
    const row = document.createElement('div'); row.className = 'row';
    const span = document.createElement('span'); span.textContent = c.title || c.id; row.appendChild(span);
    const btn = document.createElement('button'); btn.type='button'; btn.className='btn small'; btn.textContent='Link';
    btn.addEventListener('click', () => linkSelectedNodeToConcept(c.id));
    row.appendChild(btn);
    resultsEl.appendChild(row);
  });
}

function renderInspectorCurrentLinks(conceptId){
  const listEl = document.getElementById('insCurrentLinks');
  if (!listEl) return;
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  listEl.innerHTML = '';
  if (!tree || !conceptId) return;
  const node = tree.nodes.find(n => n.conceptId === conceptId) || null;
  const nextIds = (node && Array.isArray(node.nextIds)) ? node.nextIds.slice() : [];
  if (!nextIds.length){
    const empty = document.createElement('div');
    empty.className = 'short muted';
    empty.textContent = 'No links added yet.';
    listEl.appendChild(empty);
    return;
  }
  nextIds.forEach(nx => {
    const row = document.createElement('div'); row.className = 'row';
    const title = (_titleIndex && _titleIndex.get(nx)?.title) || _masterIndex.get(nx)?.title || nx;
    const label = document.createElement('span'); label.textContent = title; row.appendChild(label);
    const unlinkBtn = document.createElement('button'); unlinkBtn.type='button'; unlinkBtn.className='btn small secondary'; unlinkBtn.textContent='Unlink';
    unlinkBtn.addEventListener('click', () => unlinkSelectedNodeFromConcept(conceptId, nx));
    row.appendChild(unlinkBtn);
    listEl.appendChild(row);
  });
}

function linkSelectedNodeToConcept(targetConceptId){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !_selectedNodeCid) return;
  const fromNode = tree.nodes.find(n => n.conceptId === _selectedNodeCid) || null;
  if (!fromNode || !fromNode.conceptId){ renderToast('Select a bound node first', 'warning'); return; }
  // Only link to nodes already present in the current tree
  const targetNode = tree.nodes.find(n => n.conceptId === targetConceptId) || null;
  if (!targetNode){ renderToast('Concept is not in this tree. Add it first.', 'warning'); return; }
  // Connect from selected to target
  connectNodes(userId, tree.id, fromNode.conceptId, targetConceptId);
  renderToast('Linked concept added', 'success');
  validateAndShow(tree);
  renderInspectorCurrentLinks(fromNode.conceptId);
  refreshVisualEditor();
}

function unlinkSelectedNodeFromConcept(fromConceptId, targetConceptId){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree) return;
  const node = tree.nodes.find(n => n.conceptId === fromConceptId) || null;
  if (!node) return;
  const next = (node.nextIds || []).filter(id => id !== targetConceptId);
  setNodeNextIds(userId, tree.id, fromConceptId, next);
  renderToast('Link removed', 'info');
  validateAndShow(tree);
  renderInspectorCurrentLinks(fromConceptId);
  refreshVisualEditor();
}

function applyAutoLayout(){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree) return;
  tree.nodes.forEach(n => { delete n.ui; });
  updateCreatorTree(userId, tree.id, { nodes: tree.nodes });
  refreshVisualEditor();
}

function deleteSelectedNode(){
  const userId = getActiveUsername();
  const tree = _currentTreeId ? getCreatorTree(userId, _currentTreeId) : null;
  if (!tree || !_selectedNodeCid) { renderToast('No node selected', 'warning'); return; }
  const cid = _selectedNodeCid;
  const exists = tree.nodes.some(n => n.conceptId === cid);
  if (!exists) { renderToast('Node not found', 'error'); return; }
  // Remove edges referencing this node
  tree.nodes.forEach(n => { n.nextIds = (n.nextIds || []).filter(nx => nx !== cid); });
  // Remove the node
  tree.nodes = tree.nodes.filter(n => n.conceptId !== cid);
  // Adjust root if needed
  if (tree.rootConceptId === cid) {
    const first = tree.nodes[0]?.conceptId || '';
    tree.rootConceptId = first;
  }
  // Update sequence and persist
  _sequence = _sequence.filter(s => s !== cid);
  syncTreeLinearEdges(tree);
  updateCreatorTree(userId, tree.id, { nodes: tree.nodes, rootConceptId: tree.rootConceptId });
  _selectedNodeCid = null;
  renderToast('Node deleted', 'info');
  renderInspector();
  refreshVisualEditor();
  renderSequence();
  validateAndShow(tree);
}
