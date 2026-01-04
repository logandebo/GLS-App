import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../myLessons.js?v=20260103");
  if (typeof mod.initMyLessons === "function") {
    await mod.initMyLessons();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
