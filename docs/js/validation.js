import { loadCustomConcepts, loadCustomLessons } from './contentLoader.js';

// Cache snapshots (not live reactive)
let _conceptIds = null;
let _lessonIds = null;

function ensureCaches() {
	if (!_conceptIds) {
		try {
			const custom = loadCustomConcepts();
			_conceptIds = new Set([...(custom||[]).map(c=>c.id)]);
		} catch { _conceptIds = new Set(); }
	}
	if (!_lessonIds) {
		try {
			const customL = loadCustomLessons();
			_lessonIds = new Set([...(customL||[]).map(l=>l.id)]);
		} catch { _lessonIds = new Set(); }
	}
}

export function isUniqueConceptId(id) {
	ensureCaches();
	return id && !_conceptIds.has(id);
}

export function isUniqueLessonId(id) {
	ensureCaches();
	return id && !_lessonIds.has(id);
}

export function isNonEmpty(value) {
	return !!(value && value.trim());
}

export function validUrlMaybe(value) {
	if (!value) return false;
	const s = String(value).trim();
	if (!s) return false;
	// Accept root-relative or relative asset paths (e.g., /assets/video/x.mp4 or assets/video/x.mp4)
	const hasExt = /\.[a-z0-9]+$/i.test(s);
	const isProtocolRelative = s.startsWith('//');
	const hasProtocol = /^[a-z]+:\/\//i.test(s);
	if ((s.startsWith('/') || (!hasProtocol && !isProtocolRelative)) && hasExt) {
		return true;
	}
	// Try to resolve as absolute or using current origin if available
	try {
		if (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.origin) {
			new URL(s, globalThis.location.origin);
			return true;
		}
		new URL(s);
		return true;
	} catch { return false; }
}

export function validateVideoConfig(url) {
	return validUrlMaybe(url);
}

export function validateUnityConfig(url) {
	return validUrlMaybe(url);
}

export function validateExternalConfig(externalUrl, previewVideoUrl) {
	if (!validUrlMaybe(externalUrl)) return false;
	if (previewVideoUrl && !validUrlMaybe(previewVideoUrl)) return false;
	return true;
}

export function validateExternalLinks(externalLinks, previewVideoUrl) {
	const arr = Array.isArray(externalLinks) ? externalLinks : [];
	if (arr.length === 0) return false;
	for (const item of arr) {
		if (!validUrlMaybe(item?.url)) return false;
	}
	if (previewVideoUrl && !validUrlMaybe(previewVideoUrl)) return false;
	return true;
}

export function validateQuizQuestions(questions) {
	if (!Array.isArray(questions) || !questions.length) return false;
	for (const q of questions) {
		if (!isNonEmpty(q.prompt)) return false;
		if (!Array.isArray(q.choices) || q.choices.length < 2) return false;
		if (q.choices.some(c => !isNonEmpty(c.text))) return false;
		if (!q.choices.some(c => c.isCorrect)) return false;
	}
	return true;
}

export function difficultyIsValid(d) {
	return ['beginner','intermediate','advanced'].includes((d||'').toLowerCase());
}

// --- Keyboard Lesson Validation ---
function _notePatternValid(s){
	if (s == null) return false;
	if (typeof s === 'number') return Number.isInteger(s) && s >= 0 && s <= 127;
	const m = String(s).trim();
	return /^([A-Ga-g])([#b]?)(\d)$/.test(m);
}

function _noteNameNoOctaveValid(s){
	if (s == null) return false;
	const m = String(s).trim();
	return /^([A-Ga-g])([#b]?)$/.test(m);
}

function _targetValidWithOctaveOption(target, ignoreOctave){
	return _notePatternValid(target) || (ignoreOctave && _noteNameNoOctaveValid(target));
}

export function validateKeyboardLessonConfig(cfg){
	const mode = String(cfg?.mode || 'note').toLowerCase();
	const range = String(cfg?.range || cfg?.allowedRange || '').trim();
	if (!/^([A-Ga-g][#b]?\d)-([A-Ga-g][#b]?\d)$/.test(range)) return false;
	if (Array.isArray(cfg?.steps) && cfg.steps.length > 0){
		for (const step of cfg.steps){
			const arr = Array.isArray(step?.targets) ? step.targets : [step?.target || step?.targetNote];
			if (!arr || !arr.length) return false;
			const stepIgnore = !!step?.ignoreOctave || !!cfg?.ignoreOctave;
			if (!arr.every(t => _targetValidWithOctaveOption(t, stepIgnore))) return false;
			if (step?.attempts && (!Number.isFinite(Number(step.attempts)) || Number(step.attempts) < 1)) return false;
			if (step?.simultaneous != null && typeof step.simultaneous !== 'boolean') return false;
			if (step?.ignoreOctave != null && typeof step.ignoreOctave !== 'boolean') return false;
		}
		return true;
	}
	// Single-note config
	if (!['note'].includes(mode)) return false;
	const attempts = Number(cfg?.attempts || 1);
	if (!Number.isFinite(attempts) || attempts < 1) return false;
	const target = cfg?.target ?? cfg?.targetNote;
	const ignore = !!cfg?.ignoreOctave;
	if (!_targetValidWithOctaveOption(target, ignore)) return false;
	return true;
}
