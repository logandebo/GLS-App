// Supabase Data Access Layer (DAL)
// Single source of truth: Supabase. localStorage acts as a SWR cache.
// Uses window.supabaseClient from auth/supabaseClient.js.

const CACHE_PREFIX = 'cache:';
const CACHE_KEYS = {
  coursesPublic: CACHE_PREFIX + 'courses_public',
  concepts: CACHE_PREFIX + 'concepts',
  lessons: CACHE_PREFIX + 'lessons'
};

function nowIso() { return new Date().toISOString(); }

function getClient() {
  const c = window.supabaseClient && window.supabaseClient._raw;
  return c || null;
}

async function getAuthUser() {
  const c = getClient();
  if (!c) return { user: null };
  const { data } = await c.auth.getSession();
  return { user: data && data.session ? data.session.user : null };
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { data: null, ts: null };
    const obj = JSON.parse(raw);
    return { data: obj && obj.data != null ? obj.data : null, ts: obj && obj.ts ? obj.ts : null };
  } catch { return { data: null, ts: null }; }
}

function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: nowIso() })); } catch {}
}

function tableNameCourses() { return 'courses'; }
function tableNameLegacyTrees() { return 'creator_trees'; }
function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
function hasColumnError(err, col, table) {
  const msg = String(err && err.message || '').toLowerCase();
  const code = String(err && err.code || '');
  if (code === 'PGS274') return true; // PostgREST schema cache column error
  return msg.includes(`could not find the '${String(col).toLowerCase()}' column`) && msg.includes(String(table || '').toLowerCase());
}

// Generic helpers -----------------------------------------------------------
async function selectOne(table, filters) {
  const c = getClient();
  if (!c) return { data: null, error: new Error('Supabase not configured') };
  let q = c.from(table).select('*').limit(1).maybeSingle();
  Object.entries(filters || {}).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  return { data, error };
}

async function upsert(table, payload, options = {}) {
  const c = getClient();
  if (!c) return { data: null, error: new Error('Supabase not configured') };
  const { data, error } = await c.from(table).upsert(payload, options).select();
  return { data, error };
}

async function removeWhere(table, filters) {
  const c = getClient();
  if (!c) return { data: null, error: new Error('Supabase not configured') };
  let q = c.from(table).delete().select('*');
  Object.entries(filters || {}).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  return { data, error };
}

// Profiles -----------------------------------------------------------------
export async function getProfile() {
  const c = getClient();
  if (!c) return { profile: null, error: null };
  const { user } = await getAuthUser();
  if (!user) return { profile: null, error: null };
  const { data, error } = await selectOne('profiles', { id: user.id });
  return { profile: data || null, error };
}

export async function upsertProfile({ display_name, avatar_url } = {}) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  const payload = { id: user.id, display_name: display_name || null, avatar_url: avatar_url || null, updated_at: nowIso() };
  const { error } = await upsert('profiles', payload, { onConflict: 'id' });
  return { ok: !error, error };
}

// Progress -----------------------------------------------------------------
export async function getUserProgress() {
  const c = getClient();
  if (!c) return { progress: [], error: null };
  const { user } = await getAuthUser();
  if (!user) return { progress: [], error: null };
  const { data, error } = await c
    .from('user_progress')
    .select('user_id, entity_type, entity_id, status, xp, meta, updated_at')
    .eq('user_id', user.id);
  return { progress: Array.isArray(data) ? data : [], error };
}

export async function upsertProgress({ entity_type, entity_id, status, xp, meta } = {}) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  const payload = { user_id: user.id, entity_type, entity_id, status: status || null, xp: Number(xp)||0, meta: meta || {}, updated_at: nowIso() };
  const { error } = await upsert('user_progress', payload, { onConflict: 'user_id,entity_type,entity_id' });
  return { ok: !error, error };
}

export async function bulkUpsertProgress(records = []) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  const rows = (Array.isArray(records) ? records : []).map(r => ({
    user_id: user.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    status: r.status || null,
    xp: Number(r.xp)||0,
    meta: r.meta || {},
    updated_at: nowIso()
  }));
  const { error } = await upsert('user_progress', rows, { onConflict: 'user_id,entity_type,entity_id' });
  return { ok: !error, error };
}

// Concepts -----------------------------------------------------------------
export async function getConcept(id) {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.concepts);
  if (!c) return { concept: cache.data ? cache.data[id] || null : null, error: null };
  const { data, error } = await selectOne('concepts', { id });
  if (!error && data) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    map[id] = data;
    writeCache(CACHE_KEYS.concepts, map);
  }
  return { concept: data || null, error };
}

export async function getConcepts(ids = []) {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.concepts);
  if (!c) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    return { concepts: ids.map(id => map[id]).filter(Boolean), error: null };
  }
  const { data, error } = await c.from('concepts').select('*').in('id', ids);
  if (!error && Array.isArray(data)) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    data.forEach(cn => { if (cn && cn.id) map[cn.id] = cn; });
    writeCache(CACHE_KEYS.concepts, map);
  }
  return { concepts: Array.isArray(data) ? data : [], error };
}

export async function upsertConcept(concept = {}) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  // Align with public.concepts schema: owner_id, title, summary, content(jsonb), tags[], is_published
  const payload = {
    owner_id: user.id,
    title: concept.title,
    summary: concept.summary || concept.description || '',
    content: {
      domain: concept.domain || concept.subject || 'general',
      source_id: concept.id || null
    },
    tags: Array.isArray(concept.tags) ? concept.tags : [],
    is_published: concept.is_public === true || concept.is_published === true
  };
  // Insert without specifying id to avoid invalid uuid errors
  const { error } = await upsert('concepts', payload, {});
  if (!error) {
    const cache = readCache(CACHE_KEYS.concepts);
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    // Cache by source_id if provided, otherwise by title
    const cacheKey = (payload.content && payload.content.source_id) || payload.title;
    if (cacheKey) map[cacheKey] = { ...payload };
    writeCache(CACHE_KEYS.concepts, map);
  }
  return { ok: !error, error };
}

// Lessons ------------------------------------------------------------------
export async function getLesson(id) {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.lessons);
  if (!c) return { lesson: cache.data ? cache.data[id] || null : null, error: null };
  const { data, error } = await selectOne('lessons', { id });
  if (!error && data) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    map[id] = data;
    writeCache(CACHE_KEYS.lessons, map);
  }
  return { lesson: data || null, error };
}

export async function getLessons(ids = []) {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.lessons);
  if (!c) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    return { lessons: ids.map(id => map[id]).filter(Boolean), error: null };
  }
  const { data, error } = await c.from('lessons').select('*').in('id', ids);
  if (!error && Array.isArray(data)) {
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    data.forEach(ls => { if (ls && ls.id) map[ls.id] = ls; });
    writeCache(CACHE_KEYS.lessons, map);
  }
  return { lessons: Array.isArray(data) ? data : [], error };
}

export async function upsertLesson(lesson = {}) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  // Align with public.lessons schema: owner_id, title, description, body(jsonb), duration_seconds, thumbnail_url, concept_ids[], is_published
  const payload = {
    owner_id: user.id,
    title: lesson.title,
    description: lesson.description || '',
    body: {
      content_type: lesson.content_type || lesson.type || 'article',
      content_url: lesson.content_url || '',
      payload: lesson.payload || lesson.contentConfig || {}
    },
    duration_seconds: Number(lesson.duration_seconds || 0) || null,
    thumbnail_url: lesson.thumbnail_url || null,
    concept_ids: Array.isArray(lesson.concept_ids) ? lesson.concept_ids : [],
    is_published: lesson.is_public === true || lesson.is_published === true
  };
  // Insert without specifying id to avoid invalid uuid errors
  const { error } = await upsert('lessons', payload, {});
  if (!error) {
    const cache = readCache(CACHE_KEYS.lessons);
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    const cacheKey = lesson.id || payload.title;
    if (cacheKey) map[cacheKey] = { ...payload };
    writeCache(CACHE_KEYS.lessons, map);
  }
  return { ok: !error, error };
}

// Courses ------------------------------------------------------------------
function normalizeCourseRow(row) {
  if (!row) return null;
  const t = row.tree_json || {};
  return {
    id: row.id,
    created_by: row.owner_id || row.created_by,
    title: row.title || t.title || 'Untitled',
    description: row.description || t.description || '',
    slug: row.slug || null,
    is_published: !!row.is_published,
    tree_json: t,
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || nowIso()
  };
}

export async function getCourseById(id) {
  const c = getClient();
  if (!c) return { course: null, error: new Error('Supabase not configured') };
  // Prefer new 'courses' table; fallback to legacy 'creator_trees' if needed
  let { data, error } = await selectOne(tableNameCourses(), { id });
  if (error || !data) {
    const { data: legacy, error: legacyErr } = await selectOne(tableNameLegacyTrees(), { id });
    if (!legacyErr && legacy) { data = legacy; error = null; }
  }
  return { course: normalizeCourseRow(data), error };
}

export async function getCourseBySlug(slug) {
  const c = getClient();
  if (!c) return { course: null, error: new Error('Supabase not configured') };
  // Public access: restrict to published courses to satisfy RLS policies
  let q = c.from(tableNameCourses()).select('*').eq('slug', slug).eq('is_published', true).limit(1).maybeSingle();
  const { data, error } = await q;
  return { course: normalizeCourseRow(data), error };
}

export async function getCoursesPublic() {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.coursesPublic);
  if (!c) return { courses: Array.isArray(cache.data) ? cache.data : [], error: null };
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('is_published', true);
  if (error || !Array.isArray(data) || data.length === 0) {
    // Fallback to legacy table if present
    const { data: legacy, error: legacyErr } = await c.from(tableNameLegacyTrees()).select('*').eq('is_published', true);
    if (!legacyErr && Array.isArray(legacy)) { data = legacy; error = null; }
  }
  const mapped = Array.isArray(data) ? data.map(normalizeCourseRow) : [];
  writeCache(CACHE_KEYS.coursesPublic, mapped);
  return { courses: mapped, error };
}

export async function getCoursesByUser() {
  const c = getClient();
  if (!c) return { courses: [], error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { courses: [], error: new Error('No auth user') };
  // Try created_by filter first; if schema uses owner_id, fallback
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('created_by', user.id);
  if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
    const res = await c.from(tableNameCourses()).select('*').eq('owner_id', user.id);
    data = res.data; error = res.error;
  }
  if (error || !Array.isArray(data)) {
    const { data: legacy, error: legacyErr } = await c.from(tableNameLegacyTrees()).select('*').eq('owner_id', user.id);
    if (!legacyErr && Array.isArray(legacy)) { data = legacy; error = null; }
  }
  return { courses: Array.isArray(data) ? data.map(normalizeCourseRow) : [], error };
}

export async function upsertCourse(course = {}) {
  const c = getClient();
  if (!c) return { id: null, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { id: null, error: new Error('No auth user') };
  const base = {
    ...(isUuid(course.id) ? { id: course.id } : {}),
    title: course.title || 'Untitled',
    description: course.description || '',
    slug: course.slug || null,
    is_published: !!course.is_published,
    tree_json: course.tree_json || course.tree || {},
    updated_at: nowIso(),
  };
  const options = isUuid(course.id) ? { onConflict: 'id' } : {};
  // Attempt created_by; if column missing, retry with owner_id
  let { data, error } = await upsert(tableNameCourses(), { ...base, created_by: user.id }, options);
  if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
    const res = await upsert(tableNameCourses(), { ...base, owner_id: user.id }, options);
    data = res.data; error = res.error;
  }
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    const code = String(error.code || '');
    // Fallback to legacy table if 'courses' is missing or permission denied
    if (code === '42P01' || /relation .*courses.* does not exist/.test(msg) || /permission denied.*courses/.test(msg)) {
      const legacyPayload = {
        id: course.id,
        owner_id: user.id,
        title: course.title || 'Untitled',
        description: course.description || '',
        is_published: !!course.is_published,
        tree_json: course.tree_json || course.tree || {},
        updated_at: nowIso(),
      };
      const { data: legacyData, error: legacyErr } = await upsert(tableNameLegacyTrees(), legacyPayload, { onConflict: 'id' });
      return { id: Array.isArray(legacyData) && legacyData[0] ? legacyData[0].id : legacyPayload.id || null, error: legacyErr };
    }
  }
  return { id: Array.isArray(data) && data[0] ? data[0].id : (isUuid(course.id) ? course.id : null), error };
}

export async function deleteCourse(id) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  // Prefer new table; restrict by owner
  let { data, error } = await removeWhere(tableNameCourses(), { id, created_by: user.id });
  if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
    const res = await removeWhere(tableNameCourses(), { id, owner_id: user.id });
    data = res.data; error = res.error;
  }
  if (error) {
    const { data: legacy, error: legacyErr } = await removeWhere(tableNameLegacyTrees(), { id, owner_id: user.id });
    if (!legacyErr) { data = legacy; error = null; }
  }
  const count = Array.isArray(data) ? data.length : (data ? 1 : 0);
  return { ok: !error && count > 0, error };
}

// Utility: SWR fetcher for public courses (optional external usage) ---------
export async function swrGetCoursesPublic() {
  const cached = readCache(CACHE_KEYS.coursesPublic);
  // Return cache immediately, then revalidate in the background
  const immediate = Array.isArray(cached.data) ? cached.data : [];
  getCoursesPublic().catch(() => {});
  return immediate;
}

// Utility: SWR fetchers for concepts/lessons (by IDs) ----------------------
export function swrGetConcepts(ids = []) {
  const cache = readCache(CACHE_KEYS.concepts);
  const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
  const immediate = (Array.isArray(ids) ? ids : []).map(id => map[id]).filter(Boolean);
  // Trigger background revalidation
  getConcepts(ids).catch(() => {});
  return immediate;
}

export function swrGetLessons(ids = []) {
  const cache = readCache(CACHE_KEYS.lessons);
  const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
  const immediate = (Array.isArray(ids) ? ids : []).map(id => map[id]).filter(Boolean);
  // Trigger background revalidation
  getLessons(ids).catch(() => {});
  return immediate;
}
