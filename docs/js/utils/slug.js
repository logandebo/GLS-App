// Shared slug utilities
// Generates collision-resistant course slugs: slugify(title) + '-' + random base62 suffix

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function slugifyTitle(title, maxLen = 64) {
  const base = String(title || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$|\s+/g, '');
  if (!base) return 'course';
  return base.length > maxLen ? base.slice(0, maxLen) : base;
}

export function randomSuffix(len = 12) {
  const n = Math.max(4, Math.min(64, Number(len) || 12));
  const arr = new Uint8Array(n);
  // crypto.getRandomValues may not exist in some environments; fallback to Math.random only if necessary
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < n; i++) out += BASE62[arr[i] % BASE62.length];
  return out;
}

export function generateCourseSlug(title, len = 12, maxTotalLen = 80) {
  const clean = slugifyTitle(title, Math.max(1, maxTotalLen - (len + 1)));
  const suf = randomSuffix(len);
  const slug = `${clean}-${suf}`;
  return slug.length > maxTotalLen ? slug.slice(0, maxTotalLen) : slug;
}
