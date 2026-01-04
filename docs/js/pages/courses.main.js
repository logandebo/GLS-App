import { bootCommon } from "./boot.js";
import { subscribe, getState } from "../auth/authStore.js?v=20260103";

async function initPage() {
  console.log("[BOOT] courses initPage start");
  subscribe((s) => console.log("[DEBUG] authStore state on courses", s.status));
  const mod = await import("../courses.js?v=20260103");
  if (typeof mod.initCourses === "function") {
    await mod.initCourses();
  }
  console.log("[BOOT] courses initPage done");
}

bootCommon({ initPage }).catch((e) => console.error("[BOOT] fatal", e));
