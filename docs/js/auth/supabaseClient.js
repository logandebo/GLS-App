import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from "../config.js";

let supabase = null;

export function initSupabase() {
  if (supabase) return supabase;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase UMD not loaded");
  }
  try { console.log('[AUTH] initSupabase() starting'); } catch {}
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SUPABASE_STORAGE_KEY,
    },
  });
  // One-time legacy token migration with guard flags
  try {
    const keys = Object.keys(localStorage || {});
    const legacyKey = keys.find((k) => k.startsWith("sb-") && k.includes("auth-token")) || null;
    const hasLegacy = !!legacyKey && !!localStorage.getItem(legacyKey || '');
    const hasCurrent = !!localStorage.getItem(SUPABASE_STORAGE_KEY);
    const migratedFlag = localStorage.getItem('gls-auth-migrated') === '1';
    const loggedOutFlag = localStorage.getItem('gls-auth-logged-out') === '1';
    console.log('[AUTH] initSupabase() storage snapshot', {
      SUPABASE_STORAGE_KEY,
      legacyKey,
      hasLegacy,
      hasCurrent,
      migratedFlag,
      loggedOutFlag
    });
    if (hasLegacy && !hasCurrent && !migratedFlag && !loggedOutFlag) {
      const val = localStorage.getItem(legacyKey);
      if (val) {
        localStorage.setItem(SUPABASE_STORAGE_KEY, val);
        localStorage.setItem('gls-auth-migrated', '1');
        console.log('[AUTH] Migrated legacy auth token into', SUPABASE_STORAGE_KEY);
      }
    }
  } catch (e) {
    try { console.warn('[AUTH] initSupabase migration check error', e); } catch {}
  }
  // Back-compat shim for existing modules until fully refactored
  window.supabaseClient = {
    isConfigured: () => !!supabase,
    getSession: () => supabase.auth.getSession(),
    resetPasswordForEmail: (email, redirectTo) => supabase.auth.resetPasswordForEmail(email, { redirectTo }),
    updatePassword: (newPassword) => supabase.auth.updateUser({ password: newPassword }),
    onAuthStateChange: (cb) => {
      const { data } = supabase.auth.onAuthStateChange((evt, session) => {
        try {
          console.log('[AUTH] onAuthStateChange', { evt, hasSession: !!session, user_id: session?.user?.id || null });
          if (session) {
            try { localStorage.removeItem('gls-auth-logged-out'); } catch {}
          }
        } catch {}
        cb(session, evt);
      });
      return () => data.subscription.unsubscribe();
    },
    signInWithEmail: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUpWithEmail: (email, password, data) => supabase.auth.signUp({ email, password, options: { data: data || {} } }),
    signOut: () => supabase.auth.signOut(),
    waitForSessionReady: async (maxMs = 2000, intervalMs = 150) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const { data } = await supabase.auth.getSession();
        if (data?.session) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return false;
    },
    _raw: supabase,
  };
  try { console.log('[AUTH] initSupabase() completed'); } catch {}
  return supabase;
}

export function getSupabase() {
  if (!supabase) throw new Error("Supabase not initialized. Call initSupabase() first.");
  return supabase;
}
