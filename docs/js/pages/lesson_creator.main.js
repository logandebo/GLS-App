import { bootCommon } from "./boot.js";

async function initPage() {
  const mod = await import("../lessonCreator.js");
  if (typeof mod.initLessonCreator === "function") {
    await mod.initLessonCreator();
  }
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
