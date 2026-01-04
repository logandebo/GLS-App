import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../player.js?v=20260103");
  if (typeof mod.initLessonPlayer === "function") {
    await mod.initLessonPlayer();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
