// Concept Progress Module (Phase 7)
// Storage key: gep_conceptProgress_<userId>

const NS = 'gep_conceptProgress_';

function keyFor(userId) {
  return `${NS}${userId}`;
}

function isNumber(n) {
  return typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n);
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function toPct(score) {
  if (!isNumber(score)) return 0;
  // Accept 0..1 or 0..100
  return score <= 1 ? clamp(Math.round(score * 100), 0, 100) : clamp(Math.round(score), 0, 100);
}

function todayStr(d = new Date()) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function loadAll(userId) {
  if (!userId) return {};
  const raw = localStorage.getItem(keyFor(userId));
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function saveAll(userId, map) {
  if (!userId) return;
  const out = map && typeof map === 'object' ? map : {};
  localStorage.setItem(keyFor(userId), JSON.stringify(out));
}

function normalizeEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  return {
    timesStudied: isNumber(e.timesStudied) ? e.timesStudied : 0,
    minutes: isNumber(e.minutes) ? e.minutes : 0,
    recentScore: isNumber(e.recentScore) ? clamp(e.recentScore, 0, 100) : 0,
    movingAverageScore: isNumber(e.movingAverageScore) ? clamp(e.movingAverageScore, 0, 100) : 0,
    lessonsCompleted: isNumber(e.lessonsCompleted) ? e.lessonsCompleted : 0,
    streak: isNumber(e.streak) ? e.streak : 0,
    lastStudiedAt: typeof e.lastStudiedAt === 'string' ? e.lastStudiedAt : null
  };
}

export function loadConceptProgress(userId) {
  const all = loadAll(userId);
  const out = {};
  Object.keys(all).forEach(k => (out[k] = normalizeEntry(all[k])));
  return out;
}

export function saveConceptProgress(userId, progressMap) {
  const sanitized = {};
  Object.keys(progressMap || {}).forEach(k => {
    sanitized[k] = normalizeEntry(progressMap[k]);
  });
  saveAll(userId, sanitized);
  return sanitized;
}

export function getConceptEntry(userId, conceptId) {
  const map = loadConceptProgress(userId);
  return normalizeEntry(map[conceptId]);
}

export function setConceptEntry(userId, conceptId, entry) {
  const map = loadConceptProgress(userId);
  map[conceptId] = normalizeEntry(entry);
  saveConceptProgress(userId, map);
  return map[conceptId];
}

function updateStreak(prevDateStr, now = new Date()) {
  if (!prevDateStr) return { delta: 1, dateStr: todayStr(now) };
  const prev = new Date(prevDateStr + 'T00:00:00Z');
  const cur = new Date(todayStr(now) + 'T00:00:00Z');
  const diffDays = Math.round((cur - prev) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return { delta: 0, dateStr: todayStr(now) }; // same day, don't increment
  if (diffDays === 1) return { delta: 1, dateStr: todayStr(now) }; // consecutive day
  return { delta: -Infinity, dateStr: todayStr(now) }; // reset streak
}

export function recordSession(userId, conceptId, { minutes = 0, score = null, completed = false, when = new Date() } = {}) {
  if (!userId || !conceptId) return null;
  const map = loadConceptProgress(userId);
  const cur = normalizeEntry(map[conceptId]);
  const sPct = score === null ? null : toPct(score);
  const alpha = 0.3; // EMA smoothing factor
  const next = { ...cur };
  next.timesStudied = (cur.timesStudied || 0) + 1;
  next.minutes = (cur.minutes || 0) + (isNumber(minutes) ? Math.max(0, Math.round(minutes)) : 0);
  if (sPct !== null) {
    next.recentScore = sPct;
    next.movingAverageScore = cur.movingAverageScore ? Math.round(alpha * sPct + (1 - alpha) * cur.movingAverageScore) : sPct;
  }
  if (completed) next.lessonsCompleted = (cur.lessonsCompleted || 0) + 1;
  const { delta, dateStr } = updateStreak(cur.lastStudiedAt, when);
  if (delta === -Infinity) next.streak = 1; else next.streak = Math.max(1, (cur.streak || 0) + delta);
  next.lastStudiedAt = dateStr;
  map[conceptId] = next;
  saveConceptProgress(userId, map);
  return next;
}

export function computeMasteryTier(entryLike) {
  const e = normalizeEntry(entryLike);
  const avg = e.movingAverageScore || 0; // 0..100
  const lessons = e.lessonsCompleted || 0;
  // Gold: >= 3 lessons OR avg ≥ 85%
  if (lessons >= 3 || avg >= 85) return 'Gold';
  // Silver: >= 2 lessons AND avg ≥ 75%
  if (lessons >= 2 && avg >= 75) return 'Silver';
  // Bronze: >= 1 lesson OR avg ≥ 60%
  if (lessons >= 1 || avg >= 60) return 'Bronze';
  return 'Unrated';
}

export function getConceptMastery(userId, conceptId) {
  const e = getConceptEntry(userId, conceptId);
  const tier = computeMasteryTier(e);
  return { tier, entry: e };
}

export function clearConceptProgress(userId) {
  saveAll(userId, {});
}
