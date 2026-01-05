// One-time migration from localStorage to Supabase (v1)
// Detects legacy keys and upserts data to Supabase using the DAL.
// After success, sets localStorage flag 'migration:v1:done' and shows a toast.

import { CUSTOM_CONCEPTS_KEY, CUSTOM_LESSONS_KEY, loadCustomConcepts, loadCustomLessons } from './contentLoader.js';
import { getActiveUsername } from './storage.js';
import { renderToast } from './ui.js';
import { upsertProfile, upsertConcept, upsertLesson, upsertCourse, bulkUpsertProgress } from './dataStore.js';

function storageKeyCreatorTrees(userId) { return `gep_creatorTrees_${userId}`; }

function readJson(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function runMigrationV1() {
  try {
    // Skip if already done
    if (localStorage.getItem('migration:v1:done') === '1') return;
    // Require Supabase and auth
    const sb = window.supabaseClient;
    if (!sb || !sb.isConfigured || !sb.isConfigured()) return;
    const { data } = await sb.getSession();
    const user = data && data.session ? data.session.user : null;
    if (!user) return; // only migrate for signed-in users

    const username = getActiveUsername();
    const creatorKey = username ? storageKeyCreatorTrees(username) : null;

    // 1) Profile
    try {
      const legacyProfile = readJson('gep_userProfile') || readJson('userProfile') || readJson('gep_profile');
      const display_name = legacyProfile?.username || username || null;
      const avatar_url = legacyProfile?.avatar_url || null;
      if (display_name) await upsertProfile({ display_name, avatar_url });
    } catch {}

    // 2) Progress
    try {
      const progress = readJson('gep_progress');
      if (Array.isArray(progress) && progress.length) {
        const rows = progress.map(r => ({
          entity_type: r.entity_type || r.type,
          entity_id: r.entity_id || r.id,
          status: r.status || null,
          xp: r.xp || 0,
          meta: r.meta || {}
        })).filter(r => r.entity_type && r.entity_id);
        if (rows.length) await bulkUpsertProgress(rows);
      }
    } catch {}

    // 3) Custom concepts
    try {
      const concepts = loadCustomConcepts();
      for (const c of (Array.isArray(concepts) ? concepts : [])) {
        const payload = {
          id: c.id,
          title: c.title || c.id,
          summary: c.shortDescription || c.longDescription || '',
          domain: c.subject || 'general',
          tags: Array.isArray(c.tags) ? c.tags : [],
          is_public: false
        };
        if (payload.id) await upsertConcept(payload);
      }
    } catch {}

    // 4) Custom lessons
    try {
      const lessons = loadCustomLessons();
      for (const l of (Array.isArray(lessons) ? lessons : [])) {
        const payload = {
          id: l.id,
          title: l.title || l.id,
          description: l.summary || l.description || '',
          content_type: l.type || l.contentType || 'article',
          content_url: (l.media && l.media.url) || l.videoUrl || '',
          payload: l.contentConfig || {},
          is_public: false
        };
        if (payload.id) await upsertLesson(payload);
      }
    } catch {}

    // 5) Draft courses (creator trees)
    try {
      if (creatorKey) {
        const trees = readJson(creatorKey);
        if (Array.isArray(trees)) {
          for (const t of trees) {
            const payload = {
              id: t.id,
              title: t.title || 'Untitled',
              description: t.description || '',
              slug: t.slug || t.id,
              is_published: false,
              tree_json: t
            };
            if (payload.id) await upsertCourse(payload);
          }
        }
      }
    } catch {}

    localStorage.setItem('migration:v1:done', '1');
    renderToast('Migration completed.', 'success');
  } catch {}
}
