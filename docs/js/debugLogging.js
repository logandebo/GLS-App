// Debug logging for page switches and auth status
(function(){
  const pageId = (document && document.body && document.body.id) || '';
  const path = (window && window.location) ? (window.location.pathname + window.location.hash) : '';
  const sb = window.supabaseClient;

  const deriveDisplayName = (user) => {
    if (!user) return null;
    const meta = user.user_metadata || {};
    const fromMeta = [meta.full_name, meta.preferred_username, meta.username, meta.name]
      .find(v => typeof v === 'string' && v.trim());
    if (fromMeta) return fromMeta;
    if (user.email) return (user.email || '').split('@')[0];
    return user.id || null;
  };

  async function logStatus(ctx){
    let loggedIn = false, displayUser = 'anonymous';
    try {
      if (sb && sb.isConfigured && sb.isConfigured()){
        const { data } = await sb.getSession();
        const user = data && data.session ? data.session.user : null;
        loggedIn = Boolean(user);
        displayUser = deriveDisplayName(user) || (user && (user.email || user.id)) || 'anonymous';
      }
    } catch {}
    console.log(`[DEBUG] ${ctx} -> page=${pageId || path} path=${path} loggedIn=${loggedIn} user=${displayUser}`);
  }

  // Log on page load
  logStatus('page_load');

  // Also log on auth changes that occur after load
  try {
    if (sb && sb.isConfigured && sb.isConfigured()){
      sb.onAuthStateChange((session) => {
        const user = session && session.user ? session.user : null;
        const loggedIn = Boolean(user);
        const displayUser = deriveDisplayName(user) || (user && (user.email || user.id)) || 'none';
        console.log(`[DEBUG] auth_change -> page=${pageId || path} loggedIn=${loggedIn} user=${displayUser}`);
      });
    }
  } catch {}
})();
