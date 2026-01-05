import { initSupabase } from "../auth/supabaseClient.js?v=20260103";
import { initAuth } from "../auth/authStore.js?v=20260103";
import { runMigrationV1 } from "../migration.js";

export async function bootCommon({ initPage } = {}) {
  console.log("[BOOT] start");
  initSupabase();
  console.log("[BOOT] supabase init ok");
  await initAuth();
  console.log("[BOOT] auth init done status=", (window?.supabaseClient?._raw ? "ok" : "na"));
  // One-time migration: run after auth init when signed in
  try { await runMigrationV1(); } catch {}
  // Header controls
  const { initHeaderControls } = await import("../headerControls.js?v=20260103");
  initHeaderControls();
  console.log("[BOOT] header init done");
  // Optional debug and badges
  try { await import("../debugLogging.js?v=20260103"); } catch {}
  try { await import("../sessionBadge.js?v=20260103"); } catch {}
  if (initPage) await initPage();
  console.log("[BOOT] done");
}
