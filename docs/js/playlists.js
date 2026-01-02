// Playlists storage and helpers (Phase 6)
// LocalStorage persistence per-user under key: gep_playlists_<userId>

const NS = 'gep_playlists_';

function keyFor(userId) {
  return `${NS}${userId}`;
}

export function loadPlaylists(userId) {
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

export function savePlaylists(userId, lists) {
  if (!userId) return;
  const sanitized = Array.isArray(lists) ? lists : [];
  localStorage.setItem(keyFor(userId), JSON.stringify(sanitized));
}

function generateId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `playlist_${Date.now().toString(36)}_${rnd}`;
}

export function createPlaylist(userId, {
  title = 'Untitled Playlist',
  description = '',
  createdBy = userId,
  isPublic = false
} = {}) {
  const lists = loadPlaylists(userId);
  const pl = {
    id: generateId(),
    title: String(title || 'Untitled Playlist'),
    description: String(description || ''),
    createdBy: createdBy || userId,
    lessonIds: [],
    isPublic: !!isPublic
  };
  lists.push(pl);
  savePlaylists(userId, lists);
  return pl;
}

export function addLesson(userId, playlistId, lessonId, position) {
  const lists = loadPlaylists(userId);
  const idx = lists.findIndex(p => p.id === playlistId);
  if (idx < 0) return null;
  const pl = lists[idx];
  if (!Array.isArray(pl.lessonIds)) pl.lessonIds = [];
  if (pl.lessonIds.includes(lessonId)) return pl; // no duplicates
  if (Number.isInteger(position) && position >= 0 && position <= pl.lessonIds.length) {
    pl.lessonIds.splice(position, 0, lessonId);
  } else {
    pl.lessonIds.push(lessonId);
  }
  savePlaylists(userId, lists);
  return pl;
}

export function removeLesson(userId, playlistId, lessonId) {
  const lists = loadPlaylists(userId);
  const idx = lists.findIndex(p => p.id === playlistId);
  if (idx < 0) return null;
  const pl = lists[idx];
  pl.lessonIds = (pl.lessonIds || []).filter(id => id !== lessonId);
  savePlaylists(userId, lists);
  return pl;
}

export function reorderLessons(userId, playlistId, fromIndex, toIndex) {
  const lists = loadPlaylists(userId);
  const idx = lists.findIndex(p => p.id === playlistId);
  if (idx < 0) return null;
  const pl = lists[idx];
  const arr = pl.lessonIds || [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return pl;
  if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length) return pl;
  const [moved] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, moved);
  pl.lessonIds = arr;
  savePlaylists(userId, lists);
  return pl;
}

export function getProgress(playlist, profile) {
  const total = Array.isArray(playlist?.lessonIds) ? playlist.lessonIds.length : 0;
  if (!profile || !profile.conceptProgress) return { completed: 0, total };
  const completedSet = new Set();
  try {
    const cps = Object.values(profile.conceptProgress || {});
    cps.forEach(cp => (cp?.completedLessonIds || []).forEach(id => completedSet.add(id)));
  } catch { /* noop */ }
  let completed = 0;
  (playlist.lessonIds || []).forEach(id => { if (completedSet.has(id)) completed++; });
  return { completed, total };
}

export function getTotalMinutes(playlist, lessonLookup) {
  if (!playlist || !Array.isArray(playlist.lessonIds)) return 0;
  const lookupFn = typeof lessonLookup === 'function' ? lessonLookup : (id) => null;
  let sum = 0;
  for (const id of playlist.lessonIds) {
    const lesson = lookupFn(id);
    if (!lesson) continue;
    const mins = Number(lesson.minutes || lesson.estimatedMinutes || 0) || 0;
    sum += mins;
  }
  return sum;
}

export function updatePlaylistMeta(userId, playlistId, { title, description, isPublic }) {
  const lists = loadPlaylists(userId);
  const idx = lists.findIndex(p => p.id === playlistId);
  if (idx < 0) return null;
  const pl = lists[idx];
  if (typeof title === 'string') pl.title = title.trim() || pl.title;
  if (typeof description === 'string') pl.description = description;
  if (typeof isPublic === 'boolean') pl.isPublic = isPublic;
  savePlaylists(userId, lists);
  return pl;
}

export function deletePlaylist(userId, playlistId) {
  const lists = loadPlaylists(userId);
  const next = lists.filter(p => p.id !== playlistId);
  savePlaylists(userId, next);
  return next;
}

export function duplicatePlaylist(userId, playlistId, { titlePrefix = 'Copy of ' } = {}) {
  const lists = loadPlaylists(userId);
  const src = lists.find(p => p.id === playlistId);
  if (!src) return null;
  const copy = {
    id: generateId(),
    title: `${titlePrefix}${src.title || 'Playlist'}`.slice(0, 120),
    description: src.description || '',
    createdBy: userId,
    lessonIds: Array.isArray(src.lessonIds) ? [...src.lessonIds] : [],
    isPublic: false
  };
  lists.push(copy);
  savePlaylists(userId, lists);
  return copy;
}

// Export a portable playlist object for download
export function exportPlaylistData(playlist) {
  if (!playlist) return null;
  return {
    type: 'playlist',
    version: 1,
    title: String(playlist.title || 'Untitled Playlist'),
    description: String(playlist.description || ''),
    lessonIds: Array.isArray(playlist.lessonIds) ? playlist.lessonIds.slice() : []
  };
}

// Validate and import a playlist JSON object; creates a new playlist id and returns it
export function importPlaylistData(userId, data, lessonExistsFn) {
  if (!userId) throw new Error('No user');
  if (!data || typeof data !== 'object') throw new Error('Invalid file');
  if (data.type !== 'playlist') throw new Error('Not a playlist file');
  const title = (data.title || '').toString().trim();
  const description = (data.description || '').toString();
  const lessonIds = Array.isArray(data.lessonIds) ? data.lessonIds.map(String) : [];
  const exists = typeof lessonExistsFn === 'function' ? lessonIds.filter(id => !!lessonExistsFn(id)) : lessonIds;
  const pl = createPlaylist(userId, { title: title || 'Imported Playlist', description, isPublic: false });
  // add lessons
  exists.forEach(id => addLesson(userId, pl.id, id));
  return pl;
}
