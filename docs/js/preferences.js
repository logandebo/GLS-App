// User preferences (Phase 7): focus tags per user
// Storage key: gep_userPreferences_<userId>

const NS = 'gep_userPreferences_';

function keyFor(userId){ return `${NS}${userId}`; }

function normalize(prefs){
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  return {
    focusTags: Array.isArray(p.focusTags) ? Array.from(new Set(p.focusTags.map(String))) : []
  };
}

export function loadUserPreferences(userId){
  if (!userId) return normalize({});
  const raw = localStorage.getItem(keyFor(userId));
  if (!raw) return normalize({});
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return normalize({});
  }
}

export function saveUserPreferences(userId, prefs){
  if (!userId) return;
  const p = normalize(prefs);
  localStorage.setItem(keyFor(userId), JSON.stringify(p));
  return p;
}

export function getFocusTags(userId){
  return loadUserPreferences(userId).focusTags;
}

export function setFocusTags(userId, tags){
  const p = loadUserPreferences(userId);
  p.focusTags = Array.isArray(tags) ? Array.from(new Set(tags.map(String))) : [];
  return saveUserPreferences(userId, p);
}
