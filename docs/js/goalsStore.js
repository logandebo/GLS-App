const NS = 'gep_userGoals_';

function key(userId){ return `${NS}${userId}`; }

export function loadGoals(userId){
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? Array.from(new Set(arr.map(String))) : [];
  } catch { return []; }
}

export function saveGoals(userId, goals){
  if (!userId) return [];
  const arr = Array.isArray(goals) ? Array.from(new Set(goals.map(String))) : [];
  localStorage.setItem(key(userId), JSON.stringify(arr));
  return arr;
}

export function addGoal(userId, conceptId){
  const arr = loadGoals(userId);
  if (!arr.includes(conceptId)) arr.push(String(conceptId));
  return saveGoals(userId, arr);
}

export function removeGoal(userId, conceptId){
  const arr = loadGoals(userId).filter(id => id !== String(conceptId));
  return saveGoals(userId, arr);
}

export function clearGoals(userId){
  if (!userId) return;
  localStorage.removeItem(key(userId));
}
