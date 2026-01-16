import { loadGraph, getAllConcepts, getRelationshipsForConcept, getConceptById } from './graph.js';
import { loadLessons, getLessonById, getAllLessons, buildLessonMap, getLessonMap, getLessonsForConcept } from './lessons.js';
import { getOrCreateDefaultProfile, markLessonCompleted, computeTotalXpFromCompletedLessons, recomputeAllConceptProgress } from './user.js';
import { renderToast } from './ui.js';
import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
import { runLesson } from './lessonRunner.js';
import { upsertProgress as dsUpsertProgress, getLesson as dsGetLesson } from './dataStore.js';
import { recordSession, getConceptMastery } from './conceptProgress.js';
import { loadUserPreferences } from './preferences.js';
import { loadPlaylists, createPlaylist, addLesson as addLessonToPlaylist } from './playlists.js';
import { loadPublicCatalog } from './catalogStore.js';

(function initHeader() {
	const usernameEl = document.getElementById('header-username');
	const switchBtn = document.getElementById('header-switch-user');
	const username = getActiveUsername();
	if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
	if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

export async function initLessonPlayer() {
	console.log('[player] initLessonPlayer starting...');
	migrateLegacyProfileIfNeeded();
	const active = ensureActiveUserOrRedirect();
	if (!active) return;
	let profile = getActiveProfile();
	if (!profile) {
		profile = createDefaultProfile(active);
		saveActiveProfile(profile);
	}
	const container = document.getElementById('lessonContainer');
	if (container) container.textContent = 'Loading lesson…';
	try {
		await loadGraph();
		await loadLessons();
		buildLessonMap(getAllLessons());
		const url = new URL(window.location.href);
		const lessonId = url.searchParams.get('lessonId');
		const treeId = url.searchParams.get('treeId');
		const conceptId = url.searchParams.get('conceptId');
		console.log('[player] URL params:', { lessonId, treeId, conceptId });
		if (!lessonId) {
			renderToast('Missing lessonId', 'error');
			if (container) container.textContent = 'No lesson specified.';
			return;
		}
		console.log('[player] Looking up lesson:', lessonId);
		let lesson = getLessonById(lessonId);
		if (!lesson) {
			console.log('[player] Lesson not in local cache, fetching from Supabase...');
			try {
				const { lesson: cloud } = await dsGetLesson(lessonId);
				console.log('[player] Supabase result:', cloud);
				if (cloud) {
					console.log('[player] Normalizing cloud lesson...');
					lesson = normalizeCloudLesson(cloud);
					console.log('[player] Normalized lesson:', lesson);
					console.log('[player] Lesson structure check - title:', lesson?.title, 'type:', lesson?.type, 'contentConfig:', lesson?.contentConfig);
				} else {
					console.log('[player] Supabase returned null/undefined lesson');
				}
			} catch (e) {
				console.error('[player] Error fetching from Supabase:', e);
			}
		}
		if (!lesson) {
			console.error('[player] Lesson not found:', lessonId);
			renderToast('Lesson not found', 'error');
			if (container) container.textContent = 'Lesson not found.';
			return;
		}
		console.log('[player] Lesson found:', lesson.title);
		console.log('[player] Lesson structure check - title:', lesson?.title, 'type:', lesson?.type, 'contentConfig:', lesson?.contentConfig);
		const concept = getConceptById(lesson.conceptId);
		console.log('[player] Concept from graph.js:', concept ? concept.title : 'not found');
		
		// Fallback: if concept not found in graph, try loading from Supabase
		let conceptToUse = concept;
		if (!conceptToUse && lesson.conceptId) {
			console.log('[player] Trying to load concept from Supabase...');
			try {
				const { listConcepts } = await import('./dataStore.js');
				const { concepts } = await listConcepts();
				if (Array.isArray(concepts)) {
					conceptToUse = concepts.find(c => c.id === lesson.conceptId);
					console.log('[player] Concept from Supabase:', conceptToUse ? conceptToUse.title : 'not found');
				}
			} catch (e) {
				console.error('[player] Error loading concepts from Supabase:', e);
			}
		}
		
		const profile = getOrCreateDefaultProfile();
		setupMeta(lesson, conceptToUse);
		if (container) container.innerHTML = '';
		setupPlaylistModal(lesson);
		// Back navigation buttons for subtree context
		const backLessonsBtn = document.getElementById('backToLessonsBtn');
		const backTreeBtn = document.getElementById('backToTreeBtn');
		console.log('[player] Back buttons:', { backLessonsBtn: !!backLessonsBtn, backTreeBtn: !!backTreeBtn });
		if (backLessonsBtn) {
			if (treeId && conceptId) {
				console.log('[player] Setting up back to lessons button with subtree context');
				backLessonsBtn.addEventListener('click', () => {
					const url = `subtree_node.html?treeId=${encodeURIComponent(treeId)}&conceptId=${encodeURIComponent(conceptId)}`;
					console.log('[player] Navigating to:', url);
					window.location.href = url;
				});
			}
			else {
				console.log('[player] Setting up back to lessons button (no subtree context)');
				backLessonsBtn.addEventListener('click', () => { window.location.href = 'courses.html'; });
			}
		}
		if (backTreeBtn) {
			if (treeId) {
				console.log('[player] Setting up back to tree button');
				backTreeBtn.addEventListener('click', () => {
					const url = `subtree.html?treeId=${encodeURIComponent(treeId)}`;
					console.log('[player] Navigating to:', url);
					window.location.href = url;
				});
			}
			else {
				console.log('[player] Setting up back to tree button (no tree context)');
				backTreeBtn.addEventListener('click', () => { window.location.href = 'courses.html'; });
			}
		}
		console.log('[player] Rendering lesson...');
		renderLesson(lesson, conceptToUse, profile);
		// Sidebar rendering for subtree context
		if (treeId && conceptId) {
			await renderSubtreeSidebar(treeId, conceptId, lesson.id);
			const toggle = document.getElementById('subtreeSidebarToggle');
			const sidebar = document.getElementById('subtreeSidebar');
			const layout = document.getElementById('lessonLayout');
			if (toggle && sidebar){
				toggle.addEventListener('click', () => {
					sidebar.classList.toggle('collapsed');
					if (layout) layout.classList.toggle('collapsed');
					toggle.textContent = sidebar.classList.contains('collapsed') ? 'Show' : 'Hide';
				});
			}
		}
		const continueBtn = document.getElementById('continueBtn');
		if (continueBtn) {
			// If subtree context provided, return to subtree node page; else Home
			if (treeId && conceptId) {
				continueBtn.textContent = 'Back to Lessons';
				continueBtn.addEventListener('click', () => {
					window.location.href = `subtree_node.html?treeId=${encodeURIComponent(treeId)}&conceptId=${encodeURIComponent(conceptId)}`;
				});
			} else {
				continueBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
			}
		}
	} catch (e) {
		console.error('Failed to load lesson', e);
		if (container) container.textContent = 'Error loading lesson.';
		renderToast('Failed to load lesson. Please try again.', 'error');
	}
}

function normalizeCloudLesson(row) {
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
		isCustom: true
	};
}

function setupMeta(lesson, concept) {
	console.log('[setupMeta] Called with lesson:', lesson, 'concept:', concept);
	if (!lesson) {
		console.error('[setupMeta] Lesson is null or undefined!');
		return;
	}
	const titleEl = document.getElementById('lessonTitle');
	if (titleEl) titleEl.textContent = lesson.title;
	const meta = document.getElementById('lessonMeta');
	if (meta) {
		const conceptTitle = concept ? concept.title : 'Unknown Concept';
		meta.innerHTML = `<p>Concept: ${conceptTitle}</p>\n<p>XP Reward: ${lesson.xpReward || 0}</p>`;
	}
}

function renderLesson(lesson, concept, profile) {
	const bar = document.getElementById('runnerProgressBar');
	runLesson(lesson, concept, profile, (sessionInfo) => completeLesson(profile, lesson, concept, sessionInfo), (pct) => {
		if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
	});
}

// Legacy quiz/game rendering removed; handled in runner modules.

function completeLesson(profile, lesson, concept, sessionInfo = {}) {
	markLessonCompleted(profile, lesson, concept);
	computeTotalXpFromCompletedLessons(profile, getLessonMap());
	recomputeAllConceptProgress(profile, [concept], getLessonMap());
	// Phase 7: record concept session for mastery tiers
	try {
		const userId = getActiveUsername();
		recordSession(userId, concept.id, {
			minutes: Number(sessionInfo.minutes || lesson.minutes || lesson.estimatedMinutes || 0) || 0,
			score: typeof sessionInfo.score === 'number' ? sessionInfo.score : null,
			completed: true
		});
	} catch (e) {
		console.warn('Failed to record concept session', e);
	}
	const panel = document.getElementById('completionPanel');
	panel.classList.remove('hidden');
	// Bring summary higher and into view
	document.body.classList.add('lesson-completed');
	try { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
	document.getElementById('xpAwardText').textContent = `You earned ${lesson.xpReward} XP!`;
	// Mastery impact + next recommendation
	try {
		// Write cloud progress row (Supabase) if available
		if (window.supabaseClient && window.supabaseClient.isConfigured()) {
			const url = new URL(window.location.href);
			const treeId = url.searchParams.get('treeId') || null;
			const meta = { conceptId: concept.id, treeId, minutes: Number(sessionInfo.minutes || lesson.minutes || 0) || 0, score: typeof sessionInfo.score === 'number' ? sessionInfo.score : null };
			dsUpsertProgress({ entity_type: 'lesson', entity_id: lesson.id, status: 'completed', xp: Number(lesson.xpReward)||0, meta }).catch(()=>{});
			// Optionally mark concept seen/progressed
			dsUpsertProgress({ entity_type: 'concept', entity_id: concept.id, status: 'seen', xp: 0, meta: { treeId } }).catch(()=>{});
		}
	} catch {}
	try {
		const userId = getActiveUsername();
		const mastery = getConceptMastery(userId, concept.id);
		const tier = mastery?.tier || 'Unrated';
		const masterEl = document.getElementById('masteryImpactText');
		if (masterEl) masterEl.textContent = `Current mastery for ${concept.title}: ${tier}`;

		const url = new URL(window.location.href);
		const treeId = url.searchParams.get('treeId');
		const conceptId = url.searchParams.get('conceptId');
		const startNextBtn = document.getElementById('startNextLessonBtn');
		const openNextConceptBtn = document.getElementById('openNextConceptBtn');

		if (treeId && conceptId) {
			// Subtree-specific: compute next lesson within subtree order and route back to subtree lesson page
			const nextLesson = computeNextSubtreeLesson(treeId, conceptId, lesson.id);
			if (openNextConceptBtn) openNextConceptBtn.classList.add('hidden');
			if (nextLesson) {
				startNextBtn.classList.remove('hidden');
				startNextBtn.textContent = 'Start Next Lesson';
				startNextBtn.onclick = () => {
					window.location.href = `lesson_subtree.html?lessonId=${encodeURIComponent(nextLesson.id)}&treeId=${encodeURIComponent(treeId)}&conceptId=${encodeURIComponent(conceptId)}`;
				};
			} else {
				startNextBtn.classList.add('hidden');
			}
		} else {
			// Default behavior: compute next recommendation (lesson/concept)
			const next = computeNextRecommendation(profile, lesson, concept);
			if (next?.lesson) {
				startNextBtn.classList.remove('hidden');
				startNextBtn.textContent = 'Start Next Lesson';
				startNextBtn.onclick = () => {
					recordLessonAccessSafe(next.lesson.id);
					window.location.href = `lesson.html?lessonId=${next.lesson.id}`;
				};
			} else {
				startNextBtn.classList.add('hidden');
			}
			if (next?.concept) {
				openNextConceptBtn.classList.remove('hidden');
				openNextConceptBtn.textContent = `Open Next Concept: ${next.concept.title}`;
				openNextConceptBtn.onclick = () => { window.location.href = `concept.html?conceptId=${next.concept.id}`; };
			} else {
				openNextConceptBtn.classList.add('hidden');
			}
		}
	} catch {}
	renderToast('Lesson completed!', 'success');
}

// Legacy game stub removed; unity_game handled via iframe + manual completion button.

// Simple next recommendation based on related concepts, user edges weight, difficulty and focus tags
function computeNextRecommendation(profile, lesson, concept) {
	try {
		const userId = getActiveUsername();
		const prefs = loadUserPreferences(userId) || {}; const focus = new Set(prefs.focusTags || []);
		const allConcepts = getAllConcepts();
		const related = new Set();
		(getRelationshipsForConcept(concept.id) || []).forEach(r => {
			const other = r.from === concept.id ? r.to : r.from; if (other) related.add(other);
		});
		const scored = allConcepts.filter(c => c.id !== concept.id).map(c => {
			let score = 0;
			if (related.has(c.id)) score += 30;
			const difficulty = Number(c.difficulty) || 1; score -= difficulty * 5;
			if (focus.size) {
				const subj = c.subject && focus.has(String(c.subject));
				const tag = Array.isArray(c.tags) && c.tags.some(t => focus.has(String(t)));
				if (subj) score += 12; if (tag) score += 8;
			}
			// Skip fully mastered (gold) when possible
			const m = getConceptMastery(userId, c.id); const tier = (m?.tier || '').toLowerCase();
			const skip = tier === 'gold';
			return { c, score, skip };
		}).sort((a,b) => b.score - a.score);
		let target = scored.find(s => !s.skip)?.c || (scored[0] && scored[0].c) || null;
		if (!target) return null;
		const lessons = getLessonsForConcept(target.id) || [];
		const completedSet = new Set((profile?.conceptProgress?.[target.id]?.completedLessonIds) || []);
		const nextLesson = lessons.find(l => !completedSet.has(l.id)) || lessons[0] || null;
		return { concept: target, lesson: nextLesson };
	} catch { return null; }
}

// Add to playlist modal wiring on lesson page
let _playlistModal = null, _plSelect = null, _plCreateToggle = null, _plCreateFields = null, _plNewTitle = null, _plNewDesc = null, _plErr = null, _plCancel = null, _plAdd = null;
let _selectedLessonForPlaylist = null;
function setupPlaylistModal(currentLesson){
	_playlistModal = document.getElementById('playlistModal');
	if (!_playlistModal) return;
	_plSelect = document.getElementById('plSelect');
	_plCreateToggle = document.getElementById('plCreateToggle');
	_plCreateFields = document.getElementById('plCreateFields');
	_plNewTitle = document.getElementById('plNewTitle');
	_plNewDesc = document.getElementById('plNewDesc');
	_plErr = document.getElementById('plErr');
	_plCancel = document.getElementById('plCancel');
	_plAdd = document.getElementById('plAdd');
	_selectedLessonForPlaylist = currentLesson?.id || null;
	_plCreateToggle.addEventListener('click', () => { _plCreateFields.classList.toggle('hidden'); });
	_plCancel.addEventListener('click', () => closePlaylistModal());
	_plAdd.addEventListener('click', () => confirmAddToPlaylist());
}
function openPlaylistModal(lessonId){
	_selectedLessonForPlaylist = lessonId;
	if (!_playlistModal) return;
	_plErr.textContent = '';
	_plNewTitle.value = '';
	_plNewDesc.value = '';
	_plCreateFields.classList.add('hidden');
	const userId = getActiveUsername();
	const lists = loadPlaylists(userId);
	_plSelect.innerHTML = '';
	if (lists.length === 0) {
		const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No playlists yet'; _plSelect.appendChild(opt);
		_plCreateFields.classList.remove('hidden');
	} else {
		lists.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.title || p.id; _plSelect.appendChild(opt); });
	}
	_playlistModal.classList.remove('hidden');
}
function closePlaylistModal(){ if (_playlistModal) _playlistModal.classList.add('hidden'); }
function confirmAddToPlaylist(){
	const userId = getActiveUsername(); if (!userId) { renderToast('No active user', 'error'); return; }
	const creating = !_plCreateFields.classList.contains('hidden');
	let playlistId = _plSelect.value;
	if (creating) {
		const title = (_plNewTitle.value||'').trim(); const description = (_plNewDesc.value||'').trim();
		if (!title) { _plErr.textContent = 'Title is required to create a playlist.'; return; }
		const pl = createPlaylist(userId, { title, description, isPublic:false }); playlistId = pl.id;
	}
	if (!playlistId) { _plErr.textContent = 'Select a playlist or create one.'; return; }
	if (_selectedLessonForPlaylist) {
		addLessonToPlaylist(userId, playlistId, _selectedLessonForPlaylist);
		renderToast('Added to playlist', 'success');
	} else { renderToast('Playlist created', 'success'); }
	closePlaylistModal();
}

function recordLessonAccessSafe(lessonId){
	try {
		// On lesson page we don't import recordLessonAccess from user.js; keep navigation simple
		// This is a safe no-op placeholder for future analytics.
	} catch {}
}

// Compute next lesson within the subtree node ordering
function normalizeLessonType(t){
	const m = String(t||'').toLowerCase();
	if (m === 'unity_game' || m === 'game') return 'game';
	if (m === 'video') return 'video';
	if (m === 'external_link') return 'video';
	if (m === 'quiz') return 'quiz';
	if (m === 'article') return 'article';
	return 'lesson';
}

function computeNextSubtreeLesson(treeId, conceptId, currentLessonId){
	try {
		const ordered = computeSubtreeOrderedLessons(treeId, conceptId);
		const idx = ordered.findIndex(l => String(l.id) === String(currentLessonId));
		if (idx >= 0 && idx + 1 < ordered.length) return ordered[idx+1];
		return null;
	} catch { return null; }
}

function typeIconForSmall(type){
	const m = normalizeLessonType(type);
	if (m === 'video') return '▶';
	if (m === 'game') return '🕹️';
	if (m === 'quiz') return '✔';
	if (m === 'article') return '✎';
	return '•';
}

function computeSubtreeOrderedLessons(treeId, conceptId){
	try {
		const catalog = loadPublicCatalog();
		const tree = (catalog || []).find(t => String(t.id) === String(treeId));
		if (!tree) return [];
		const node = (Array.isArray(tree.nodes) ? tree.nodes : []).find(n => String(n.conceptId) === String(conceptId)) || null;
		const allLessons = getAllLessons();
		const byId = new Map(allLessons.map(l => [l.id, l]));
		let mine = [];
		if (node && Array.isArray(node.subtreeLessonIds) && node.subtreeLessonIds.length){
			mine = node.subtreeLessonIds.map(id => byId.get(id)).filter(Boolean);
		} else {
			const conceptLessons = getLessonsForConcept(conceptId) || [];
			mine = conceptLessons.filter(l => String(l.createdBy || '') === String(tree.creatorId || ''));
		}
		// Step-aware ordering with type priority: video → quiz → game → article → other
		const stepMap = (node && node.subtreeLessonSteps && typeof node.subtreeLessonSteps==='object') ? node.subtreeLessonSteps : {};
		const byStep = new Map();
		function bucketFor(step){
			const s = Number(step)||1;
			if (!byStep.has(s)) byStep.set(s, { videos:[], quizzes:[], games:[], articles:[], other:[] });
			return byStep.get(s);
		}
		mine.forEach(l => {
			const s = stepMap[l.id] || 1;
			const b = bucketFor(s);
			const t = normalizeLessonType(l.type);
			if (t === 'video') b.videos.push(l);
			else if (t === 'quiz') b.quizzes.push(l);
			else if (t === 'game') b.games.push(l);
			else if (t === 'article') b.articles.push(l);
			else b.other.push(l);
		});
		const orderedSteps = Array.from(byStep.keys()).sort((a,b)=>a-b);
		const ordered = [];
		orderedSteps.forEach(s => {
			const grp = byStep.get(s);
			ordered.push(...grp.videos, ...grp.quizzes, ...grp.games, ...grp.articles, ...grp.other);
		});
		return ordered;
	} catch { return []; }
}

async function renderSubtreeSidebar(treeId, conceptId, currentLessonId){
	console.log('[renderSubtreeSidebar] Called with:', { treeId, conceptId, currentLessonId });
	const listEl = document.getElementById('subtreeSidebarList');
	if (!listEl) return;
	const grouping = await computeSubtreeStepGroups(treeId, conceptId);
	console.log('[renderSubtreeSidebar] Grouping result:', grouping);
	const orderedSteps = grouping.orderedSteps || [];
	const byStep = grouping.byStep || new Map();
	listEl.innerHTML = '';
	if (!orderedSteps.length){
		console.log('[renderSubtreeSidebar] No lessons found in grouping');
		const p = document.createElement('p'); p.className='short muted'; p.textContent = 'No lessons available.'; listEl.appendChild(p);
		return;
	}

	function appendItem(container, l){
		const item = document.createElement('div');
		item.className = 'lesson-sidebar__item' + (String(l.id) === String(currentLessonId) ? ' active' : '');
		const icon = document.createElement('div'); icon.className='lesson-sidebar__icon'; icon.textContent = typeIconForSmall(l.type);
		const title = document.createElement('div'); title.className='lesson-sidebar__title'; title.textContent = l.title || l.id;
		const meta = document.createElement('div'); meta.className='lesson-sidebar__meta'; meta.textContent = `${normalizeLessonType(l.type)}${l.minutes?` · ${l.minutes} min`:''}`;
		item.appendChild(icon); item.appendChild(title); item.appendChild(meta);
		item.addEventListener('click', () => {
			window.location.href = `lesson_subtree.html?lessonId=${encodeURIComponent(l.id)}&treeId=${encodeURIComponent(treeId)}&conceptId=${encodeURIComponent(conceptId)}`;
		});
		container.appendChild(item);
	}

	orderedSteps.forEach(s => {
		const grp = byStep.get(s);
		const section = document.createElement('div'); section.className = 'lesson-sidebar__step';
		const header = document.createElement('div'); header.className = 'lesson-sidebar__step-header';
		const title = document.createElement('div'); title.className = 'lesson-sidebar__step-title'; title.textContent = `Step ${s}`;
		const toggle = document.createElement('button'); toggle.className = 'btn subtle lesson-sidebar__step-toggle'; toggle.textContent = 'Hide';
		header.appendChild(title); header.appendChild(toggle);
		const content = document.createElement('div'); content.className = 'lesson-sidebar__step-content';

		(grp.videos||[]).forEach(l => appendItem(content, l));
		(grp.quizzes||[]).forEach(l => appendItem(content, l));
		(grp.games||[]).forEach(l => appendItem(content, l));
		(grp.articles||[]).forEach(l => appendItem(content, l));
		(grp.other||[]).forEach(l => appendItem(content, l));

		toggle.addEventListener('click', () => {
			content.classList.toggle('collapsed');
			toggle.textContent = content.classList.contains('collapsed') ? 'Show' : 'Hide';
		});

		section.appendChild(header);
		section.appendChild(content);
		listEl.appendChild(section);
	});
}

async function computeSubtreeStepGroups(treeId, conceptId){
	console.log('[computeSubtreeStepGroups] Called with:', { treeId, conceptId });
	try {
		// Load course from Supabase
		const { getCourseById, listPublicLessons } = await import('./dataStore.js');
		const { course, error } = await getCourseById(treeId);
		console.log('[computeSubtreeStepGroups] Course from Supabase:', course, error);
		
		let tree = null;
		if (!error && course) {
			tree = course;
		} else {
			// Fallback to localStorage catalog
			const catalog = loadPublicCatalog();
			console.log('[computeSubtreeStepGroups] Catalog from localStorage:', catalog);
			tree = (catalog || []).find(t => String(t.id) === String(treeId));
		}
		
		if (!tree) {
			console.log('[computeSubtreeStepGroups] No tree found for treeId:', treeId);
			return { orderedSteps: [], byStep: new Map() };
		}
		
		console.log('[computeSubtreeStepGroups] Tree structure:', {
			id: tree.id,
			title: tree.title,
			hasNodes: !!tree.nodes,
			nodesIsArray: Array.isArray(tree.nodes),
			nodesLength: Array.isArray(tree.nodes) ? tree.nodes.length : 'N/A',
			nodes: tree.nodes
		});
		
		// Find the node for this concept in the tree
		const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
		console.log('[computeSubtreeStepGroups] All nodes:', nodes.map(n => ({
			conceptId: n?.conceptId,
			subtreeLessonIds: n?.subtreeLessonIds,
			subtreeLessonSteps: n?.subtreeLessonSteps
		})));
		
		const node = nodes.find(n => String(n.conceptId) === String(conceptId)) || null;
		console.log('[computeSubtreeStepGroups] Looking for conceptId:', conceptId);
		console.log('[computeSubtreeStepGroups] Node found:', node);
		console.log('[computeSubtreeStepGroups] Node subtreeLessonIds:', node?.subtreeLessonIds);
		console.log('[computeSubtreeStepGroups] Node subtreeLessonSteps:', node?.subtreeLessonSteps);
		
		// If no node or no lessons assigned, return empty
		if (!node || !Array.isArray(node.subtreeLessonIds) || node.subtreeLessonIds.length === 0) {
			console.log('[computeSubtreeStepGroups] No lessons assigned to this node');
			return { orderedSteps: [], byStep: new Map() };
		}
		
		// Load all public lessons from Supabase
		const { lessons: allLessons, error: lessonsError } = await listPublicLessons();
		console.log('[computeSubtreeStepGroups] All public lessons from Supabase:', allLessons?.length, lessonsError);
		
		if (lessonsError || !Array.isArray(allLessons)) {
			console.error('[computeSubtreeStepGroups] Failed to load lessons:', lessonsError);
			return { orderedSteps: [], byStep: new Map() };
		}
		
		// Create a map of lesson ID to lesson object
		const byId = new Map(allLessons.map(l => [l.id, l]));
		console.log('[computeSubtreeStepGroups] Lesson ID map size:', byId.size);
		
		// Get only the lessons that are in this node's subtreeLessonIds
		const mine = node.subtreeLessonIds.map(id => byId.get(id)).filter(Boolean);
		console.log('[computeSubtreeStepGroups] Matched lessons:', mine.length, 'out of', node.subtreeLessonIds.length, 'IDs');
		console.log('[computeSubtreeStepGroups] Lessons:', mine.map(l => ({ id: l.id, title: l.title, type: l.type })));
		
		// Get step assignments for lessons (defaults to step 1)
		const stepMap = (node.subtreeLessonSteps && typeof node.subtreeLessonSteps === 'object') ? node.subtreeLessonSteps : {};
		console.log('[computeSubtreeStepGroups] Step map:', stepMap);
		
		// Group lessons by step number and type
		const byStep = new Map();
		function bucketFor(step){
			const s = Number(step) || 1;
			if (!byStep.has(s)) byStep.set(s, { videos: [], quizzes: [], games: [], articles: [], other: [] });
			return byStep.get(s);
		}
		
		mine.forEach(l => {
			const stepNum = stepMap[l.id] || 1;
			const bucket = bucketFor(stepNum);
			const type = normalizeLessonType(l.type);
			console.log('[computeSubtreeStepGroups] Placing lesson', l.id, 'in step', stepNum, 'type', type);
			
			if (type === 'video') bucket.videos.push(l);
			else if (type === 'quiz') bucket.quizzes.push(l);
			else if (type === 'game') bucket.games.push(l);
			else if (type === 'article') bucket.articles.push(l);
			else bucket.other.push(l);
		});
		
		// Sort steps numerically
		const orderedSteps = Array.from(byStep.keys()).sort((a, b) => a - b);
		console.log('[computeSubtreeStepGroups] Ordered steps:', orderedSteps);
		console.log('[computeSubtreeStepGroups] Step contents:', Array.from(byStep.entries()).map(([step, buckets]) => [
			step,
			{
				videos: buckets.videos.length,
				quizzes: buckets.quizzes.length,
				games: buckets.games.length,
				articles: buckets.articles.length,
				other: buckets.other.length
			}
		]));
		
		return { orderedSteps, byStep };
	} catch (e) { 
		console.error('[computeSubtreeStepGroups] Error:', e);
		return { orderedSteps: [], byStep: new Map() }; 
	}
}