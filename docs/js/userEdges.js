// User-derived concept relationships from playlists
// Key: gep_userEdges_<userId>

const NS = 'gep_userEdges_';

function keyFor(userId) {
  return `${NS}${userId}`;
}

export function loadUserEdges(userId) {
  if (!userId) return [];
  const raw = localStorage.getItem(keyFor(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUserEdges(userId, edges) {
  if (!userId) return;
  const arr = Array.isArray(edges) ? edges : [];
  localStorage.setItem(keyFor(userId), JSON.stringify(arr));
}

export function recomputeUserEdges(userId, playlists, lessonLookup) {
  const lookupFn = typeof lessonLookup === 'function' ? lessonLookup : () => null;
  const weightMap = new Map(); // `${A}→${B}` -> weight
  (playlists || []).forEach(pl => {
    const ids = Array.isArray(pl.lessonIds) ? pl.lessonIds : [];
    for (let i = 0; i < ids.length - 1; i++) {
      const l1 = lookupFn(ids[i]);
      const l2 = lookupFn(ids[i + 1]);
      const a = l1?.conceptId;
      const b = l2?.conceptId;
      if (!a || !b || a === b) continue;
      const key = `${a}→${b}`;
      weightMap.set(key, (weightMap.get(key) || 0) + 1);
    }
  });
  const edges = Array.from(weightMap.entries()).map(([key, weight]) => {
    const [sourceConceptId, targetConceptId] = key.split('→');
    return { sourceConceptId, targetConceptId, type: 'USER_NEXT', weight };
  });
  saveUserEdges(userId, edges);
  return edges;
}
