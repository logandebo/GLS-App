import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../subtree_node.js?v=20260103");
  if (typeof mod.initSubtreeNode === "function") {
    await mod.initSubtreeNode();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
