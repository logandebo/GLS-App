import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../subtree.js?v=20260103");
  if (typeof mod.initSubtree === "function") {
    await mod.initSubtree();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
