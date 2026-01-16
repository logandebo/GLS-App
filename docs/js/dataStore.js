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
function genId() {
  try { 
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) {
    console.warn('crypto.randomUUID failed:', e);
  }
  // Fallback: generate UUID v4 manually
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
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

export async function listConcepts() {
  const c = getClient();
  if (!c) {
    // If Supabase is not configured, return empty array (don't use stale cache)
    return { concepts: [], error: new Error('Supabase not configured') };
  }
  const { data, error } = await c.from('concepts').select('*').order('title', { ascending: true });
  if (!error && Array.isArray(data)) {
    const map = {};
    data.forEach(cn => { 
      if (cn && cn.id) {
        // Store by UUID id
        map[cn.id] = cn;
        // Also store by source_id if available for backward compatibility
        if (cn.content && cn.content.source_id) {
          map[cn.content.source_id] = cn;
        }
      }
    });
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
  const { data, error } = await upsert('concepts', payload, {});
  if (!error) {
    const cache = readCache(CACHE_KEYS.concepts);
    const map = cache.data && typeof cache.data === 'object' ? cache.data : {};
    // Cache the returned record with its UUID
    if (data && Array.isArray(data) && data[0]) {
      const record = data[0];
      map[record.id] = record;
      if (record.content && record.content.source_id) {
        map[record.content.source_id] = record;
      }
    }
    writeCache(CACHE_KEYS.concepts, map);
  }
  return { ok: !error, data: data && Array.isArray(data) ? data[0] : null, error };
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

// New: Create a draft lesson row immediately
export async function createLessonDraft(initial = {}) {
  const c = getClient();
  if (!c) return { lesson: null, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { lesson: null, error: new Error('No auth user') };
  
  // User validation
  
  // Generate UUID id to match database schema (lessons.id is uuid type)
  let id;
  try {
    id = initial.id || crypto.randomUUID();
    // Generated UUID
  } catch (e) {
    console.error('[dataStore] crypto.randomUUID() failed:', e);
    // Fallback: manual UUID v4 generation
    id = initial.id || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    // Fallback UUID
  }
  
  // Map content types to match DB CHECK constraint: ('video','game','quiz','article','external')
  let contentType = initial.content_type || initial.type || 'video';
  if (contentType === 'unity_game') contentType = 'game';
  if (contentType === 'external_link') contentType = 'external';
  if (contentType === 'keyboard') contentType = 'game'; // keyboard lessons are a game variant
  
  const payload = {
    id,
    owner_id: user.id,      // Required NOT NULL field
    user_id: user.id,
    created_by: user.id,
    title: initial.title || 'Untitled',
    description: initial.description || '',
    content_type: contentType,
    content_url: initial.content_url || '',
    concept_id: initial.concept_id || null,  // Link to parent concept
    payload: initial.payload || initial.contentConfig || {},
    is_public: initial.is_public !== undefined ? initial.is_public : false,
    is_published: initial.is_published !== undefined ? initial.is_published : false,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  // Creating lesson draft
  
  try {
    const { data, error } = await c.from('lessons').insert(payload).select('*').maybeSingle();
    if (error) {
      console.error('[dataStore] createLessonDraft error:', error);
      return { lesson: null, error };
    } else {
      // Draft created
      return { lesson: data, error: null };
    }
  } catch (e) {
    console.error('[dataStore] createLessonDraft exception:', e);
    return { lesson: null, error: e };
  }
}

// New: Update an existing draft lesson row (partial patch)
export async function updateLessonDraft(lessonId, patch = {}) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  
  // Map content types to match DB CHECK constraint
  let contentType = patch.content_type;
  if (contentType === 'unity_game') contentType = 'game';
  if (contentType === 'external_link') contentType = 'external';
  if (contentType === 'keyboard') contentType = 'game';
  
  const rowPatch = {
    ...(patch.title != null ? { title: patch.title } : {}),
    ...(patch.description != null ? { description: patch.description } : {}),
    ...(contentType != null ? { content_type: contentType } : {}),
    ...(patch.content_url != null ? { content_url: patch.content_url } : {}),
    ...(patch.payload != null ? { payload: patch.payload } : {}),
    ...(patch.is_public != null ? { is_public: !!patch.is_public } : {}),
    ...(patch.is_published != null ? { is_published: !!patch.is_published } : {}),
    updated_at: nowIso()
  };
  // Updating lesson draft
  const { data, error } = await c
    .from('lessons')
    .update(rowPatch)
    .eq('id', lessonId)
    .or(`created_by.eq.${user.id},user_id.eq.${user.id}`)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('[dataStore] updateLessonDraft error:', error);
  } else {
    // Update successful
  }
  return { ok: !error && !!data, error, lesson: data || null };
}

// New: List my lessons (owner scope)
export async function listMyLessons() {
  const c = getClient();
  if (!c) return { lessons: [], error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { lessons: [], error: new Error('No auth user') };
  const { data, error } = await c
    .from('lessons')
    .select('*')
    .or(`created_by.eq.${user.id},user_id.eq.${user.id}`)
    .order('updated_at', { ascending: false });
  return { lessons: Array.isArray(data) ? data : [], error };
}

// New: List public + published lessons
export async function listPublicLessons() {
  const c = getClient();
  if (!c) return { lessons: [], error: new Error('Supabase not configured') };
  console.log('[listPublicLessons] Querying lessons with is_public=true, is_published=true');
  const { data, error } = await c
    .from('lessons')
    .select('*')
    .eq('is_public', true)
    .eq('is_published', true)
    .order('updated_at', { ascending: false });
  console.log('[listPublicLessons] Query result:', data?.length || 0, 'lessons', 'error:', error);
  if (data) {
    console.log('[listPublicLessons] All lesson IDs:', data.map(l => l.id));
    console.log('[listPublicLessons] All concept_ids:', data.map(l => l.concept_id));
  }
  return { lessons: Array.isArray(data) ? data : [], error };
}

// Optional: Delete a lesson (owner scope)
export async function deleteLesson(lessonId) {
  const c = getClient();
  if (!c) return { ok: false, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { ok: false, error: new Error('No auth user') };
  let q = c.from('lessons').delete().eq('id', lessonId).or(`created_by.eq.${user.id},user_id.eq.${user.id}`).select('*');
  const { data, error } = await q;
  const count = Array.isArray(data) ? data.length : (data ? 1 : 0);
  return { ok: !error && count > 0, error };
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
  // Extract display_name from joined profiles table
  const creatorName = row.profiles?.display_name || null;
  return {
    id: row.id,
    created_by: row.owner_id || row.created_by,
    creator_id: row.owner_id || row.created_by,
    creatorId: row.owner_id || row.created_by,
    creatorName: creatorName,
    title: row.title || t.title || 'Untitled',
    description: row.description || t.description || '',
    slug: row.slug || null,
    is_published: !!row.is_published,
    tree_json: t,
    // Extract tree_json fields to top level for backward compatibility
    nodes: t.nodes || [],
    rootConceptId: t.rootConceptId,
    primaryDomain: t.primaryDomain,
    tags: t.tags || [],
    created_at: row.created_at || nowIso(),
    updated_at: row.updated_at || nowIso()
  };
}

export async function getCourseById(id) {
  const c = getClient();
  if (!c) return { course: null, error: new Error('Supabase not configured') };
  // Fetching course by ID
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('id', id).limit(1).maybeSingle();
  // If owner-only row blocked by RLS or not found, try published-only read for public viewers
  if ((error || !data) && c) {
    try {
      const res = await c.from(tableNameCourses()).select('*').eq('id', id).eq('is_published', true).limit(1).maybeSingle();
      if (!res.error && res.data) { data = res.data; error = null; }
    } catch (e) {
      console.error('[dataStore] getCourseById published query exception:', e);
    }
  }
  // Only try legacy fallback if courses table truly doesn't exist (not just RLS)
  if (error && error.message && error.message.includes('does not exist')) {
    console.log('[dataStore] courses table does not exist, trying legacy creator_trees');
    const { data: legacy, error: legacyErr } = await c.from(tableNameLegacyTrees()).select('*').eq('id', id).limit(1).maybeSingle();
    if (!legacyErr && legacy) { data = legacy; error = null; }
  } else if (!data) {
    console.error('[dataStore] getCourseById failed:', error);
  }
  // Fetch profile separately
  if (data && data.created_by) {
    const { data: profile } = await c.from('profiles').select('display_name').eq('id', data.created_by).limit(1).maybeSingle();
    if (profile) {
      data.profiles = { display_name: profile.display_name };
    }
  }
  return { course: normalizeCourseRow(data), error };
}

export async function getCourseBySlug(slug) {
  const c = getClient();
  if (!c) return { course: null, error: new Error('Supabase not configured') };
  // Public access: restrict to published courses to satisfy RLS policies
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('slug', slug).eq('is_published', true).limit(1).maybeSingle();
  // Fetch profile separately
  if (data && data.created_by) {
    const { data: profile } = await c.from('profiles').select('display_name').eq('id', data.created_by).limit(1).maybeSingle();
    if (profile) {
      data.profiles = { display_name: profile.display_name };
    }
  }
  return { course: normalizeCourseRow(data), error };
}

export async function getCoursesPublic() {
  const c = getClient();
  const cache = readCache(CACHE_KEYS.coursesPublic);
  if (!c) return { courses: Array.isArray(cache.data) ? cache.data : [], error: null };
  
  // Fetch courses
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('is_published', true);
  
  if (error || !Array.isArray(data) || data.length === 0) {
    // Fallback to legacy table if present
    const { data: legacy, error: legacyErr } = await c.from(tableNameLegacyTrees()).select('*').eq('is_published', true);
    if (!legacyErr && Array.isArray(legacy)) { data = legacy; error = null; }
  }
  
  // Fetch profiles separately and match them up
  if (Array.isArray(data) && data.length > 0) {
    const creatorIds = [...new Set(data.map(course => course.created_by).filter(Boolean))];
    if (creatorIds.length > 0) {
      const { data: profiles } = await c.from('profiles').select('id, display_name').in('id', creatorIds);
      if (profiles && Array.isArray(profiles)) {
        const profileMap = new Map(profiles.map(p => [p.id, p.display_name]));
        data = data.map(course => ({
          ...course,
          profiles: { display_name: profileMap.get(course.created_by) || null }
        }));
      }
    }
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
  console.log('[getCoursesByUser] Querying courses for user:', user.id);
  // Query courses table without join first
  let { data, error } = await c.from(tableNameCourses()).select('*').eq('created_by', user.id);
  console.log('[getCoursesByUser] Query result:', data?.length, 'courses, error:', error);
  if (error || !Array.isArray(data)) {
    console.log('[getCoursesByUser] Courses query failed, returning empty array');
    return { courses: [], error };
  }
  return { courses: Array.isArray(data) ? data.map(normalizeCourseRow) : [], error };
}

export async function upsertCourse(course = {}) {
  const c = getClient();
  if (!c) return { id: null, error: new Error('Supabase not configured') };
  const { user } = await getAuthUser();
  if (!user) return { id: null, error: new Error('No auth user') };
  const base = {
    title: course.title || 'Untitled',
    description: course.description || '',
    slug: course.slug || null,
    is_published: !!course.is_published,
    tree_json: course.tree_json || course.tree || {},
    updated_at: nowIso(),
  };
  // Only include id if it's a valid UUID (for updates)
  if (course.id && isUuid(course.id)) {
    base.id = course.id;
  }
  // Strategy: select by slug first. If exists and owned by user → update. If exists but not owned → generate a new slug and insert. Else → insert.
  const hasSlug = !!base.slug;
  let data = null; let error = null;
  if (hasSlug) {
    const { data: existing, error: selErr } = await c.from(tableNameCourses()).select('*').eq('slug', base.slug).limit(1).maybeSingle();
    if (!selErr && existing) {
      const owned = (existing.created_by === user.id) || (existing.owner_id === user.id);
      if (owned) {
        const upd = await c.from(tableNameCourses()).update({ ...base, created_by: user.id }).eq('id', existing.id).select('*').maybeSingle();
        data = upd.data ? [upd.data] : null; error = upd.error || null;
        if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
          const upd2 = await c.from(tableNameCourses()).update({ ...base, owner_id: user.id }).eq('id', existing.id).select('*').maybeSingle();
          data = upd2.data ? [upd2.data] : null; error = upd2.error || null;
        }
      } else {
        // Collision with someone else's slug: generate a fresh slug and insert
        const clean = (course.title ? String(course.title) : 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        base.slug = `${clean}-${Math.random().toString(36).slice(2, 10)}`;
        let ins = await c.from(tableNameCourses()).insert({ ...base, created_by: user.id }).select('*');
        data = ins.data; error = ins.error;
        if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
          ins = await c.from(tableNameCourses()).insert({ ...base, owner_id: user.id }).select('*');
          data = ins.data; error = ins.error;
        }
      }
    } else if (!selErr) {
      // No existing slug: insert
      let ins = await c.from(tableNameCourses()).insert({ ...base, created_by: user.id }).select('*');
      data = ins.data; error = ins.error;
      if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
        ins = await c.from(tableNameCourses()).insert({ ...base, owner_id: user.id }).select('*');
        data = ins.data; error = ins.error;
      }
    } else {
      // Selection error → attempt insert
      let ins = await c.from(tableNameCourses()).insert({ ...base, created_by: user.id }).select('*');
      data = ins.data; error = ins.error;
    }
  } else {
    // No slug provided: upsert by id
    const options = { onConflict: 'id' };
    let res = await upsert(tableNameCourses(), { ...base, created_by: user.id }, options);
    data = res.data; error = res.error;
    if (error && hasColumnError(error, 'created_by', tableNameCourses())) {
      const res2 = await upsert(tableNameCourses(), { ...base, owner_id: user.id }, options);
      data = res2.data; error = res2.error;
    }
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
  return { id: Array.isArray(data) && data[0] ? data[0].id : base.id, error };
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
