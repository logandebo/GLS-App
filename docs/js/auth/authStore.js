import { initSupabase, getSupabase } from "./supabaseClient.js?v=20260103";

const state = { status: "unknown", session: null, user: null };
const listeners = new Set();

function emit() { for (const fn of listeners) try { fn({ ...state }); } catch {} }

export function getState() { return { ...state }; }
export function subscribe(fn) { listeners.add(fn); try { fn(getState()); } catch{} return () => listeners.delete(fn); }

export async function initAuth() {
  initSupabase();
  const supabase = getSupabase();
  state.status = "unknown"; emit();
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("[AUTH] getSession error", error);
  state.session = data?.session ?? null;
  state.user = data?.session?.user ?? null;
  state.status = state.session ? "authed" : "guest"; emit();
  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session ?? null;
    state.user = session?.user ?? null;
    state.status = session ? "authed" : "guest"; emit();
  });
}

export function requireAuth({ redirectTo = "./auth.html" } = {}) {
  const s = getState();
  if (s.status === "unknown") return false;
  if (s.status === "guest") { location.href = redirectTo; return false; }
  return true;
}
