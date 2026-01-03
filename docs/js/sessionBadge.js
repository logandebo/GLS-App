// Session Badge: disabled per request — hide username/status in header

function hideSessionBadge() {
  const el = document.getElementById('header-username') || document.getElementById('lc-header-username');
  if (!el) return;
  try {
    el.textContent = '';
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  } catch {}
}

function subscribeAuthChanges() {
  const sb = window.supabaseClient;
  try {
    if (sb && typeof sb.onAuthStateChange === 'function') {
      sb.onAuthStateChange(() => hideSessionBadge());
    }
  } catch {}
}

// init
hideSessionBadge();
subscribeAuthChanges();
