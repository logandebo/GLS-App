import { ACTIVE_USER_KEY } from './storage.js';

function setAvatarText(el, name){
  if (!el) return;
  el.textContent = (name||'U').slice(0,1).toUpperCase();
}

async function resolveLiveName(){
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

async function updateHeaderControls(){
  const loginBtn = document.getElementById('header-login');
  const signupBtn = document.getElementById('header-signup');
  const avatar = document.getElementById('header-profile-avatar');

  const liveName = await resolveLiveName();
  const name = liveName || null;
  const loggedIn = Boolean(name);

  if (loggedIn){
    if (loginBtn) loginBtn.style.display = 'none';
    if (signupBtn) signupBtn.style.display = 'none';
    if (avatar) { avatar.classList.remove('hidden'); setAvatarText(avatar, name); }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (signupBtn) signupBtn.style.display = 'inline-block';
    if (avatar) avatar.classList.add('hidden');
  }
}

function bindEvents(){
  const loginBtn = document.getElementById('header-login');
  const signupBtn = document.getElementById('header-signup');
  const signoutBtn = document.getElementById('header-signout');
  if (loginBtn) loginBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
  if (signupBtn) signupBtn.addEventListener('click', () => { window.location.href = 'auth.html#signup'; });
  if (signoutBtn) signoutBtn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const scheduleReload = (delay=500) => { try { return setTimeout(()=>{ try{ window.location.reload(); }catch{} }, delay); } catch { return null; } };
    const clearSupabaseAuthLocally = () => {
      try {
        const keys = Object.keys(localStorage);
        keys.forEach(k => { if (k.startsWith('sb-') || k.includes('supabase')) localStorage.removeItem(k); });
      } catch {}
    };
    const timer = scheduleReload(500);
    try { if (window.supabaseClient && window.supabaseClient.isConfigured()) await window.supabaseClient.signOut(); } catch {}
    try { localStorage.removeItem(ACTIVE_USER_KEY); } catch {}
    clearSupabaseAuthLocally();
    // Directly toggle UI for reliability
    const avatar = document.getElementById('header-profile-avatar');
    if (avatar) avatar.classList.add('hidden');
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (signupBtn) signupBtn.style.display = 'inline-block';
    await updateHeaderControls();
    try { window.location.reload(); } catch {}
  });
  // Delegated handler in case the menu renders late or is replaced
  // Catch early pointerdown and clicks in case hover closes the menu
  const handleLogoutEvent = async (e) => {
    const target = e.target;
    if (!target) return;
    const isLogout = target.id === 'header-signout' || (!!target.closest && target.closest('#header-signout'));
    if (isLogout){
      e.preventDefault(); e.stopPropagation();
      const scheduleReload = (delay=500) => { try { return setTimeout(()=>{ try{ window.location.reload(); }catch{} }, delay); } catch { return null; } };
      const clearSupabaseAuthLocally = () => {
        try {
          const keys = Object.keys(localStorage);
          keys.forEach(k => { if (k.startsWith('sb-') || k.includes('supabase')) localStorage.removeItem(k); });
        } catch {}
      };
      const timer = scheduleReload(500);
      try { if (window.supabaseClient && window.supabaseClient.isConfigured()) await window.supabaseClient.signOut(); } catch {}
      try { localStorage.removeItem(ACTIVE_USER_KEY); } catch {}
      clearSupabaseAuthLocally();
      const avatar = document.getElementById('header-profile-avatar');
      const loginBtn2 = document.getElementById('header-login');
      const signupBtn2 = document.getElementById('header-signup');
      if (avatar) avatar.classList.add('hidden');
      if (loginBtn2) loginBtn2.style.display = 'inline-block';
      if (signupBtn2) signupBtn2.style.display = 'inline-block';
      await updateHeaderControls();
      try { window.location.reload(); } catch {}
    }
  };
  // Capture early to avoid hover-close race conditions
  document.addEventListener('mousedown', handleLogoutEvent, { capture: true });
  document.addEventListener('touchstart', handleLogoutEvent, { capture: true });
  document.addEventListener('pointerdown', handleLogoutEvent, { capture: true });
  document.addEventListener('click', handleLogoutEvent, { capture: true });
  const sb = window.supabaseClient;
  try { if (sb && sb.isConfigured && sb.isConfigured()) sb.onAuthStateChange(() => updateHeaderControls()); } catch {}
  window.addEventListener('storage', (e)=>{
    // Ignore demo storage keys for header state
    if (e.key && e.key.startsWith('sb-')) updateHeaderControls();
  });
}

bindEvents();
updateHeaderControls();
// In case Supabase session hydration is slightly delayed on some pages,
// run a quick follow-up check to update header state.
setTimeout(() => { updateHeaderControls(); }, 300);
setTimeout(() => { updateHeaderControls(); }, 1000);

// Click-based dropdown toggles for header menus
(function initDropdowns(){
  const dropdowns = Array.from(document.querySelectorAll('.dropdown'));
  const closeAll = () => {
    dropdowns.forEach(dd => { dd.classList.remove('open'); const t = dd.querySelector('.dropdown-toggle'); if (t) t.setAttribute('aria-expanded', 'false'); });
  };
  dropdowns.forEach(dd => {
    const toggle = dd.querySelector('.dropdown-toggle') || dd.querySelector('#header-profile-avatar');
    if (!toggle) return;
    // Ensure aria
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', (e) => {
      // For avatar anchor, prevent navigation to allow dropdown toggling
      if (toggle.id === 'header-profile-avatar') { e.preventDefault(); }
      e.stopPropagation();
      const isOpen = dd.classList.contains('open');
      closeAll();
      if (!isOpen) { dd.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); }
    });
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    // If click is outside any dropdown, close all
    const inside = !!t.closest && !!t.closest('.dropdown');
    if (!inside) closeAll();
  }, { capture: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
})();
