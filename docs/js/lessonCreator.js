// Lesson Creator Wizard (restored)
// Provides multi-step creation for custom concepts and lessons.

import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveUsername } from './storage.js';
import { loadAllConcepts, loadCustomConcepts, saveCustomConcepts, loadCustomLessons, saveCustomLessons } from './contentLoader.js';
import { renderToast as showToast } from './ui.js';
import { isUniqueLessonId, validateVideoConfig, validateUnityConfig, validateQuizQuestions, difficultyIsValid, validateExternalConfig, validateExternalLinks, validateKeyboardLessonConfig } from './validation.js';

let builtInConcepts = [];
let customConceptsCache = [];
let customLessonsCache = [];
let _refreshConceptSelectInProgress = false;
let _searchDebounceTimer = null;

let draft = {
  conceptId: '',
  lesson: {
    id: '',
    conceptId: '',
    title: '',
    description: '',
    minutes: 5,
    difficulty: 'beginner',
    xpReward: 10,
    type: 'video',
    contentConfig: {}
  }
};
let unityPlaceholderWarned = false;
let _sbDraftId = null;

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-)|(-$)/g, '')
    .slice(0, 40);
}

export function extractYouTubeId(input) {
  if (!input) return "";
  const s = input.trim();

  // Raw ID (11 characters) - most common format
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  try {
    const url = new URL(s);
    
    // youtu.be/<id>
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }
    
    // youtube.com/watch?v=<id>
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      
      // /embed/<id>
      const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];
    }
  } catch {
    // Not a URL, ignore
  }
  
  return "";
}

function generateLessonId() {
  const user = getActiveUsername() || 'user';
  const concept = (draft.conceptId || 'concept').replace(/[^a-z0-9.]+/gi, '.');
  const titleSlug = slugify(draft.lesson.title) || 'lesson';
  const ts = Date.now().toString(36);
  let base = `custom.${user}.${concept}.${titleSlug}.${ts}`;
  // Ensure uniqueness among custom lessons
  if (isUniqueLessonId(base)) return base;
  let i = 2;
  while (!isUniqueLessonId(`${base}.${i}`)) i++;
  return `${base}.${i}`;
}

function ensureLessonId() {
  if (!draft.lesson.id) {
    draft.lesson.id = generateLessonId();
  }
}

function initHeader(username) {
  const usernameEl = document.getElementById('lc-header-username');
  const switchBtn = document.getElementById('lc-switch-user');
  if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
}

function setStep(step) {
  [...document.querySelectorAll('#lessonCreatorPage .creator-step')].forEach(s => {
    const num = Number(s.dataset.step);
    s.classList.toggle('hidden', num !== step);
  });
  // Ensure only the current step is active and enabled; others are disabled
  [...document.querySelectorAll('#lc-steps .creator-step-btn')].forEach(btn => {
    const isCurrent = Number(btn.dataset.step) === step;
    btn.classList.toggle('active', isCurrent);
    btn.disabled = !isCurrent;
  });
}

async function refreshConceptSelect() {
  if (_refreshConceptSelectInProgress) return;
  _refreshConceptSelectInProgress = true;

  try {
    const select = document.getElementById('lc-conceptSelect');
    const searchEl = document.getElementById('lc-conceptSearch');
    if (!select) return;

    const current = select.value;

    // Clear dropdown before repopulating (single rebuild)
    select.innerHTML = '';
    
    // Add default placeholder option
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = 'Select a concept...';
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    select.appendChild(placeholderOpt);

    // Load concepts from Supabase
    const { listConcepts } = await import('./dataStore.js');
    const { concepts, error } = await listConcepts();
    if (error || !Array.isArray(concepts)) {
      console.error('Error loading concepts from Supabase:', error);
      return;
    }

    // Single dedupe pass by UUID (c.id is the primary key)
    const unique = new Map();
    for (const c of concepts) {
      const id = c?.id;  // Use the database UUID as the canonical ID
      if (!id || unique.has(id)) continue;

      unique.set(id, {
        id,  // This is the UUID from the database
        title: c?.title || id,
        subject: c?.content?.domain || 'general',
        summary: c?.summary || '',
        tags: c?.tags || [],
        estimatedMinutesToBasicMastery: 20,
        isCustom: true,
        createdBy: c?.owner_id
      });
    }

    const cache = Array.from(unique.values());

    // Filter using the search term (no second dedupe)
    const term = (searchEl?.value || '').trim().toLowerCase();
    const filtered = !term ? cache : cache.filter(cc => {
      const title = (cc.title || '').toLowerCase();
      const id = (cc.id || '').toLowerCase();
      const subj = (cc.subject || '').toLowerCase();
      const tags = Array.isArray(cc.tags) ? cc.tags.join(' ').toLowerCase() : '';
      return title.includes(term) || id.includes(term) || subj.includes(term) || tags.includes(term);
    });

    // Sort stable, user-friendly
    filtered.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));

    // Populate dropdown
    for (const cc of filtered) {
      const opt = document.createElement('option');
      opt.value = cc.id;
      opt.textContent = cc.title || cc.id;
      if (cc.isCustom) opt.textContent += ' (custom)';
      select.appendChild(opt);
    }

    // Restore selection if still present
    if (current && Array.from(select.options).some(o => o.value === current)) {
      select.value = current;
    }
  } catch (e) {
    console.error('Error in refreshConceptSelect:', e);
  } finally {
    _refreshConceptSelectInProgress = false;
  }
}

function validateConceptSelection() {
  const errors = document.getElementById('lc-conceptErrors');
  const select = document.getElementById('lc-conceptSelect');
  const titleEl = document.getElementById('lc-conceptTitle');
  errors.textContent = '';
  const existing = select?.value;
  const newTitle = titleEl?.value?.trim() || '';
  
  // Valid if either a concept is selected OR a new title is provided
  if (!existing && !newTitle) {
    errors.textContent = 'Select existing concept or provide a Title for new concept.';
    return false;
  }
  return true;
}

function validateNewConceptFields(){
  const errors = document.getElementById('lc-conceptErrors');
  const idEl = document.getElementById('lc-conceptId');
  const titleEl = document.getElementById('lc-conceptTitle');
  errors.textContent = '';
  const newId = idEl.value.trim();
  const newTitle = titleEl.value.trim();
  if (!newId || !newTitle){ errors.textContent = 'Provide Concept ID and Title to add a concept.'; return false; }
  // Only check against Supabase concepts (customConceptsCache)
  const existsInCustom = (customConceptsCache || []).some(c => c && c.id === newId);
  if (existsInCustom){ errors.textContent = 'Concept ID already exists.'; return false; }
  return true;
}

async function saveConceptIfNeeded(forceNew = false) {
  const select = document.getElementById('lc-conceptSelect');
  const titleEl = document.getElementById('lc-conceptTitle');
  const subjEl = document.getElementById('lc-conceptSubject');
  const thumbEl = document.getElementById('lc-conceptThumb');
  if (!forceNew && select.value) return select.value;
  const title = titleEl.value.trim();
  if (!title) return '';
  // Auto-generate ID from title
  const id = 'custom-' + slugify(title);
  const subj = subjEl.value.trim();
  const minutes = 20; // default mastery minutes (no longer user-specified here)
  const thumb = thumbEl.value.trim();
  const concept = { 
    id, 
    title, 
    subject: subj || 'general',
    domain: subj || 'general',
    estimatedMinutesToBasicMastery: minutes, 
    isCustom: true 
  };
  if (thumb) concept.thumbnail = thumb;
  
  // Save to Supabase
  try {
    const { upsertConcept } = await import('./dataStore.js');
    const { ok, data, error } = await upsertConcept(concept);
    if (!ok || error) {
      console.error('Failed to save concept to Supabase:', error);
      showToast('Failed to save concept to database', 'error');
      return '';
    }
    // Use the actual UUID from the database (data.id is the primary key)
    const conceptId = data?.id || '';
    if (!conceptId) {
      console.error('Concept saved but no ID returned');
      showToast('Concept saved but ID missing', 'error');
      return '';
    }
    
    // Update concept with actual UUID for local cache
    concept.id = conceptId;
    const idx = customConceptsCache.findIndex(c => c.id === conceptId);
    if (idx >= 0) customConceptsCache[idx] = concept; else customConceptsCache.push(concept);
    refreshConceptSelect();
    // Auto-select newly added concept in dropdown and enable next
    select.value = conceptId;
    const to2 = document.getElementById('lc-toStep2');
    if (to2) to2.disabled = false;
    showToast('Concept added');
    return conceptId;
  } catch (e) {
    console.error('Error saving concept:', e);
    showToast('Failed to save concept', 'error');
    return '';
  }
}

function validateBasics() {
  const titleEl = document.getElementById('lc-lessonTitle');
  const diffEl = document.getElementById('lc-lessonDifficulty');
  const errors = document.getElementById('lc-basicsErrors');
  errors.textContent = '';
  const title = titleEl.value.trim();
  const diff = diffEl.value;
  if (!title) { errors.textContent = 'Lesson Title required.'; return false; }
  if (!difficultyIsValid(diff)) { errors.textContent = 'Invalid difficulty.'; return false; }
  return true;
}

function buildContentForm(type) {
  const panel = document.getElementById('lc-contentConfigPanel');
  panel.innerHTML = '';
  if (type === 'video') {
    panel.innerHTML = `
      <div class="grid-two">
        <label>Video Source
          <select id="lc-videoSource">
            <option value="youtube">YouTube (Recommended - Free CDN)</option>
            <option value="direct">Direct Upload (Supabase)</option>
            <option value="external">External URL</option>
          </select>
        </label>
      </div>
      
      <!-- YouTube Panel -->
      <div id="lc-youtubePanel" class="card" style="margin-top:0.75rem;">
        <strong>YouTube Video</strong>
        <label style="margin-top:0.5rem;">YouTube URL or Video ID
          <input id="lc-youtubeInput" type="text" placeholder="dQw4w9WgXcQ or https://youtube.com/watch?v=..." />
        </label>
        <button type="button" id="lc-youtubePreview" class="btn secondary" style="margin-top:0.5rem">Preview</button>
        <div id="lc-youtubeEmbed" style="margin-top:0.75rem;"></div>
        <p class="hint-text muted">Paste a YouTube video ID or full URL. Uses privacy-enhanced embed (no cookies).</p>
      </div>
      
      <!-- Direct Upload Panel -->
      <div id="lc-directUploadPanel" class="card hidden" style="margin-top:0.75rem;">
        <strong>Direct Upload</strong>
        <div class="upload-field" style="margin-top:0.5rem;">
          <label>Upload Video File
            <input id="lc-videoFileInput" type="file" accept="video/*" />
          </label>
          <button type="button" id="lc-uploadVideoBtn" class="btn secondary" style="margin-top:0.5rem">Upload & Use</button>
          <p id="lc-uploadStatus" class="hint-text"></p>
          <p class="hint-text muted">Max ~2GB per file. Supported: MP4, WebM, OGG, MOV. Uses Supabase Storage (limited).</p>
        </div>
      </div>
      
      <!-- External URL Panel -->
      <div id="lc-externalUrlPanel" class="card hidden" style="margin-top:0.75rem;">
        <strong>External URL</strong>
        <label style="margin-top:0.5rem;">Video URL
          <input id="lc-videoUrlInput" type="url" placeholder="https://example.com/video.mp4" />
        </label>
        <p class="hint-text muted">Direct link to video file (MP4, WebM, OGG).</p>
      </div>`;
    
    // Source selector handler
    const sourceSelect = document.getElementById('lc-videoSource');
    const youtubePanel = document.getElementById('lc-youtubePanel');
    const directPanel = document.getElementById('lc-directUploadPanel');
    const externalPanel = document.getElementById('lc-externalUrlPanel');
    
    sourceSelect && sourceSelect.addEventListener('change', () => {
      const source = sourceSelect.value;
      youtubePanel.classList.toggle('hidden', source !== 'youtube');
      directPanel.classList.toggle('hidden', source !== 'direct');
      externalPanel.classList.toggle('hidden', source !== 'external');
      validateContent();
    });
    
    // YouTube preview handler
    const youtubeInput = document.getElementById('lc-youtubeInput');
    const youtubePreviewBtn = document.getElementById('lc-youtubePreview');
    const youtubeEmbed = document.getElementById('lc-youtubeEmbed');
    
    youtubeInput && youtubeInput.addEventListener('input', validateContent);
    
    youtubePreviewBtn && youtubePreviewBtn.addEventListener('click', () => {
      const input = youtubeInput.value.trim();
      const videoId = extractYouTubeId(input);
      
      if (!videoId) {
        youtubeEmbed.innerHTML = '<p class="error-text">Invalid YouTube URL or ID</p>';
        return;
      }
      
      youtubeEmbed.innerHTML = `
        <iframe 
          src="https://www.youtube-nocookie.com/embed/${videoId}" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
          style="width:100%; aspect-ratio:16/9; border:0; border-radius:6px;">
        </iframe>`;
    });
    
    // External URL handler
    const urlInp = document.getElementById('lc-videoUrlInput');
    urlInp && urlInp.addEventListener('input', validateContent);
    const fileInp = document.getElementById('lc-videoFileInput');
    const uploadBtn = document.getElementById('lc-uploadVideoBtn');
    const statusEl = document.getElementById('lc-uploadStatus');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        const file = fileInp && fileInp.files && fileInp.files[0] ? fileInp.files[0] : null;
        if (!file) { statusEl.textContent = 'Choose a file first.'; return; }
        // Gate by Supabase availability
        if (!(window.supabaseClient && window.supabaseClient.isConfigured && window.supabaseClient.isConfigured())) {
          statusEl.textContent = 'Uploads require Supabase configured + signed-in. Paste a URL instead.'; return;
        }
        const { data } = await window.supabaseClient.getSession();
        const user = data && data.session ? data.session.user : null;
        if (!user) { statusEl.textContent = 'Sign in to enable uploads.'; return; }
        // Lazily create a draft if not yet initialized
        if (!_sbDraftId) {
          statusEl.textContent = 'Preparing draft…';
          try {
            const ok = await window.supabaseClient.waitForSessionReady?.(2000, 150);
            if (!ok) { statusEl.textContent = 'Session not ready. Try again.'; return; }
            const { createLessonDraft } = await import('./dataStore.js');
            const { lesson, error } = await createLessonDraft({
              title: draft?.lesson?.title || 'Untitled Lesson',
              description: draft?.lesson?.description || '',
              type: 'video',
              payload: draft?.lesson?.contentConfig || {}
            });
            if (error || !lesson?.id) { statusEl.textContent = 'Draft creation failed. Try again.'; return; }
            _sbDraftId = lesson.id;
          } catch {
            statusEl.textContent = 'Draft creation error. Try again.';
            return;
          }
        }
        uploadBtn.disabled = true; statusEl.textContent = 'Uploading…';
        try {
          const sup = window.supabaseClient._raw;
          const bucket = sup.storage.from('lesson-content');
          const ts = Date.now();
          const safeName = (file.name || 'video').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `lessons/${_sbDraftId}/video/${ts}_${safeName}`;
          const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type || 'video/mp4' });
          if (error) { statusEl.textContent = 'Upload failed.'; return; }
          // Persist storagePath on draft payload
          draft.lesson.contentConfig.video = { storagePath: path, url: '' };
          await updateDraftPayload();
          statusEl.textContent = 'Uploaded. Preview will use signed URL at runtime.';
          urlInp && (urlInp.value = '');
          validateContent();
        } catch (e) {
          statusEl.textContent = 'Upload error.';
        } finally {
          uploadBtn.disabled = false;
        }
      });
    }
    validateContent();
  } else if (type === 'unity_game') {
    panel.innerHTML = `
      <div class="card" style="margin-bottom:0.75rem;">
        <strong>Upload Unity WebGL Build</strong>
        <p class="hint-text muted">Select the folder containing your Unity WebGL build (index.html, Build/, TemplateData/).</p>
        <div style="margin-top:0.5rem;">
          <label>Select Unity Build Folder
            <input id="lc-unityFolderInput" type="file" webkitdirectory directory multiple style="margin-top:0.5rem;" />
          </label>
          <button type="button" id="lc-uploadUnityBtn" class="btn" style="margin-top:0.75rem;">Upload to Cloud Storage</button>
          <p id="lc-unityUploadStatus" class="hint-text"></p>
        </div>
      </div>
      
      <div class="divider">OR use existing URL</div>
      
      <div class="grid-two">
        <label>Unity Build URL (optional)
          <input id="lc-unityUrlInput" type="url" placeholder="https://cdn.example.com/unity/build/index.html" />
        </label>
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <button id="lc-unityOpenBtn" type="button" class="btn secondary">Test URL</button>
        </div>
      </div>
      
      <div class="review-summary" style="font-size:0.75rem; margin-top:0.75rem;">
        <strong>Unity Build Requirements:</strong>
        <ul style="margin:0.35rem 0 0.15rem 1rem; padding:0;">
          <li>Must contain index.html at root level</li>
          <li>Build/ folder with .wasm, .data, .framework.js, .loader.js</li>
          <li>Compressed files (.br, .gz) are supported</li>
          <li>Upload preserves folder structure automatically</li>
        </ul>
      </div>
    `;
    
    const folderInput = document.getElementById('lc-unityFolderInput');
    const uploadBtn = document.getElementById('lc-uploadUnityBtn');
    const statusEl = document.getElementById('lc-unityUploadStatus');
    const urlInput = document.getElementById('lc-unityUrlInput');
    
    urlInput && urlInput.addEventListener('input', validateContent);
    
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        const files = folderInput && folderInput.files ? folderInput.files : null;
        if (!files || files.length === 0) {
          statusEl.textContent = 'Please select a Unity build folder first.';
          return;
        }
        
        // Verify folder contains index.html
        const hasIndexHtml = Array.from(files).some(f => 
          f.webkitRelativePath.endsWith('/index.html') || f.name === 'index.html'
        );
        if (!hasIndexHtml) {
          statusEl.textContent = 'Error: Selected folder must contain index.html';
          return;
        }
        
        // Check authentication
        if (!(window.supabaseClient && window.supabaseClient.isConfigured && window.supabaseClient.isConfigured())) {
          statusEl.textContent = 'Uploads require Supabase configured + signed-in.';
          return;
        }
        
        const { data } = await window.supabaseClient.getSession();
        const user = data && data.session ? data.session.user : null;
        if (!user) {
          statusEl.textContent = 'Sign in to enable uploads.';
          return;
        }
        
        // Ensure lesson has an ID
        ensureLessonId();
        const lessonId = draft.lesson.id;
        
        // Prepare form data
        uploadBtn.disabled = true;
        statusEl.textContent = `Uploading ${files.length} files...`;
        
        try {
          const { SUPABASE_URL } = await import('./config.js');
          const endpoint = `${SUPABASE_URL}/functions/v1/upload_unity_build`;
          
          const formData = new FormData();
          formData.append('lesson_id', lessonId);
          
          // Add all files with their relative paths
          for (const file of files) {
            formData.append('files', file, file.webkitRelativePath || file.name);
          }
          
          const accessToken = data.session.access_token;
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: formData
          });
          
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Upload failed: ${resp.status} ${text}`);
          }
          
          const result = await resp.json();
          
          // Store in lesson config
          draft.lesson.contentConfig.unity_game = {
            source: 'r2',
            r2Key: result.prefixKey,
            url: result.indexUrl
          };
          
          statusEl.textContent = `✓ Uploaded successfully! Build available at: ${result.indexUrl}`;
          statusEl.style.color = 'var(--success-color, #10b981)';
          
          // Clear URL input since we now have R2 upload
          if (urlInput) urlInput.value = '';
          
          validateContent();
        } catch (error) {
          statusEl.textContent = `Upload error: ${error.message}`;
          statusEl.style.color = 'var(--error-color, #ef4444)';
        } finally {
          uploadBtn.disabled = false;
        }
      });
    }
    
    // Test URL button opens Unity build in new tab
    const openBtn = document.getElementById('lc-unityOpenBtn');
    openBtn && openBtn.addEventListener('click', () => {
      const url = (document.getElementById('lc-unityUrlInput')?.value || '').trim();
      if (!url) { showToast('Enter a Unity build URL first.', 'error'); return; }
      try { window.open(url, '_blank'); } catch {}
    });
    
    validateContent();
  } else if (type === 'quiz') {
    panel.innerHTML = '<div id="lc-quizBuilder"></div><button type="button" id="lc-addQuizQuestion" class="btn secondary">Add Question</button>';
    initQuizBuilder();
  } else if (type === 'keyboard_lesson') {
    panel.innerHTML = `
      <div class="grid-two">
        <label>Range (low-high)
          <input id="lc-kbRange" type="text" placeholder="e.g. C3-C5" />
        </label>
        <label>Ignore Octave (global)
          <select id="lc-kbIgnoreOctave">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      </div>
      <div class="divider">Single Target OR Multi-Step Sequence</div>
      <div id="lc-kbSingleGroup" class="grid-two">
        <label>Single Target Note
          <input id="lc-kbTarget" type="text" placeholder="e.g. C4" />
        </label>
        <label>Attempts Required
          <input id="lc-kbAttempts" type="number" min="1" step="1" value="1" />
        </label>
      </div>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center;">
        <button type="button" id="lc-kbEnableSteps" class="btn secondary">Use Steps</button>
        <span class="short muted">Enable to build multi-step sequence and chords.</span>
      </div>
      <div id="lc-kbStepsPanel" class="card hidden" style="margin-top:0.6rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>Steps</strong>
          <button type="button" id="lc-kbAddStep" class="btn secondary">Add Step</button>
        </div>
        <div id="lc-kbStepsList" style="margin-top:0.5rem;"></div>
      </div>`;
    function addStepRow(step = { prompt:'', targets:'C4', simultaneous:false, ignoreOctave:false }){
      const row = document.createElement('div'); row.className = 'grid-two'; row.style.marginBottom = '0.5rem';
      const prompt = document.createElement('input'); prompt.type='text'; prompt.placeholder='Prompt (optional)'; prompt.value = step.prompt || '';
      const targets = document.createElement('input'); targets.type='text'; targets.placeholder='Targets (comma-separated notes e.g. C4,E4,G4)'; targets.value = step.targets || 'C4';
      const simultaneous = document.createElement('select'); simultaneous.innerHTML = '<option value="false">Single note</option><option value="true">Simultaneous (chord)</option>'; simultaneous.value = step.simultaneous ? 'true':'false';
      const ignoreOct = document.createElement('select'); ignoreOct.innerHTML = '<option value="false">Exact note</option><option value="true">Ignore octave</option>'; ignoreOct.value = step.ignoreOctave ? 'true':'false';
      const remove = document.createElement('button'); remove.type='button'; remove.className='btn subtle'; remove.textContent='Remove';
      const left = document.createElement('div'); left.appendChild(prompt);
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='0.5rem'; right.appendChild(targets); right.appendChild(simultaneous); right.appendChild(ignoreOct); right.appendChild(remove);
      row.appendChild(left); row.appendChild(right);
      list.appendChild(row);
      [prompt,targets,simultaneous,ignoreOct].forEach(el => { el.addEventListener('input', validateContent); el.addEventListener('change', validateContent); });
      remove.addEventListener('click', () => { list.removeChild(row); validateContent(); });
    }
    const enableBtn = document.getElementById('lc-kbEnableSteps');
    const panelSteps = document.getElementById('lc-kbStepsPanel');
    const list = document.getElementById('lc-kbStepsList');
    const addStepBtn = document.getElementById('lc-kbAddStep');
    enableBtn.addEventListener('click', () => {
      panelSteps.classList.toggle('hidden');
      // Hide single-target inputs when steps are enabled
      const singleGroup = document.getElementById('lc-kbSingleGroup');
      if (singleGroup) singleGroup.classList.toggle('hidden', !panelSteps.classList.contains('hidden'));
      // Optionally add a starter step when enabling for the first time
      if (!panelSteps.classList.contains('hidden') && list.children.length === 0) addStepRow();
      validateContent();
    });
    addStepBtn.addEventListener('click', () => addStepRow());
    ['lc-kbTarget','lc-kbRange','lc-kbAttempts','lc-kbIgnoreOctave'].forEach(id => {
      const el = document.getElementById(id.replace('lc-kbIgnoreOctave','lc-kbIgnoreOctave')); // placeholder keep
      const node = document.getElementById(id);
      node && node.addEventListener('input', validateContent);
      node && node.addEventListener('change', validateContent);
    });
    validateContent();
  } else if (type === 'external_link') {
    panel.innerHTML = `
      <div class="grid-two">
        <div id="lc-externalLinksPanel" class="card" style="padding:0.75rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>External Links</strong>
            <button type="button" id="lc-addLinkBtn" class="btn secondary">Add Link</button>
          </div>
          <div id="lc-linksList" style="margin-top:0.5rem;"></div>
        </div>
        <div class="upload-field">
          <label>Preview Video URL (optional)
            <input id="lc-previewVideoUrlInput" type="url" placeholder="e.g. /assets/video/preview.mp4 or https://..." />
          </label>
          <label style="margin-top:0.5rem;">Upload Preview Video File
            <input id="lc-previewVideoFileInput" type="file" accept="video/*" />
          </label>
          <button type="button" id="lc-uploadPreviewBtn" class="btn secondary" style="margin-top:0.5rem">Upload & Use</button>
          <p id="lc-previewUploadStatus" class="hint-text"></p>
        </div>
      </div>`;
    const prevUrlInp = document.getElementById('lc-previewVideoUrlInput');
    prevUrlInp && prevUrlInp.addEventListener('input', validateContent);
    const linksList = document.getElementById('lc-linksList');
    const addBtn = document.getElementById('lc-addLinkBtn');
    function addLinkRow(url = '', label = '') {
      const row = document.createElement('div');
      row.className = 'grid-two';
      row.style.marginBottom = '0.5rem';
      const urlInput = document.createElement('input'); urlInput.type = 'url'; urlInput.placeholder = 'https://... or /path'; urlInput.value = url;
      const labelInput = document.createElement('input'); labelInput.type = 'text'; labelInput.placeholder = 'Button label (optional)'; labelInput.value = label;
      const removeBtn = document.createElement('button'); removeBtn.type = 'button'; removeBtn.className = 'btn subtle'; removeBtn.textContent = 'Remove';
      const wrapLeft = document.createElement('div'); wrapLeft.appendChild(urlInput);
      const wrapRight = document.createElement('div'); wrapRight.style.display = 'flex'; wrapRight.style.gap = '0.5rem'; wrapRight.appendChild(labelInput); wrapRight.appendChild(removeBtn);
      row.appendChild(wrapLeft); row.appendChild(wrapRight);
      linksList.appendChild(row);
      urlInput.addEventListener('input', validateContent);
      labelInput.addEventListener('input', validateContent);
      removeBtn.addEventListener('click', () => { linksList.removeChild(row); validateContent(); });
    }
    addBtn && addBtn.addEventListener('click', () => addLinkRow());
    addLinkRow();
    const fileInp = document.getElementById('lc-previewVideoFileInput');
    const uploadBtn = document.getElementById('lc-uploadPreviewBtn');
    const statusEl = document.getElementById('lc-previewUploadStatus');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        statusEl.textContent = 'Uploads are not supported on GitHub Pages. Host your preview video and paste the URL.';
      });
    }
    validateContent();
  }
}

function initQuizBuilder() {
  const quiz = draft.lesson.contentConfig.quiz || { questions: [] };
  draft.lesson.contentConfig.quiz = quiz;
  renderQuizQuestions();
  const addBtn = document.getElementById('lc-addQuizQuestion');
  addBtn && addBtn.addEventListener('click', () => {
    quiz.questions.push({ prompt: '', choices: [ { text: '', isCorrect: true }, { text: '', isCorrect: false } ] });
    renderQuizQuestions();
  });
}

function renderQuizQuestions() {
  const quizDiv = document.getElementById('lc-quizBuilder');
  if (!quizDiv) return;
  quizDiv.innerHTML = '';
  const quiz = draft.lesson.contentConfig.quiz;
  quiz.questions.forEach((q, qi) => {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>Question ${qi + 1}</legend>`;
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 320px';
    grid.style.gap = '0.75rem';

    // Left: prompt + choices
    const left = document.createElement('div');
    const prompt = document.createElement('input');
    prompt.type = 'text';
    prompt.placeholder = 'Prompt';
    prompt.value = q.prompt;
    prompt.addEventListener('input', () => { q.prompt = prompt.value; validateContent(); });
    left.appendChild(prompt);
    q.choices.forEach((c, ci) => {
      const wrap = document.createElement('div');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `lc-qc${qi}`;
      radio.checked = c.isCorrect;
      radio.addEventListener('change', () => { q.choices.forEach((cc, idx) => cc.isCorrect = idx === ci); validateContent(); });
      const text = document.createElement('input');
      text.type = 'text';
      text.placeholder = `Choice ${ci + 1}`;
      text.value = c.text;
      text.addEventListener('input', () => { c.text = text.value; validateContent(); });
      wrap.appendChild(radio);
      wrap.appendChild(text);
      left.appendChild(wrap);
    });

    // Right: Visual settings bar
    const right = document.createElement('div');
    right.className = 'card';
    right.style.padding = '0.6rem';
    const title = document.createElement('strong'); title.textContent = 'Visual'; right.appendChild(title);
    const typeSel = document.createElement('select');
    typeSel.innerHTML = '<option value="none">None</option><option value="image">Image</option><option value="keyboard">Keyboard</option>';
    const visual = q.visual || { type: 'none' };
    typeSel.value = visual.type || 'none';
    typeSel.style.marginTop = '0.4rem';
    right.appendChild(typeSel);
    const visualWrap = document.createElement('div'); visualWrap.style.marginTop = '0.5rem'; right.appendChild(visualWrap);
    // Preview container that lives outside the visual settings card, under the question content
    const previewBelow = document.createElement('div'); previewBelow.style.marginTop = '0.75rem';

    function renderVisualConfig(){
      visualWrap.innerHTML = '';
      q.visual = q.visual || { type: 'none' };
      q.visual.type = typeSel.value;
      if (q.visual.type === 'image'){
        const urlInput = document.createElement('input'); urlInput.type='url'; urlInput.placeholder='Image URL'; urlInput.value = q.visual.url || '';
        urlInput.addEventListener('input', () => { q.visual.url = urlInput.value.trim(); validateContent(); renderPreview(); });
        const fileInput = document.createElement('input'); fileInput.type='file'; fileInput.accept='image/*'; fileInput.style.marginTop='0.4rem';
        const uploadBtn = document.createElement('button'); uploadBtn.type='button'; uploadBtn.className='btn secondary'; uploadBtn.textContent='Upload & Use'; uploadBtn.style.marginTop='0.4rem';
        const status = document.createElement('p'); status.className='hint-text'; status.style.marginTop='0.25rem';
        uploadBtn.addEventListener('click', () => {
          status.textContent = 'Uploads are not supported on GitHub Pages. Host your image and paste the URL.';
        });
        visualWrap.appendChild(urlInput);
        visualWrap.appendChild(fileInput);
        visualWrap.appendChild(uploadBtn);
        visualWrap.appendChild(status);
      } else if (q.visual.type === 'keyboard'){
        const keysInput = document.createElement('input'); keysInput.type='number'; keysInput.min='12'; keysInput.max='88'; keysInput.step='1'; keysInput.value = String(q.visual.numKeys || 24);
        const startInput = document.createElement('input'); startInput.type='text'; startInput.placeholder='Start note (e.g., C3)'; startInput.value = q.visual.startNote || 'C3';
        const highlightInput = document.createElement('input'); highlightInput.type='text'; highlightInput.placeholder='Highlighted notes (comma-separated, e.g., C4,E4,G4)'; highlightInput.value = (Array.isArray(q.visual.highlighted) ? q.visual.highlighted.join(',') : '');
        [keysInput,startInput,highlightInput].forEach(el => el.style.display='block');
        [keysInput,startInput,highlightInput].forEach(el => el.style.marginTop='0.4rem');
        keysInput.addEventListener('input', () => { q.visual.numKeys = Number(keysInput.value)||24; validateContent(); renderPreview(); });
        startInput.addEventListener('input', () => { q.visual.startNote = startInput.value.trim() || 'C3'; validateContent(); renderPreview(); });
        highlightInput.addEventListener('input', () => { q.visual.highlighted = highlightInput.value.split(',').map(s=>s.trim()).filter(Boolean); validateContent(); renderPreview(); });
        visualWrap.appendChild(keysInput);
        visualWrap.appendChild(startInput);
        visualWrap.appendChild(highlightInput);
      }
      renderPreview();
    }

    typeSel.addEventListener('change', renderVisualConfig);
    renderVisualConfig();

    function renderPreview(){
      // Clear both containers and render depending on type
      visualWrap.querySelectorAll('.piano').forEach(el => el.remove());
      previewBelow.innerHTML = '';
      if (!q.visual || q.visual.type === 'none') return;
      if (q.visual.type === 'image'){
        const url = (q.visual.url || '').trim();
        if (!url) return;
        const img = document.createElement('img'); img.src = url; img.alt='Question Visual'; img.style.maxWidth='100%'; img.style.border='1px solid #2e3940'; img.style.borderRadius='6px';
        img.onerror = () => { img.remove(); };
        previewBelow.appendChild(img);
        return;
      }
      if (q.visual.type === 'keyboard'){
        const NOTE_ORDER = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        function noteNameToMidi(name){
          if (typeof name === 'number') return name;
          const m = String(name||'C4').trim();
          const match = m.match(/^([A-Ga-g])([#b]?)(\d?)$/);
          if (!match){ return 60; }
          let letter = match[1].toUpperCase(); const accidental = match[2] || ''; const octave = match[3] === '' ? 4 : Number(match[3]);
          if (accidental === 'b'){ const flats = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' }; letter = (flats[letter+'b']||letter); }
          const idx = NOTE_ORDER.indexOf(letter + accidental); if (idx < 0) return 60; return (octave + 1) * 12 + idx;
        }
        function isBlackKey(midi){ const idx = midi % 12; return [1,3,6,8,10].includes(idx); }
        const num = Number(q.visual.numKeys || 24);
        const start = noteNameToMidi(q.visual.startNote || 'C3');
        const highlighted = Array.isArray(q.visual.highlighted) ? q.visual.highlighted.map(h => noteNameToMidi(h)) : [];
        const wrap = document.createElement('div'); wrap.className='piano';
        for (let m = start; m < start + num; m++){
          const el = document.createElement('div'); el.className = 'key ' + (isBlackKey(m) ? 'black' : 'white'); el.dataset.midi=String(m);
          if (highlighted.includes(m)) el.classList.add('active'); wrap.appendChild(el);
        }
        previewBelow.appendChild(wrap);
      }
    }

    grid.appendChild(left);
    grid.appendChild(right);
    fs.appendChild(grid);
    // Ensure preview sits at the bottom of the fieldset (after grid)
    fs.appendChild(previewBelow);
    quizDiv.appendChild(fs);
  });
  validateContent();
}

function validateContent() {
  const errors = document.getElementById('lc-contentErrors');
  const nextBtn = document.getElementById('lc-toStep4');
  errors.textContent = '';
  let ok = true;
  
  if (draft.lesson.type === 'video') {
    const sourceSelect = document.getElementById('lc-videoSource');
    const source = sourceSelect ? sourceSelect.value : 'direct';
    
    if (source === 'youtube') {
      const youtubeInput = document.getElementById('lc-youtubeInput');
      const input = youtubeInput ? youtubeInput.value.trim() : '';
      const videoId = extractYouTubeId(input);
      
      if (!videoId) {
        errors.textContent = 'Please provide a valid YouTube video ID or URL.';
        ok = false;
      } else {
        draft.lesson.contentConfig.video = {
          source: 'youtube',
          youtubeUrl: input
        };
      }
    } else if (source === 'direct') {
      // Check if already uploaded (storagePath set)
      const hasStoragePath = draft.lesson.contentConfig.video?.storagePath;
      if (!hasStoragePath) {
        errors.textContent = 'Please upload a video file using the Upload button.';
        ok = false;
      }
      // Keep existing video config with storagePath
    } else if (source === 'external') {
      const urlInput = document.getElementById('lc-videoUrlInput');
      const url = urlInput ? urlInput.value.trim() : '';
      
      ok = validateVideoConfig(url);
      if (ok) {
        draft.lesson.contentConfig.video = {
          source: 'external',
          url
        };
      } else {
        errors.textContent = 'Please provide a valid video URL (MP4, WebM, OGG).';
      }
    }
  } else if (draft.lesson.type === 'unity_game') {
    // Check if R2 upload exists
    const hasR2Upload = draft.lesson.contentConfig.unity_game?.source === 'r2' && 
                        draft.lesson.contentConfig.unity_game?.url;
    
    const urlInput = document.getElementById('lc-unityUrlInput');
    const url = urlInput ? urlInput.value.trim() : '';
    
    if (hasR2Upload) {
      // R2 upload takes precedence
      ok = true;
    } else if (url) {
      // External URL provided
      ok = validateUnityConfig(url);
      if (ok) {
        draft.lesson.contentConfig.unity_game = {
          source: 'external',
          url
        };
      } else {
        errors.textContent = 'Please provide a valid Unity build URL (must point to index.html).';
      }
    } else {
      // No URL and no R2 upload
      errors.textContent = 'Please upload a Unity build folder or provide a build URL.';
      ok = false;
    }
  } else if (draft.lesson.type === 'quiz') {
    const quiz = draft.lesson.contentConfig.quiz;
    ok = validateQuizQuestions(quiz.questions);
  } else if (draft.lesson.type === 'keyboard_lesson') {
    const range = document.getElementById('lc-kbRange').value.trim();
    const ignoreOctave = document.getElementById('lc-kbIgnoreOctave').value === 'true';
    const stepsPanelVisible = !document.getElementById('lc-kbStepsPanel').classList.contains('hidden');
    let cfg = { range, ignoreOctave };
    if (stepsPanelVisible){
      const list = document.getElementById('lc-kbStepsList');
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
      // Specific error hints for steps mode
      if (!steps.length){ errors.textContent = 'Add at least one step.'; }
    } else {
      const target = document.getElementById('lc-kbTarget').value.trim();
      const attempts = Number(document.getElementById('lc-kbAttempts').value || 1);
      cfg = { ...cfg, mode:'note', target, attempts };
    }
    ok = validateKeyboardLessonConfig(cfg);
    if (ok) draft.lesson.contentConfig.keyboard_lesson = cfg;
    else {
      // Provide clearer errors for common issues
      if (!/^([A-Ga-g][#b]?\d)-([A-Ga-g][#b]?\d)$/.test(range)) {
        errors.textContent = 'Range must be like C3-C5.';
      } else if (stepsPanelVisible) {
        const invalidRow = (cfg.steps||[]).find(s => !s.targets || !s.targets.length);
        if (invalidRow) errors.textContent = 'Each step needs at least one target note.';
        else errors.textContent = 'Check step targets (e.g., C, C4, or C4,E4).';
      } else {
        if (!cfg.target) errors.textContent = 'Enter a single target note (e.g., C4).';
        else errors.textContent = 'Check target note and attempts (≥ 1).';
      }
    }
  } else if (draft.lesson.type === 'external_link') {
    const previewUrl = document.getElementById('lc-previewVideoUrlInput').value.trim();
    const links = [];
    const linksList = document.getElementById('lc-linksList');
    if (linksList) {
      for (const row of linksList.children) {
        const inputs = row.querySelectorAll('input');
        const url = (inputs[0]?.value || '').trim();
        const label = (inputs[1]?.value || '').trim();
        if (url) links.push({ url, label });
      }
    }
    ok = validateExternalLinks(links, previewUrl);
    if (ok) {
      draft.lesson.contentConfig.external_link = { links, previewVideoUrl: previewUrl };
    } else {
      if (!links.length) {
        errors.textContent = 'Add at least one external link (https:// or site-relative /path).';
      } else if (!links.every(l => validateExternalConfig(l.url, null))) {
        errors.textContent = 'One or more link URLs are invalid. Use a full https:// link or a site-relative path starting with /.';
      } else if (previewUrl) {
        errors.textContent = 'Preview video URL must be valid (MP4/WebM/Ogg/MOV). Use a full https:// link or the uploaded file URL under /assets/video/.';
      } else {
        errors.textContent = 'Please check your links and try again.';
      }
    }
  }
  if (!ok && !errors.textContent) errors.textContent = 'Complete required content details.';
  nextBtn.disabled = !ok;
  return ok;
}

function buildReview() {
  // Ensure an auto-assigned ID is present for review
  ensureLessonId();
  const review = document.getElementById('lc-reviewSummary');
  const publishBtn = document.getElementById('lc-publishLesson');
  const l = draft.lesson;
  const lines = [];
  lines.push(`<strong>Concept:</strong> ${draft.conceptId}`);
  lines.push(`<strong>ID:</strong> ${l.id}`);
  lines.push(`<strong>Title:</strong> ${l.title}`);
  lines.push(`<strong>Description:</strong> ${l.description || '(none)'}`);
  lines.push(`<strong>Type:</strong> ${l.type}`);
  lines.push(`<strong>Difficulty:</strong> ${l.difficulty}`);
  if (l.type === 'video') lines.push(`<strong>Video URL:</strong> ${l.contentConfig.video?.url}`);
  if (l.type === 'unity_game') {
    const u = l.contentConfig.unity_game || {};
    lines.push(`<strong>Unity URL:</strong> ${u.url || '(placeholder)'}`);
    if (u.unityBuildUrlIsPlaceholder) { lines.push(`<em>Note: Using placeholder for testing.</em>`); }
  }
  if (l.type === 'external_link') {
    const e = l.contentConfig.external_link || {};
    const count = Array.isArray(e.links) ? e.links.length : (e.externalUrl ? 1 : 0);
    lines.push(`<strong>External Links:</strong> ${count}`);
    if (Array.isArray(e.links)) {
      e.links.slice(0,3).forEach((lnk, idx) => {
        lines.push(`&nbsp;&nbsp;• ${lnk.label ? lnk.label + ' — ' : ''}${lnk.url}`);
      });
      if (e.links.length > 3) lines.push(`&nbsp;&nbsp;• (+${e.links.length - 3} more)`);
    } else if (e.externalUrl) {
      lines.push(`&nbsp;&nbsp;• ${e.externalUrl}`);
    }
    lines.push(`<strong>Preview Video URL:</strong> ${e.previewVideoUrl || '(none)'}`);
  }
  if (l.type === 'quiz') lines.push(`<strong>Questions:</strong> ${l.contentConfig.quiz.questions.length}`);
  if (l.type === 'keyboard_lesson') {
    const kb = l.contentConfig.keyboard_lesson || {};
    if (Array.isArray(kb.steps) && kb.steps.length){
      lines.push(`<strong>Keyboard Steps:</strong> ${kb.steps.length}`);
      lines.push(`&nbsp;&nbsp;• Ignore octave (global): ${kb.ignoreOctave ? 'Yes' : 'No'}`);
    } else {
      lines.push(`<strong>Keyboard Target:</strong> ${kb.target}`);
      lines.push(`&nbsp;&nbsp;• Attempts: ${kb.attempts || 1}`);
      lines.push(`&nbsp;&nbsp;• Ignore octave (global): ${kb.ignoreOctave ? 'Yes' : 'No'}`);
    }
  }
  review.innerHTML = lines.join('<br/>');
  publishBtn.disabled = false;
}

async function publishLesson() {
  // Guarantee an auto-generated ID before persisting
  ensureLessonId();
  try {
    // Ensure ownership and custom flag so My Lessons can display it
    const owner = getActiveUsername();
    draft.lesson.createdBy = owner || draft.lesson.createdBy || null;
    draft.lesson.isCustom = true;
  } catch {}
  customLessonsCache.push(draft.lesson);
  saveCustomLessons(customLessonsCache);
  
  // Supabase: create published lesson directly (no drafts)
  let supabaseSuccess = false;
  if (window.supabaseClient && window.supabaseClient.isConfigured && window.supabaseClient.isConfigured()) {
    try {
      const payload = buildSupabasePayloadFromDraft();
      // Creating published lesson
      
      // Create lesson directly as published (no drafts)
      const { createLessonDraft } = await import('./dataStore.js');
      const { lesson, error } = await createLessonDraft({ 
        ...payload, 
        is_published: true, 
        is_public: true 
      });
      if (error) {
        console.error('[PUBLISH] Create failed:', error);
        localStorage.setItem('gls_last_publish_error', JSON.stringify({ step: 'create', error: error.message || String(error), time: new Date().toISOString() }));
      } else if (lesson?.id) {
        // Publish successful
        supabaseSuccess = true;
        localStorage.setItem('gls_last_publish_success', JSON.stringify({ step: 'create', id: lesson.id, time: new Date().toISOString() }));
      } else {
        console.error('[PUBLISH] Create returned no lesson');
        localStorage.setItem('gls_last_publish_error', JSON.stringify({ step: 'create', error: 'No lesson returned', time: new Date().toISOString() }));
      }
    } catch (e) {
      console.error('[PUBLISH] Supabase publish failed:', e);
      localStorage.setItem('gls_last_publish_error', JSON.stringify({ step: 'exception', error: e.message || String(e), time: new Date().toISOString() }));
    }
  } else {
    console.warn('[PUBLISH] Supabase not configured, saving locally only');
    localStorage.setItem('gls_last_publish_error', JSON.stringify({ step: 'config', error: 'Supabase not configured', time: new Date().toISOString() }));
  }
  
  showToast(supabaseSuccess ? 'Lesson published to cloud' : 'Lesson published locally');
  
  // Refresh the page to reset the wizard state cleanly
  // **Wait to allow DB operations to complete and user to see logs**
  try {
    setTimeout(() => { window.location.reload(); }, 1500);
  } catch {
    // Fallback if reload is blocked; reset the wizard
    resetWizard();
  }
}

function resetWizard() {
  draft = { conceptId: '', lesson: { id:'', conceptId:'', title:'', description:'', minutes:5, difficulty:'beginner', xpReward:10, type:'video', contentConfig:{} } };
  ['lc-conceptTitle','lc-conceptSubject','lc-conceptThumb','lc-lessonId','lc-lessonTitle','lc-lessonDesc','lc-lessonMinutes','lc-lessonXp'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  document.getElementById('lc-lessonDifficulty').value = 'beginner';
  document.getElementById('lc-lessonType').value = 'video';
  document.getElementById('lc-contentConfigPanel').innerHTML = '';
  document.getElementById('lc-reviewSummary').innerHTML = '';
  document.getElementById('lc-publishLesson').disabled = true;
  ['lc-toStep2','lc-toStep3','lc-toStep4'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
  setStep(1);
}

function bindEvents(username) {
  const to2 = document.getElementById('lc-toStep2');
  const to3 = document.getElementById('lc-toStep3');
  const to4 = document.getElementById('lc-toStep4');
  const publishBtn = document.getElementById('lc-publishLesson');
  const conceptSaveBtn = document.getElementById('lc-conceptSaveBtn');
  const conceptSearch = document.getElementById('lc-conceptSearch');
  const back1 = document.getElementById('lc-backTo1');
  const back2 = document.getElementById('lc-backTo2');
  const back3 = document.getElementById('lc-backTo3');

  console.log('[bindEvents] STARTING - to2 button exists?', !!to2);
  console.log('[bindEvents] to2 element:', to2);
  console.log('[bindEvents] to2 disabled?', to2?.disabled);

  // Listen for both 'change' (select) and 'input' (text field) events
  const conceptSelect = document.getElementById('lc-conceptSelect');
  const conceptTitle = document.getElementById('lc-conceptTitle');
  
  console.log('[bindEvents] conceptSelect exists?', !!conceptSelect);
  console.log('[bindEvents] conceptSelect value:', conceptSelect?.value);
  console.log('[bindEvents] conceptTitle exists?', !!conceptTitle);
  
  conceptSelect && conceptSelect.addEventListener('change', () => {
    console.log('[SELECT CHANGE] Dropdown changed to:', conceptSelect.value);
    const valid = validateConceptSelection();
    console.log('[SELECT CHANGE] Validation result:', valid);
    console.log('[SELECT CHANGE] Setting to2.disabled =', !valid);
    to2.disabled = !valid;
    console.log('[SELECT CHANGE] to2.disabled is now:', to2.disabled);
  });
  
  console.log('[bindEvents] Attached change listener to conceptSelect');
  
  conceptTitle && conceptTitle.addEventListener('input', () => {
    console.log('[TITLE INPUT] Title field changed to:', conceptTitle.value);
    const valid = validateConceptSelection();
    console.log('[TITLE INPUT] Validation result:', valid);
    to2.disabled = !valid;
  });
  conceptSaveBtn && conceptSaveBtn.addEventListener('click', async () => {
    // Explicitly add a new concept, even if an existing one is selected
    if (!validateNewConceptFields()) return;
    const id = await saveConceptIfNeeded(true);
    if (id) { draft.conceptId = id; draft.lesson.conceptId = id; }
  });
  conceptSearch && conceptSearch.addEventListener('input', () => {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => {
      refreshConceptSelect();
    }, 300);
  });
  to2 && to2.addEventListener('click', async () => {
    console.log('[NEXT BUTTON] Button clicked');
    console.log('[NEXT BUTTON] Button disabled state:', to2.disabled);
    
    const isValid = validateConceptSelection();
    console.log('[NEXT BUTTON] Validation result:', isValid);
    
    if (!isValid) {
      console.log('[NEXT BUTTON] Validation failed, stopping');
      return;
    }
    
    console.log('[NEXT BUTTON] Calling saveConceptIfNeeded...');
    const id = await saveConceptIfNeeded();
    console.log('[NEXT BUTTON] saveConceptIfNeeded returned:', id);
    
    const selectValue = document.getElementById('lc-conceptSelect').value;
    console.log('[NEXT BUTTON] Select dropdown value:', selectValue);
    
    draft.conceptId = id || selectValue;
    draft.lesson.conceptId = draft.conceptId;
    console.log('[NEXT BUTTON] Set draft.conceptId to:', draft.conceptId);
    console.log('[NEXT BUTTON] Proceeding to step 2');
    setStep(2);
  });
  
  console.log('[bindEvents] Attached click listener to to2 button');

  ['lc-lessonTitle'].forEach(id => {
    const el = document.getElementById(id);
    el && el.addEventListener('input', () => { to3.disabled = !validateBasics(); });
  });
  document.getElementById('lc-lessonType').addEventListener('change', () => {
    const ok = validateBasics();
    to3.disabled = !ok;
  });
  to3 && to3.addEventListener('click', () => {
    if (!validateBasics()) return;
    draft.lesson.title = document.getElementById('lc-lessonTitle').value.trim();
    draft.lesson.description = document.getElementById('lc-lessonDesc').value.trim();
    // xpReward no longer set from UI; keep default or adjust server-side later
    draft.lesson.difficulty = document.getElementById('lc-lessonDifficulty').value;
    draft.lesson.type = document.getElementById('lc-lessonType').value;
    buildContentForm(draft.lesson.type);
    setStep(3);
  });

  to4 && to4.addEventListener('click', () => {
    if (!validateContent()) return;
    // Supabase autosave payload
    updateDraftPayload();
    buildReview();
    setStep(4);
  });
  publishBtn && publishBtn.addEventListener('click', publishLesson);

  back1 && back1.addEventListener('click', () => setStep(1));
  back2 && back2.addEventListener('click', () => setStep(2));
  back3 && back3.addEventListener('click', () => setStep(3));
}

export async function initLessonCreator() {
  // Check for last publish attempt
  try {
    const lastError = localStorage.getItem('gls_last_publish_error');
    const lastSuccess = localStorage.getItem('gls_last_publish_success');
    if (lastError) {
      const err = JSON.parse(lastError);
      console.warn('[INIT] Last publish error:', err);
    }
    if (lastSuccess) {
      const succ = JSON.parse(lastSuccess);
      // Check last publish success
    }
  } catch {}
  
  migrateLegacyProfileIfNeeded();
  const active = ensureActiveUserOrRedirect();
  if (!active) return;
  initHeader(active);
  // No longer load builtInConcepts - only use Supabase concepts
  builtInConcepts = [];
  
  // Load concepts from Supabase
  try {
    const { listConcepts } = await import('./dataStore.js');
    const { concepts, error } = await listConcepts();
    if (!error && concepts) {
      customConceptsCache = concepts.map(c => ({
        id: c.content?.source_id || c.id,
        title: c.title,
        subject: c.content?.domain || 'general',
        summary: c.summary || '',
        tags: c.tags || [],
        estimatedMinutesToBasicMastery: 20,
        isCustom: true,
        createdBy: c.owner_id
      }));
    } else {
      // Fallback to localStorage
      customConceptsCache = loadCustomConcepts();
    }
  } catch (e) {
    console.error('Failed to load concepts from Supabase:', e);
    customConceptsCache = loadCustomConcepts();
  }
  
  customLessonsCache = loadCustomLessons();
  // Create Supabase draft at entry if authed
  try {
    if (window.supabaseClient && window.supabaseClient.isConfigured && window.supabaseClient.isConfigured()) {
      console.log('[INIT] Supabase is configured, checking session...');
      const ok = await window.supabaseClient.waitForSessionReady?.(1500, 150);
      const { data } = await window.supabaseClient.getSession();
      const user = data && data.session ? data.session.user : null;
      console.log('[INIT] Session ready:', ok, 'User:', user?.id);
      // Don't create draft on page load - wait until user clicks "Next: Basics"
      // This prevents accumulation of abandoned "Untitled Lesson" drafts
    } else {
      console.warn('[INIT] Supabase not configured');
    }
  } catch (e) {
    console.error('[INIT] Draft creation failed:', e);
  }
  await refreshConceptSelect();
  bindEvents(active);
  setStep(1);
}

async function updateDraftBasics() {
  try {
    if (!_sbDraftId) return;
    const { updateLessonDraft } = await import('./dataStore.js');
    await updateLessonDraft(_sbDraftId, {
      title: draft.lesson.title,
      description: draft.lesson.description,
      content_type: draft.lesson.type
    });
  } catch {}
}

async function updateDraftPayload() {
  try {
    if (!_sbDraftId) return;
    const { updateLessonDraft } = await import('./dataStore.js');
    await updateLessonDraft(_sbDraftId, { payload: draft.lesson.contentConfig });
  } catch {}
}

function buildSupabasePayloadFromDraft() {
  try {
    const l = draft.lesson;
    return {
      title: l.title,
      description: l.description || '',
      content_type: l.type,
      content_url: (l.type === 'video' ? (l.contentConfig?.video?.url || '') : (l.type === 'unity_game' ? (l.contentConfig?.unity_game?.url || '') : (l.type === 'external_link' ? '' : ''))),
      concept_id: l.conceptId || null,
      payload: l.contentConfig || {}
    };
  } catch { return {}; }
}

// Legacy: keep for backward compatibility
initLessonCreator().catch(err => console.error('Lesson creator init failed', err));
