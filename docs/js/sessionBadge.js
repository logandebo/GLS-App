// Session Badge: shows Supabase email or demo username in the header
import { getActiveUsername } from './storage.js';

async function updateHeader() {
  const el = document.getElementById('header-username') || document.getElementById('lc-header-username');
  if (!el) return;

  let text = 'Not signed in';
  try {
    const sb = window.supabaseClient;
    if (sb && sb.isConfigured()) {
      const { data, error } = await sb.getSession();
      if (!error) {
        const session = data?.session || null;
        if (session && session.user && session.user.email) {
          text = `Signed in: ${session.user.email}`;
        }
      }
    }
  } catch {}

  if (text === 'Not signed in') {
    const username = getActiveUsername();
    if (username) text = `Demo user: ${username}`;
  }
  el.textContent = text;
}

function subscribeAuthChanges() {
  const sb = window.supabaseClient;
  if (!sb || !sb.isConfigured) return;
  try {
    sb.onAuthStateChange(() => updateHeader());
  } catch {}
}

// init
updateHeader();
subscribeAuthChanges();
