import { loadAllLessons } from './contentLoader.js';

let _lessons = null; // Array of lessons (merged built-in + custom)
let _lessonMap = null; // Map id -> lesson

export async function loadLessons() {
	if (_lessons) return _lessons;
	const merged = await loadAllLessons();
	_lessons = Array.isArray(merged) ? merged : (merged?.lessons || []);
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
	return arr.filter(l => l && l.conceptId === conceptId);
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