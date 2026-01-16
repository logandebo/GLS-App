// Unified content loader for built-in + custom content (Iteration 4 Step 3)
// Tabs for indentation

export const CUSTOM_CONCEPTS_KEY = 'gep_customConcepts';
export const CUSTOM_LESSONS_KEY = 'gep_customLessons';
export const PUBLIC_CONCEPTS_KEY = 'gep_publicConcepts';

export function loadCustomConcepts() {
	// No longer load from localStorage - concepts only come from Supabase
	// Clear old data if it exists - clear ALL possible cache keys
	try {
		localStorage.removeItem(CUSTOM_CONCEPTS_KEY);
		localStorage.removeItem('cache:concepts');
		localStorage.removeItem('gep_publicConcepts'); // Also clear public concepts cache
		// Set a flag to indicate migration to Supabase-only
		localStorage.setItem('gep_concepts_migrated_to_supabase', 'true');
	} catch {}
	return [];
}

export function saveCustomConcepts(concepts) {
	// No longer save to localStorage - concepts are saved to Supabase via dataStore.js
	// This function is kept for backward compatibility but does nothing
	console.log('[contentLoader] saveCustomConcepts is deprecated - use dataStore.upsertConcept instead');
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
	// Only load lessons from Supabase (no fallback to built-in JSON or localStorage)
	console.log('[loadAllLessons] START - checking Supabase...');
	console.log('[loadAllLessons] window.supabaseClient exists?', !!window.supabaseClient);
	console.log('[loadAllLessons] isConfigured?', window.supabaseClient?.isConfigured?.());
	try {
		if (window.supabaseClient && window.supabaseClient.isConfigured && window.supabaseClient.isConfigured()) {
			console.log('[loadAllLessons] Supabase is configured, importing dataStore...');
			const { listPublicLessons } = await import('./dataStore.js');
			console.log('[loadAllLessons] Calling listPublicLessons()...');
			const { lessons: cloud, error } = await listPublicLessons();
			console.log('[loadAllLessons] listPublicLessons returned:', cloud?.length, 'lessons, error:', error);
			if (!error && Array.isArray(cloud)) {
				console.log('[loadAllLessons] Normalizing', cloud.length, 'Supabase lessons...');
				// Map Supabase rows to normalized lesson objects
				const normalized = cloud.map(row => {
					const typeMap = { video: 'video', game: 'unity_game', quiz: 'quiz', article: 'video', external: 'external_link' };
					const type = typeMap[String(row.content_type || 'video').toLowerCase()] || 'video';
					const payload = row.payload || {};
					let contentConfig = { video: undefined, unity_game: undefined, quiz: undefined, external_link: undefined };
					if (type === 'video') {
						// Preserve source-based video config (YouTube, R2, Supabase Storage, external)
						const source = payload?.video?.source || null;
						const youtubeUrl = payload?.video?.youtubeUrl || null;
						const storagePath = payload?.video?.storagePath || null;
						const url = row.content_url || payload?.video?.url || '';
						const r2Key = payload?.video?.r2Key || null;
						
						if (source === 'youtube' && youtubeUrl) {
							contentConfig.video = { source: 'youtube', youtubeUrl };
						} else if (source === 'r2' && r2Key) {
							contentConfig.video = { source: 'r2', r2Key, url };
						} else if (source === 'supabase' && storagePath) {
							contentConfig.video = { source: 'supabase', storagePath, url };
						} else if (source === 'external' && url) {
							contentConfig.video = { source: 'external', url };
						} else if (storagePath) {
							// Legacy: storagePath without explicit source
							contentConfig.video = { source: 'supabase', storagePath, url };
						} else if (url) {
							// Fallback: external URL
							contentConfig.video = { source: 'external', url };
						} else {
							contentConfig.video = { url: '' };
						}
					} else if (type === 'unity_game') {
						// Preserve R2 Unity builds
						const source = payload?.unity_game?.source || null;
						const r2Key = payload?.unity_game?.r2Key || null;
						const url = row.content_url || payload?.unity_game?.url || '';
						if (source === 'r2' && r2Key) {
							contentConfig.unity_game = { source: 'r2', r2Key, url };
						} else {
							contentConfig.unity_game = { source: source || 'external', url };
						}
					} else if (type === 'quiz') {
						contentConfig.quiz = payload?.quiz || { shuffleQuestions: true, questions: [] };
					} else if (type === 'external_link') {
						const links = (payload?.external_link?.links && Array.isArray(payload.external_link.links)) ? payload.external_link.links : [];
						const previewVideoUrl = payload?.external_link?.previewVideoUrl || '';
						contentConfig.external_link = { links, previewVideoUrl };
					}
					return {
						id: row.id,
						conceptId: row.concept_id || row.conceptId || null,
						title: row.title || row.id,
						description: row.description || '',
						type,
						minutes: 0,
						difficulty: 'beginner',
						contentConfig,
						xpReward: 0,
						isCustom: false
					};
				});
				console.log('[loadAllLessons] Normalized lessons:', normalized.length);
				console.log('[loadAllLessons] Returning normalized lessons from Supabase');
				return normalized;
			} else {
				console.log('[loadAllLessons] No lessons from Supabase (error or empty array)');
			}
		} else {
			console.log('[loadAllLessons] Supabase NOT configured');
		}
	} catch (e) {
		console.error('[loadAllLessons] Error loading from Supabase:', e);
		console.error('[loadAllLessons] Stack:', e.stack);
	}
	// Return empty array if Supabase is not configured or failed (no fallback)
	console.log('[loadAllLessons] Returning empty array (no Supabase data)');
	return [];
}
