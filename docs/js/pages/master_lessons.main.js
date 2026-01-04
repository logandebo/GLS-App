import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../masterLessons.js?v=20260103");
  if (typeof mod.initMasterLessons === "function") {
    await mod.initMasterLessons();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
