import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../concept.js?v=20260103");
  if (typeof mod.initConcept === "function") {
    await mod.initConcept();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
