import { initSupabase } from "../auth/supabaseClient.js?v=20260103";
import { initAuth } from "../auth/authStore.js?v=20260103";

async function bootAuth() {
  console.log("[BOOT] auth start");
  initSupabase();
  await initAuth();
  const { initAuthPage } = await import("../auth_supabase.js?v=20260103");
  initAuthPage();
  console.log("[BOOT] auth done");
}

bootAuth().catch((e) => console.error("[BOOT] fatal", e));
