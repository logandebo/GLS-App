import { ensureActiveUserOrRedirect, getActiveUsername } from './storage.js';
import { loadCustomLessons, saveCustomLessons } from './contentLoader.js';
import { renderToast as showToast } from './ui.js';

let activeUser = '';
let lessons = [];

function initHeader(){
  const usernameEl = document.getElementById('header-username');
  const switchBtn = document.getElementById('header-switch-user');
  activeUser = getActiveUsername() || '';
  if (usernameEl && activeUser) usernameEl.textContent = `Logged in as: ${activeUser}`;
  if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
}

function rowFor(l){
  const row = document.createElement('div');
  row.className = 'mlc-row';
  const left = document.createElement('div'); left.className = 'mlc-row__left';
  const title = document.createElement('div'); title.className = 'mlc-row__title'; title.textContent = l.title || '(Untitled)';
  const meta = document.createElement('div'); meta.className = 'mlc-row__meta'; meta.textContent = `${l.id} • ${l.type || 'unknown'} • Owner: ${l.createdBy || l.author || '(none)'}`;
  left.appendChild(title); left.appendChild(meta);

  const actions = document.createElement('div'); actions.className = 'mlc-row__actions';
  const ownerWrap = document.createElement('div'); ownerWrap.className = 'mlc-owner';
  const ownerInput = document.createElement('input'); ownerInput.type = 'text'; ownerInput.placeholder = 'New owner (username)'; ownerInput.value = l.createdBy || l.author || '';
  const ownerBtn = document.createElement('button'); ownerBtn.type = 'button'; ownerBtn.className = 'btn secondary'; ownerBtn.textContent = 'Save Owner';
  ownerBtn.addEventListener('click', () => {
    const val = (ownerInput.value || '').trim();
    l.createdBy = val || null;
    l.isCustom = true;
    persist();
    showToast('Owner updated', 'success');
    renderList();
  });
  ownerWrap.appendChild(ownerInput); ownerWrap.appendChild(ownerBtn);

  const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'btn subtle'; delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    if (!confirm('Delete this lesson?')) return;
    lessons = lessons.filter(x => x.id !== l.id);
    persist();
    showToast('Lesson deleted', 'success');
    renderList();
  });

  const dataToggle = document.createElement('button'); dataToggle.type = 'button'; dataToggle.className = 'btn'; dataToggle.textContent = 'Show Data';
  const dataBox = document.createElement('pre'); dataBox.className = 'mlc-json'; dataBox.style.display = 'none';
  dataBox.textContent = JSON.stringify(l, null, 2);
  dataToggle.addEventListener('click', () => {
    const open = dataBox.style.display !== 'none';
    dataBox.style.display = open ? 'none' : 'block';
    dataToggle.textContent = open ? 'Show Data' : 'Hide Data';
  });

  actions.appendChild(ownerWrap);
  actions.appendChild(delBtn);
  actions.appendChild(dataToggle);

  const right = document.createElement('div'); right.appendChild(actions);
  row.appendChild(left);
  row.appendChild(right);
  row.appendChild(dataBox);
  return row;
}

function renderList(){
  const list = document.getElementById('mlc-list');
  const empty = document.getElementById('mlc-empty');
  list.innerHTML = '';
  if (!lessons.length){ empty.style.display = 'block'; return; } else { empty.style.display = 'none'; }
  // Sort by title then id
  const sorted = lessons.slice().sort((a,b) => (a.title||'').localeCompare(b.title||'') || (a.id||'').localeCompare(b.id||''));
  sorted.forEach(l => list.appendChild(rowFor(l)));
}

function persist(){
  try { saveCustomLessons(lessons); } catch(e){ console.error('Persist failed', e); }
}

async function init(){
  const user = ensureActiveUserOrRedirect();
  if (!user) return;
  initHeader();
  lessons = loadCustomLessons();
  renderList();
  document.getElementById('mlc-refresh')?.addEventListener('click', () => { lessons = loadCustomLessons(); renderList(); });
}

init().catch(e => console.error('Master Lessons init failed', e));
