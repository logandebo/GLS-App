// Unified content loader for built-in + custom content (Iteration 4 Step 3)
// Tabs for indentation

export const CUSTOM_CONCEPTS_KEY = 'gep_customConcepts';
export const CUSTOM_LESSONS_KEY = 'gep_customLessons';
export const PUBLIC_CONCEPTS_KEY = 'gep_publicConcepts';

export function loadCustomConcepts() {
	const raw = localStorage.getItem(CUSTOM_CONCEPTS_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveCustomConcepts(concepts) {
	localStorage.setItem(CUSTOM_CONCEPTS_KEY, JSON.stringify(concepts || []));
}

export function loadCustomLessons() {
	const raw = localStorage.getItem(CUSTOM_LESSONS_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveCustomLessons(lessons) {
	// Persist already-normalized lessons
	localStorage.setItem(CUSTOM_LESSONS_KEY, JSON.stringify((lessons || []).map(normalizeLesson)));
}

// Public concepts catalog (published concepts for learners)
export function loadPublicConcepts() {
	try {
		const raw = localStorage.getItem(PUBLIC_CONCEPTS_KEY);
		if (!raw) return {};
		const obj = JSON.parse(raw);
		return obj && typeof obj === 'object' ? obj : {};
	} catch { return {}; }
}

export function savePublicConcepts(map) {
	try {
		const obj = map && typeof map === 'object' ? map : {};
		localStorage.setItem(PUBLIC_CONCEPTS_KEY, JSON.stringify(obj));
	} catch {}
}

function mapDifficultyNumericToString(d) {
	const n = Number(d) || 0;
	if (n <= 1) return 'beginner';
	if (n === 2) return 'intermediate';
	return 'advanced';
}

function mapDifficultyStringToString(d) {
	if (!d) return 'beginner';
	const lower = String(d).toLowerCase();
	if (['beginner','intermediate','advanced'].includes(lower)) return lower;
	// attempt numeric mapping
	if (!isNaN(Number(lower))) return mapDifficultyNumericToString(Number(lower));
	return 'beginner';
}

function normalizeQuizLegacy(lesson) {
	// Legacy quiz shape: quiz.questions[{ id, type, prompt, options[], correctIndex, explanation }]
	const legacy = lesson.quiz;
	if (!legacy || !Array.isArray(legacy.questions)) return null;
	const questions = legacy.questions.map((q, qi) => {
		const opts = Array.isArray(q.options) ? q.options : [];
		return {
			id: q.id || `q${qi+1}`,
			prompt: q.prompt || '',
			choices: opts.map((text, idx) => ({ id: String.fromCharCode(97+idx), text, isCorrect: idx === q.correctIndex })),
			explanation: q.explanation || ''
		};
	});
	return {
		shuffleQuestions: true,
		questions
	};
}

function normalizeLesson(raw) {
	if (!raw || typeof raw !== 'object') return raw;
	// Already normalized if has contentConfig and type
	if (raw.contentConfig && raw.type) {
		// fix up unity key if needed to match runner expectations
		let cfg = raw.contentConfig;
		if (raw.type === 'unity_game') {
			if (cfg.unity_game == null && cfg.unity != null) {
				cfg = { ...cfg, unity_game: cfg.unity };
			}
		} else if (raw.type === 'external_link') {
			// Normalize to external_link: { links: [{url,label?}], previewVideoUrl? }
			const existing = cfg.external_link || cfg.external || cfg.link || null;
			if (!existing) {
				cfg = { ...cfg, external_link: { links: [], previewVideoUrl: '' } };
			} else {
				let links = [];
				let previewVideoUrl = '';
				if (Array.isArray(existing.links)) {
					links = existing.links.map(x => ({ url: x.url || x.externalUrl || x.link || '', label: x.label || '' }));
					previewVideoUrl = existing.previewVideoUrl || '';
				} else {
					// Legacy single fields
					const singleUrl = existing.externalUrl || existing.url || existing.link || '';
					links = singleUrl ? [{ url: singleUrl, label: existing.label || '' }] : [];
					previewVideoUrl = existing.previewVideoUrl || existing.preview || '';
				}
				cfg = { ...cfg, external_link: { links, previewVideoUrl } };
			}
		}
		return {
			...raw,
			contentConfig: cfg,
			difficulty: mapDifficultyStringToString(raw.difficulty)
		};
	}

	const legacyType = raw.type || raw.contentType; // contentType (video|quiz|game|external) legacy
	let mappedType = 'video';
	if (legacyType === 'quiz') mappedType = 'quiz';
	else if (legacyType === 'game') mappedType = 'unity_game';
	else if (legacyType === 'video') mappedType = 'video';
	else if (legacyType === 'external' || legacyType === 'external_link' || legacyType === 'link') mappedType = 'external_link';

	const minutes = raw.minutes || raw.estimatedMinutes || 0;
	const difficultyStr = mapDifficultyNumericToString(raw.difficulty);

	const contentConfig = { video: undefined, unity_game: undefined, quiz: undefined, external_link: undefined };
	if (mappedType === 'video') {
		const url = raw.media?.videoUrl || raw.media?.url || raw.videoUrl || '';
		contentConfig.video = { url }; // may be empty
	} else if (mappedType === 'unity_game') {
		const url = raw.media?.url || raw.unityUrl || '';
		contentConfig.unity_game = { url };
	} else if (mappedType === 'external_link') {
		const candidates = [];
		if (Array.isArray(raw.externalLinks)) {
			for (const x of raw.externalLinks) {
				candidates.push({ url: x.url || x.link || x.externalUrl || '', label: x.label || '' });
			}
		} else {
			const externalUrl = raw.externalUrl || raw.link || raw.media?.url || '';
			if (externalUrl) candidates.push({ url: externalUrl, label: raw.externalLabel || '' });
		}
		const previewVideoUrl = raw.previewVideoUrl || raw.media?.videoUrl || '';
		contentConfig.external_link = { links: candidates, previewVideoUrl };
	} else if (mappedType === 'quiz') {
		contentConfig.quiz = normalizeQuizLegacy(raw) || raw.contentConfig?.quiz || { shuffleQuestions: true, questions: [] };
	}

	return {
		id: raw.id,
		conceptId: raw.conceptId,
		title: raw.title,
		description: raw.summary || raw.description || '',
		type: mappedType,
		minutes: Number(minutes) || 0,
		difficulty: difficultyStr,
		contentConfig,
		xpReward: raw.xpReward || 0,
		isCustom: !!raw.isCustom,
		createdBy: raw.createdBy || raw.author || null
	};
}

// Load all concepts: built-in (from data/graph.json) + custom from localStorage
export async function loadAllConcepts() {
	const res = await fetch('data/graph.json');
	if (!res.ok) throw new Error('Failed to load built-in concepts');
	const graph = await res.json();
	const builtinConcepts = Array.isArray(graph?.concepts) ? graph.concepts : Array.isArray(graph) ? graph : [];
	const customConcepts = loadCustomConcepts();
	return [...builtinConcepts, ...customConcepts];
}

// Load all lessons: built-in (from data/lessons.json) + custom from localStorage
export async function loadAllLessons() {
	const res = await fetch('data/lessons.json');
	if (!res.ok) throw new Error('Failed to load built-in lessons');
	const data = await res.json();
	const builtinLegacy = Array.isArray(data?.lessons) ? data.lessons : Array.isArray(data) ? data : [];
	const builtinNormalized = builtinLegacy.map(normalizeLesson);
	const customLegacy = loadCustomLessons();
	const customNormalized = customLegacy.map(normalizeLesson);
	return [...builtinNormalized, ...customNormalized];
}
