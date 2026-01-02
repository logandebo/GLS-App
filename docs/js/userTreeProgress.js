// Per-user progress tracking within a published tree
// Storage key: gep_userTreeProgress_<userId>

function keyFor(userId){ return `gep_userTreeProgress_${userId}`; }

export function loadUserTreeProgress(userId){
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

export function saveUserTreeProgress(userId, map){
  try { localStorage.setItem(keyFor(userId), JSON.stringify(map && typeof map === 'object' ? map : {})); } catch {}
}

export function markNodeTouched(userId, treeId, nodeId){
  const data = loadUserTreeProgress(userId);
  const cur = data[treeId] || { touchedNodeIds: [], lastNodeId: null };
  const set = new Set(cur.touchedNodeIds || []);
  if (nodeId) set.add(nodeId);
  const next = { touchedNodeIds: Array.from(set), lastNodeId: nodeId || cur.lastNodeId };
  data[treeId] = next; saveUserTreeProgress(userId, data);
  return next;
}

export function setLastNode(userId, treeId, nodeId){
  const data = loadUserTreeProgress(userId);
  const cur = data[treeId] || { touchedNodeIds: [], lastNodeId: null };
  data[treeId] = { touchedNodeIds: cur.touchedNodeIds || [], lastNodeId: nodeId };
  saveUserTreeProgress(userId, data);
  return data[treeId];
}
