import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../creator.js?v=20260103");
  if (typeof mod.initCreator === "function") {
    await mod.initCreator();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
