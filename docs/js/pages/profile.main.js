import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../profile.js?v=20260103");
  if (typeof mod.initProfile === "function") {
    await mod.initProfile();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
