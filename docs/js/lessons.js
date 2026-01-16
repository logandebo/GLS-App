import { loadAllLessons } from './contentLoader.js';

let _lessons = null; // Array of lessons (merged built-in + custom)
let _lessonMap = null; // Map id -> lesson

export async function loadLessons() {
	if (_lessons) {
		console.log('[loadLessons] _lessons already cached with', _lessons.length, 'lessons - returning cache');
		console.log('[loadLessons] Cached lesson IDs:', _lessons.map(l => l.id));
		return _lessons;
	}
	console.log('[loadLessons] Loading lessons from Supabase...');
	const merged = await loadAllLessons();
	console.log('[loadLessons] loadAllLessons returned:', merged?.length || 0, 'lessons');
	_lessons = Array.isArray(merged) ? merged : (merged?.lessons || []);
	console.log('[loadLessons] After normalization:', _lessons.length, 'lessons');
	buildLessonMap(_lessons);
	return _lessons;
}

export function getAllLessons() {
	return Array.isArray(_lessons) ? _lessons.slice() : [];
}

export function getLessonById(id) {
	if (_lessonMap && id in _lessonMap) return _lessonMap[id] || null;
	const arr = Array.isArray(_lessons) ? _lessons : [];
	return arr.find(l => l && l.id === id) || null;
}

export function getLessonsForConcept(conceptId) {
	const arr = Array.isArray(_lessons) ? _lessons : [];
	console.log('[getLessonsForConcept] Searching for conceptId:', conceptId);
	console.log('[getLessonsForConcept] Total lessons loaded:', arr.length);
	if (arr.length > 0) {
		console.log('[getLessonsForConcept] Sample lesson:', arr[0]);
		console.log('[getLessonsForConcept] Lesson conceptIds:', arr.map(l => l?.conceptId));
	}
	const filtered = arr.filter(l => l && l.conceptId === conceptId);
	console.log('[getLessonsForConcept] Filtered lessons:', filtered.length);
	return filtered;
}

export function buildLessonMap(lessonsArray) {
	const arr = lessonsArray || (Array.isArray(_lessons) ? _lessons : []);
	const map = {};
	(arr || []).forEach(l => { if (l && l.id) map[l.id] = l; });
	_lessonMap = map;
	return _lessonMap;
}

export function getLessonMap() {
	if (!_lessonMap) buildLessonMap();
	return _lessonMap || {};
}