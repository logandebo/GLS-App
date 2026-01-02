import { ensureActiveUserOrRedirect, getActiveUsername } from './storage.js';
import { loadAllConcepts, loadCustomLessons, saveCustomLessons } from './contentLoader.js';
import { showToast } from './ui.js';
import { difficultyIsValid, validateVideoConfig, validateUnityConfig, validateQuizQuestions, validateExternalLinks, validateKeyboardLessonConfig } from './validation.js';

let activeUser = '';
let concepts = [];
let lessons = [];
let selectedId = '';
let searchTerm = '';
let filterType = 'all';
let viewMode = 'list';

function initHeader() {
  const usernameEl = document.getElementById('header-username');
  if (usernameEl && activeUser) usernameEl.textContent = `Logged in as: ${activeUser}`;
  document.getElementById('header-switch-user')?.addEventListener('click', () => { window.location.href = 'auth.html'; });
}

async function init() {
  const user = ensureActiveUserOrRedirect();
  if (!user) return;
  activeUser = getActiveUsername() || user;
  initHeader();
  concepts = await loadAllConcepts();
  lessons = loadCustomLessons();
  // Migrate legacy lessons to set createdBy for the active user's authored items
  // Some older entries used `author` instead of `createdBy`.
  let changed = false;
  lessons.forEach(l => {
    const owner = (l && typeof l.createdBy === 'string') ? l.createdBy : (typeof l.author === 'string' ? l.author : null);
    if (!l.createdBy && owner === activeUser) { l.createdBy = activeUser; changed = true; }
  });
  if (changed) { saveCustomLessons(lessons); }
  populateConceptSelect();
  renderList();
  bindEditorButtons();
  bindListControls();
}

function populateConceptSelect() {
  const sel = document.getElementById('e_concept');
  sel.innerHTML = '';
  concepts.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.title || c.id;
    sel.appendChild(opt);
  });
}

function renderList() {
  const list = document.getElementById('lessonList');
  list.innerHTML = '';
  // Show only lessons owned by the active user (createdBy or legacy author)
  let mine = lessons.filter(l => (l && (l.createdBy === activeUser || l.author === activeUser)));
  // Type filter
  if (filterType && filterType !== 'all') {
    mine = mine.filter(l => (l.type || l.contentType) === filterType);
  }
  // Search filter (title, id, description)
  const q = (searchTerm || '').trim().toLowerCase();
  if (q) {
    mine = mine.filter(l => {
      const title = (l.title || '').toLowerCase();
      const id = (l.id || '').toLowerCase();
      const desc = (l.description || l.summary || '').toLowerCase();
      return title.includes(q) || id.includes(q) || desc.includes(q);
    });
  }
  // Toggle container class for view mode
  if (viewMode === 'grid') {
    list.classList.remove('grid');
    list.classList.add('grid-cards');
    list.style.gridTemplateColumns = '';
  } else {
    list.classList.remove('grid-cards');
    list.classList.add('grid');
    list.style.gridTemplateColumns = '1fr';
  }
  if (mine.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No custom lessons yet.';
    list.appendChild(empty);
    return;
  }
  mine.forEach(l => list.appendChild(viewMode === 'grid' ? cardFor(l) : rowFor(l)));
}

function rowFor(l) {
  const row = document.createElement('div');
  row.className = 'row';
  const title = document.createElement('div');
  title.innerHTML = `<strong>${l.title}</strong><br/><span style="opacity:.7;font-size:.8rem;">${l.id} • ${l.type || l.contentType || 'core'}${l.isPrivate ? ' • Private' : ''}</span>`;
  const editBtn = button('Edit', 'secondary', () => openEditor(l.id));
  const privBtn = button(l.isPrivate ? 'Make Public' : 'Make Private', '', () => togglePrivate(l.id));
  const delBtn = button('Delete', 'subtle', () => deleteLesson(l.id));
  row.appendChild(title);
  row.appendChild(editBtn);
  row.appendChild(privBtn);
  row.appendChild(delBtn);
  return row;
}

function cardFor(l) {
  const card = document.createElement('div');
  card.className = 'ml-card';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = l.title || l.id;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${l.id} • ${l.type || l.contentType || 'core'}${l.isPrivate ? ' • Private' : ''}`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const editBtn = button('Edit', 'secondary', () => openEditor(l.id));
  const privBtn = button(l.isPrivate ? 'Make Public' : 'Make Private', '', () => togglePrivate(l.id));
  const delBtn = button('Delete', 'subtle', () => deleteLesson(l.id));
  actions.appendChild(editBtn);
  actions.appendChild(privBtn);
  actions.appendChild(delBtn);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);
  return card;
}

function button(text, style, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${style}`.trim();
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function openEditor(id) {
  const l = lessons.find(x => x.id === id);
  if (!l) return;
  selectedId = id;
  document.getElementById('e_id').value = l.id;
  document.getElementById('e_concept').value = l.conceptId || '';
  document.getElementById('e_title').value = l.title || '';
  document.getElementById('e_minutes').value = l.minutes || l.estimatedMinutes || '';
  document.getElementById('e_difficulty').value = (typeof l.difficulty === 'string' ? l.difficulty : (Number(l.difficulty) <= 1 ? 'beginner' : Number(l.difficulty) === 2 ? 'intermediate' : 'advanced'));
  document.getElementById('e_xp').value = l.xpReward || 0;
  document.getElementById('e_type').value = l.type || l.contentType || 'video';
  document.getElementById('e_desc').value = l.description || l.summary || '';
  buildTypeSpecific(l.type || l.contentType || 'video', l);
  document.getElementById('editErrors').textContent = '';
  document.getElementById('editorTitle').textContent = `Edit Lesson — ${l.title}`;
}

function buildTypeSpecific(type, l) {
  const wrap = document.getElementById('typeSpecific');
  wrap.innerHTML = '';
  if (type === 'video') {
    wrap.innerHTML = `<label>Video URL <input id="e_video" type="url" /></label>`;
    document.getElementById('e_video').value = l.contentConfig?.video?.url || l.media?.url || '';
  } else if (type === 'unity_game') {
    wrap.innerHTML = `
      <div class="grid-two">
        <label>Unity Build URL
          <input id="e_unity" type="url" placeholder="e.g. /UnityBuilds/ScaleTrainerV2WebGL/index.html" />
        </label>
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <button id="e_unityOpenBtn" type="button" class="btn secondary">Open URL</button>
          <button id="e_unityCheckBtn" type="button" class="btn secondary">Check URL</button>
        </div>
      </div>
      <div class="divider">Upload Guide</div>
      <div class="review-summary" style="font-size:0.75rem;">
        <strong>Place your WebGL build here:</strong>
        <div style="margin:0.35rem 0;">
          UnityBuilds/YourBuildName/
          <br/> ├─ Build/ (contains .wasm/.data/.framework.js/.loader.js or .unityweb)
          <br/> ├─ TemplateData/
          <br/> └─ StreamingAssets/ (if used)
        </div>
        <strong>Then set the URL to:</strong>
        <div style="margin:0.35rem 0; color:#93c5fd;">/UnityBuilds/YourBuildName/index.html</div>
        Notes:
        <ul style="margin:0.35rem 0 0.15rem 1rem; padding:0;">
          <li>Server serves Unity assets with correct types (.wasm/.data/.unityweb, .br/.gz).</li>
          <li>Use Chrome/Edge. Keep relative paths from the generated index.html intact.</li>
          <li>If you see a blank frame, open the URL directly and check console errors.</li>
        </ul>
      </div>
    `;
    const eUnity = document.getElementById('e_unity');
    eUnity.value = l.contentConfig?.unity_game?.url || l.contentConfig?.unity?.url || l.media?.url || '';
    const openBtn = document.getElementById('e_unityOpenBtn');
    openBtn && openBtn.addEventListener('click', () => {
      const url = (document.getElementById('e_unity')?.value || '').trim();
      if (!url) { showToast('Enter a Unity build URL first.', 'error'); return; }
      try { window.open(url, '_blank'); } catch {}
    });
    const checkBtn = document.getElementById('e_unityCheckBtn');
    checkBtn && checkBtn.addEventListener('click', async () => {
      const url = (document.getElementById('e_unity')?.value || '').trim();
      if (!url) { showToast('Enter a Unity build URL first.', 'error'); return; }
      checkBtn.disabled = true;
      try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (resp.ok) {
          showToast('Unity URL is reachable (HTTP ' + resp.status + ')', 'success');
        } else {
          showToast('Unity URL responded with HTTP ' + resp.status, 'error');
        }
      } catch (e) {
        showToast('Failed to reach Unity URL', 'error');
      } finally {
        checkBtn.disabled = false;
      }
    });
  } else if (type === 'quiz') {
    const quiz = (l.contentConfig && l.contentConfig.quiz) || { questions: [] };
    l.contentConfig = l.contentConfig || {}; l.contentConfig.quiz = quiz;
    const addBtn = button('Add Question', 'secondary', () => { quiz.questions.push({ prompt:'', choices:[{text:'', isCorrect:true},{text:'', isCorrect:false}]}); renderQuizEditor(quiz); });
    wrap.appendChild(addBtn);
    const holder = document.createElement('div'); holder.id = 'quizHolder'; wrap.appendChild(holder);
    renderQuizEditor(quiz);
  } else if (type === 'external_link') {
    const existing = (l.contentConfig && l.contentConfig.external_link) || { links: [], previewVideoUrl: '' };
    l.contentConfig = l.contentConfig || {}; l.contentConfig.external_link = existing;
    wrap.innerHTML = `
      <div class="grid-two">
        <div id="ml-linksPanel" class="card" style="padding:0.75rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>External Links</strong>
            <button type="button" id="ml-addLinkBtn" class="btn secondary">Add Link</button>
          </div>
          <div id="ml-linksList" style="margin-top:0.5rem;"></div>
        </div>
        <label>Preview Video URL (optional)
          <input id="ml-previewUrl" type="url" placeholder="e.g. /assets/video/preview.mp4 or https://..." />
        </label>
      </div>`;
    const list = document.getElementById('ml-linksList');
    const addBtn = document.getElementById('ml-addLinkBtn');
    const prev = document.getElementById('ml-previewUrl'); prev.value = existing.previewVideoUrl || '';
    function addRow(url = '', label = ''){
      const row = document.createElement('div'); row.className='grid-two'; row.style.marginBottom='0.5rem';
      const urlInput = document.createElement('input'); urlInput.type='url'; urlInput.placeholder='https://... or /path'; urlInput.value = url;
      const labelInput = document.createElement('input'); labelInput.type='text'; labelInput.placeholder='Button label (optional)'; labelInput.value = label;
      const remove = document.createElement('button'); remove.type='button'; remove.className='btn subtle'; remove.textContent='Remove';
      const left = document.createElement('div'); left.appendChild(urlInput);
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='0.5rem'; right.appendChild(labelInput); right.appendChild(remove);
      row.appendChild(left); row.appendChild(right);
      list.appendChild(row);
      remove.addEventListener('click', () => list.removeChild(row));
    }
    (Array.isArray(existing.links) ? existing.links : []).forEach(x => addRow(x.url || '', x.label || ''));
    addBtn.addEventListener('click', () => addRow());
  } else if (type === 'keyboard_lesson') {
    const kb = (l.contentConfig && l.contentConfig.keyboard_lesson) || { mode:'note', target:'C4', attempts:1, range:'C3-C5', ignoreOctave:false };
    l.contentConfig = l.contentConfig || {}; l.contentConfig.keyboard_lesson = kb;
    wrap.innerHTML = `
      <div class="grid-two">
        <label>Range (low-high)
          <input id="ml-kbRange" type="text" placeholder="e.g. C3-C5" />
        </label>
        <label>Ignore Octave (global)
          <select id="ml-kbIgnoreOctave"><option value="false">No</option><option value="true">Yes</option></select>
        </label>
      </div>
      <div class="divider">Single Target OR Multi-Step Sequence</div>
      <div class="grid-two">
        <label>Single Target Note
          <input id="ml-kbTarget" type="text" placeholder="e.g. C4" />
        </label>
        <label>Attempts Required
          <input id="ml-kbAttempts" type="number" min="1" step="1" value="1" />
        </label>
      </div>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center;">
        <button type="button" id="ml-kbEnableSteps" class="btn secondary">Use Steps</button>
        <span class="short muted">Enable to build multi-step sequence and chords.</span>
      </div>
      <div id="ml-kbStepsPanel" class="card hidden" style="margin-top:0.6rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>Steps</strong>
          <button type="button" id="ml-kbAddStep" class="btn secondary">Add Step</button>
        </div>
        <div id="ml-kbStepsList" style="margin-top:0.5rem;"></div>
      </div>`;
    document.getElementById('ml-kbRange').value = kb.range || 'C3-C5';
    document.getElementById('ml-kbIgnoreOctave').value = kb.ignoreOctave ? 'true' : 'false';
    document.getElementById('ml-kbTarget').value = kb.target || 'C4';
    document.getElementById('ml-kbAttempts').value = kb.attempts || 1;
    const stepsPanel = document.getElementById('ml-kbStepsPanel');
    const list = document.getElementById('ml-kbStepsList');
    const enableBtn = document.getElementById('ml-kbEnableSteps');
    const addBtn = document.getElementById('ml-kbAddStep');
    if (Array.isArray(kb.steps) && kb.steps.length){ stepsPanel.classList.remove('hidden'); kb.steps.forEach(s => addStepRow(list, s)); }
    enableBtn.addEventListener('click', () => stepsPanel.classList.toggle('hidden'));
    addBtn.addEventListener('click', () => addStepRow(list));
  }
}

function renderQuizEditor(quiz) {
  const holder = document.getElementById('quizHolder');
  holder.innerHTML = '';
  quiz.questions.forEach((q, qi) => {
    const box = document.createElement('div');
    box.className = 'ml-quiz-q';
    const prompt = document.createElement('input'); prompt.type = 'text'; prompt.placeholder = `Question ${qi+1}`; prompt.value = q.prompt || ''; prompt.addEventListener('input', () => q.prompt = prompt.value);
    box.appendChild(prompt);
    q.choices = q.choices || [ { text:'', isCorrect:true }, { text:'', isCorrect:false } ];
    q.choices.forEach((c, ci) => {
      const line = document.createElement('div'); line.className='choice';
      const radio = document.createElement('input'); radio.type='radio'; radio.name = `qc_${qi}`; radio.checked = !!c.isCorrect; radio.addEventListener('change', ()=>{ q.choices.forEach((cc,idx)=> cc.isCorrect = idx===ci); });
      const text = document.createElement('input'); text.type='text'; text.placeholder = `Choice ${ci+1}`; text.value = c.text || ''; text.addEventListener('input', ()=> c.text = text.value);
      line.appendChild(radio); line.appendChild(text);
      box.appendChild(line);
    });
    holder.appendChild(box);
  });
}

function bindEditorButtons() {
  document.getElementById('e_type').addEventListener('change', e => {
    const l = lessons.find(x => x.id === selectedId) || {};
    const type = e.target.value;
    l.type = type; // temp local value
    buildTypeSpecific(type, l);
  });
  document.getElementById('saveBtn').addEventListener('click', saveEdits);
  document.getElementById('discardBtn').addEventListener('click', () => { if (selectedId) openEditor(selectedId); });
}

function bindListControls() {
  const searchEl = document.getElementById('ml-search');
  const typeEl = document.getElementById('ml-filter-type');
  const listBtn = document.getElementById('ml-view-list');
  const gridBtn = document.getElementById('ml-view-grid');
  if (searchEl) searchEl.addEventListener('input', (e) => { searchTerm = e.target.value || ''; renderList(); });
  if (typeEl) typeEl.addEventListener('change', (e) => { filterType = e.target.value || 'all'; renderList(); });
  if (listBtn) listBtn.addEventListener('click', () => { viewMode = 'list'; renderList(); });
  if (gridBtn) gridBtn.addEventListener('click', () => { viewMode = 'grid'; renderList(); });
}

function addStepRow(list, step = { prompt:'', targets:'C4', simultaneous:false, ignoreOctave:false }){
  const row = document.createElement('div'); row.className = 'grid-two'; row.style.marginBottom = '0.5rem';
  const prompt = document.createElement('input'); prompt.type='text'; prompt.placeholder='Prompt (optional)'; prompt.value = step.prompt || '';
  const targets = document.createElement('input'); targets.type='text'; targets.placeholder='Targets (comma-separated notes e.g. C4,E4,G4)'; targets.value = Array.isArray(step.targets) ? step.targets.join(',') : (step.targets || 'C4');
  const simultaneous = document.createElement('select'); simultaneous.innerHTML = '<option value="false">Single note</option><option value="true">Simultaneous (chord)</option>'; simultaneous.value = step.simultaneous ? 'true':'false';
  const ignoreOct = document.createElement('select'); ignoreOct.innerHTML = '<option value="false">Exact note</option><option value="true">Ignore octave</option>'; ignoreOct.value = step.ignoreOctave ? 'true':'false';
  const remove = document.createElement('button'); remove.type='button'; remove.className='btn subtle'; remove.textContent='Remove';
  const left = document.createElement('div'); left.appendChild(prompt);
  const right = document.createElement('div'); right.style.display='flex'; right.style.gap='0.5rem'; right.appendChild(targets); right.appendChild(simultaneous); right.appendChild(ignoreOct); right.appendChild(remove);
  row.appendChild(left); row.appendChild(right);
  list.appendChild(row);
  remove.addEventListener('click', () => list.removeChild(row));
}

function collectEditor() {
  const l = lessons.find(x => x.id === selectedId);
  if (!l) return null;
  const type = document.getElementById('e_type').value;
  const updated = {
    ...l,
    conceptId: document.getElementById('e_concept').value,
    title: document.getElementById('e_title').value.trim(),
    minutes: Number(document.getElementById('e_minutes').value) || 0,
    difficulty: document.getElementById('e_difficulty').value,
    xpReward: Number(document.getElementById('e_xp').value) || 0,
    type,
    description: document.getElementById('e_desc').value.trim(),
    createdBy: l.createdBy || activeUser,
    isCustom: true,
    contentConfig: { ...(l.contentConfig||{}) }
  };
  if (type === 'video') {
    const url = document.getElementById('e_video').value.trim();
    updated.contentConfig.video = { url };
  } else if (type === 'unity_game') {
    const url = document.getElementById('e_unity').value.trim();
    updated.contentConfig.unity_game = { url };
  } else if (type === 'quiz') {
    const quiz = (l.contentConfig && l.contentConfig.quiz) || { questions: [] };
    updated.contentConfig.quiz = quiz;
  } else if (type === 'external_link') {
    const list = document.getElementById('ml-linksList');
    const links = [];
    for (const row of list.children){
      const inputs = row.querySelectorAll('input');
      const url = (inputs[0]?.value || '').trim(); const label = (inputs[1]?.value || '').trim();
      if (url) links.push({ url, label });
    }
    const previewVideoUrl = (document.getElementById('ml-previewUrl')?.value || '').trim();
    updated.contentConfig.external_link = { links, previewVideoUrl };
  } else if (type === 'keyboard_lesson') {
    const range = document.getElementById('ml-kbRange').value.trim();
    const ignoreOctave = document.getElementById('ml-kbIgnoreOctave').value === 'true';
    const stepsPanelVisible = !document.getElementById('ml-kbStepsPanel').classList.contains('hidden');
    let cfg = { range, ignoreOctave };
    if (stepsPanelVisible){
      const list = document.getElementById('ml-kbStepsList');
      const steps = [];
      for (const row of list.children){
        const inputs = row.querySelectorAll('input, select');
        const prompt = inputs[0].value.trim();
        const targetsStr = inputs[1].value.trim();
        const simultaneous = inputs[2].value === 'true';
        const ignoreStep = inputs[3].value === 'true';
        const targets = targetsStr.split(',').map(s => s.trim()).filter(Boolean);
        steps.push({ prompt, targets, simultaneous, ignoreOctave: ignoreStep });
      }
      cfg.steps = steps;
    } else {
      const target = document.getElementById('ml-kbTarget').value.trim();
      const attempts = Number(document.getElementById('ml-kbAttempts').value || 1);
      cfg = { ...cfg, mode:'note', target, attempts };
    }
    updated.contentConfig.keyboard_lesson = cfg;
  }
  return updated;
}

function validateEditor(updated) {
  const err = document.getElementById('editErrors');
  err.textContent = '';
  if (!updated.title) { err.textContent = 'Title is required.'; return false; }
  if (!difficultyIsValid(updated.difficulty)) { err.textContent = 'Invalid difficulty.'; return false; }
  if (updated.minutes <= 0) { err.textContent = 'Minutes must be > 0.'; return false; }
  if (updated.type === 'video' && !validateVideoConfig(updated.contentConfig?.video?.url)) { err.textContent = 'Valid video URL required.'; return false; }
  if (updated.type === 'unity_game' && !validateUnityConfig(updated.contentConfig?.unity_game?.url)) { err.textContent = 'Valid Unity build URL required.'; return false; }
  if (updated.type === 'quiz' && !validateQuizQuestions(updated.contentConfig?.quiz?.questions || [])) { err.textContent = 'Quiz requires prompts, 2+ choices, one correct.'; return false; }
  if (updated.type === 'external_link' && !validateExternalLinks(updated.contentConfig?.external_link?.links || [], updated.contentConfig?.external_link?.previewVideoUrl || '')) { err.textContent = 'Add valid external links; optional preview URL must be valid.'; return false; }
  if (updated.type === 'keyboard_lesson' && !validateKeyboardLessonConfig(updated.contentConfig?.keyboard_lesson || {})) { err.textContent = 'Keyboard lesson config invalid (check range, targets, attempts).'; return false; }
  return true;
}

function saveEdits() {
  if (!selectedId) return;
  const updated = collectEditor();
  if (!updated) return;
  if (!validateEditor(updated)) return;
  const idx = lessons.findIndex(x => x.id === selectedId);
  lessons[idx] = updated;
  saveCustomLessons(lessons);
  showToast('Lesson saved', 'success');
  renderList();
}

function togglePrivate(id) {
  const idx = lessons.findIndex(x => x.id === id);
  if (idx < 0) return;
  lessons[idx].isPrivate = !lessons[idx].isPrivate;
  saveCustomLessons(lessons);
  renderList();
}

function deleteLesson(id) {
  if (!confirm('Delete this lesson?')) return;
  const idx = lessons.findIndex(x => x.id === id);
  if (idx < 0) return;
  lessons.splice(idx,1);
  saveCustomLessons(lessons);
  if (selectedId === id) selectedId = '';
  renderList();
}

init().catch(e => console.error('MyLessons init failed', e));
