import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../goals.js?v=20260103");
  if (typeof mod.initGoals === "function") {
    await mod.initGoals();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
