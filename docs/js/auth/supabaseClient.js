import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from "../config.js";

let supabase = null;

export function initSupabase() {
  if (supabase) return supabase;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase UMD not loaded");
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SUPABASE_STORAGE_KEY,
    },
  });
  try {
    const keys = Object.keys(localStorage || {});
    const legacyKey = keys.find((k) => k.startsWith("sb-") && k.includes("auth-token")) || null;
    if (legacyKey && !localStorage.getItem(SUPABASE_STORAGE_KEY)) {
      const val = localStorage.getItem(legacyKey);
      if (val) localStorage.setItem(SUPABASE_STORAGE_KEY, val);
    }
  } catch {}
  // Back-compat shim for existing modules until fully refactored
  window.supabaseClient = {
    isConfigured: () => !!supabase,
    getSession: () => supabase.auth.getSession(),
    onAuthStateChange: (cb) => {
      const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
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
  return supabase;
}

export function getSupabase() {
  if (!supabase) throw new Error("Supabase not initialized. Call initSupabase() first.");
  return supabase;
}
