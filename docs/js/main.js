import { loadGraph, getConceptById } from './graph.js'; // legacy fallback (transition)
import { loadGraphStore, getAllNodes as gsGetAllNodes, getNode as gsGetNode, getNeighbors as gsGetNeighbors } from './graphStore.js';
import { loadLessons, getLessonsForConcept, getLessonById, getAllLessons, buildLessonMap, getLessonMap } from './lessons.js';
import { getOrCreateDefaultProfile, recordLessonAccess, computeTotalXpFromCompletedLessons, recomputeAllConceptProgress } from './user.js';
import { createConceptCard, createLessonCard, renderToast, showToast } from './ui.js';
import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
import { initGraphView, updateGraphSelection, applySearchFilter as applyGraphSearchFilter, setUserEdges as gvSetUserEdges, setShowUserEdges as gvSetShowUserEdges } from './graphView.js';
import { loadUserEdges, recomputeUserEdges } from './userEdges.js';
import { loadUserPreferences } from './preferences.js';
import { loadPlaylists, createPlaylist, addLesson as addLessonToPlaylist, getProgress as getPlaylistProgress, getTotalMinutes as getPlaylistMinutes, reorderLessons as reorderPlaylistLessons, importPlaylistData, exportPlaylistData } from './playlists.js';
import { getConceptMastery } from './conceptProgress.js';

let _activeProfile = null;
let _searchTerm = '';
let _playlistModal = null, _plSelect = null, _plCreateToggle = null, _plCreateFields = null, _plNewTitle = null, _plNewDesc = null, _plErr = null, _plCancel = null, _plAdd = null;
let _selectedLessonForPlaylist = null;
let _userEdges = [];


function initHeader() {
	const usernameEl = document.getElementById('header-username');
	const switchBtn = document.getElementById('header-switch-user');
	const username = getActiveUsername();
	if (usernameEl && username) usernameEl.textContent = `Logged in as: ${username}`;
	if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
}

(async function init() {
	migrateLegacyProfileIfNeeded();
	const active = ensureActiveUserOrRedirect();
	if (!active) return; // redirecting
	let profile = getActiveProfile();
	if (!profile) {
		profile = createDefaultProfile(active);
		saveActiveProfile(profile);
	}
	const loadingState = document.getElementById('loading-state');
	try {
		// Load Master Graph via GraphStore (migration) and legacy graph for compatibility
		await loadGraphStore();
		await loadGraph();
		await loadLessons();
		const profile = getOrCreateDefaultProfile();
		_activeProfile = profile;
		buildLessonMap(getAllLessons());
		computeTotalXpFromCompletedLessons(profile, getLessonMap());
		recomputeAllConceptProgress(profile, gsGetAllNodes(), getLessonMap());
		initXpBadge(profile);
		setupProfileButton();
		initHeader();
		setupGlobalSearch();
		setupNavPlaylistsButton();
		setupPlaylistModal();
		renderPlaylists(profile);
		setupNewPlaylistButton();
		setupImportPlaylists();
		initGraph(profile);
		setupContinueLast(profile);
		renderContinue(profile);
		renderRecommendations(profile);
		renderFeaturedPlaylists(profile);
		renderConceptList(profile);
		renderConceptMap(profile);
		attachViewToggle();
		setupUserEdgesToggle();
		setupRefreshRecs(profile);
		setupPreferencesListener(profile);
		// Optional flag set by profile page to refresh recs immediately when returning
		try {
			const pending = localStorage.getItem('gep_recompute_recs');
			if (pending === '1') {
				renderRecommendations(profile);
				renderToast('Recommendations updated for your focus', 'info');
				localStorage.removeItem('gep_recompute_recs');
			}
		} catch {}
		renderToast('Welcome back, ' + profile.username, 'info');
	} catch (e) {
		console.error('Failed to initialize home page', e);
		renderToast('Failed to load data. Please try again.', 'error');
	} finally {
		if (loadingState) loadingState.classList.add('hidden');
	}
})();


function setActiveConcept(conceptId) {
	// Prefer GraphStore node, fallback to legacy
	const concept = gsGetNode(conceptId) || getConceptById(conceptId);
	if (concept) {
		populateLessonPreview(concept);
		updateGraphSelection(conceptId);
	}
}

function populateLessonPreview(concept) {
	const previewTitle = document.getElementById('lesson-preview-title');
	const previewContent = document.getElementById('lesson-preview-content');
	if (!previewTitle || !previewContent) return;
	previewTitle.textContent = concept.title + ' Lessons';
	previewContent.innerHTML = '';
	const lessons = getLessonsForConcept(concept.id);
	// Build a set of lessonIds that are in any playlist for badge rendering
	const userId = getActiveUsername();
	const playlists = loadPlaylists(userId);
	const inAnyPlaylist = new Set();
	playlists.forEach(pl => (pl.lessonIds || []).forEach(id => inAnyPlaylist.add(id)));
	if (!lessons.length) {
		const none = document.createElement('div');
		none.textContent = 'No lessons yet.';
		previewContent.appendChild(none);
	} else {
		lessons.forEach(l => {
			const card = createLessonCard(l, concept, { profile: _activeProfile, inPlaylist: inAnyPlaylist.has(l.id), onClick: (lesson) => {
				recordLessonAccess(getOrCreateDefaultProfile(), lesson.id);
				window.location.href = `lesson.html?lessonId=${lesson.id}`;
			}, onAddToPlaylist: (lesson) => openPlaylistModal(lesson.id) });
			previewContent.appendChild(card);
		});
	}
	document.querySelectorAll('.concept-card.active-concept-card').forEach(el => el.classList.remove('active-concept-card'));
	document.querySelectorAll('.concept-bubble.active').forEach(el => el.classList.remove('active'));
	const cardMatch = Array.from(document.querySelectorAll('.concept-card')).find(c => c.querySelector('h3') && c.querySelector('h3').textContent === concept.title);
	if (cardMatch) cardMatch.classList.add('active-concept-card');
	const bubbleMatch = Array.from(document.querySelectorAll('.concept-bubble')).find(b => b.dataset.conceptId === concept.id);
	if (bubbleMatch) bubbleMatch.classList.add('active');
}


function renderConceptList(profile) {
	const grid = document.getElementById('concept-list-view');
	if (!grid) return;
	// Use GraphStore nodes
	const concepts = gsGetAllNodes();
	grid.innerHTML = '';
	const userId = getActiveUsername();
	concepts.forEach(c => {
		const mastery = getConceptMastery(userId, c.id);
		const card = createConceptCard(c, { masteryTier: mastery?.tier, showOpenConcept: true, onClick: concept => setActiveConcept(concept.id) });
		grid.appendChild(card);
	});
	applySearchToList();
}

function renderRecommendations(profile) {
	const rg = document.getElementById('recommended-content');
	if (!rg) return;
	const concepts = gsGetAllNodes();
	const userId = getActiveUsername();
	const prefs = loadUserPreferences(userId);
	const focus = new Set((prefs && prefs.focusTags) || []);
	const uEdges = loadUserEdges(userId);
	let relatedSet = new Set();
	let edgeWeights = new Map();
	if (profile.lastLessonId) {
		const lastLesson = getLessonById(profile.lastLessonId);
		if (lastLesson && lastLesson.conceptId) {
			// GraphStore neighbors (relatedTo/buildsOn/partOf + child reverse)
			(gsGetNeighbors(lastLesson.conceptId) || []).forEach(n => relatedSet.add(n.id));
			// user-derived edges influence
			uEdges.filter(e => e.sourceConceptId === lastLesson.conceptId).forEach(e => {
				relatedSet.add(e.targetConceptId);
				edgeWeights.set(e.targetConceptId, (edgeWeights.get(e.targetConceptId) || 0) + (Number(e.weight) || 1));
			});
		}
	}
	const scored = concepts.map(c => {
		const cp = profile.conceptProgress[c.id];
		let score = 0;
		const difficulty = Number(c.difficulty) || 1;
		if (!cp || (cp.completedLessonIds || []).length === 0) score += 100;
		else if ((cp.skillScore || 0) < 60) score += 60;
		else if ((cp.skillScore || 0) >= 100) score -= 120;
		if (relatedSet.has(c.id)) score += 30;
		// bump based on user edges weight towards this concept
		const w = edgeWeights.get(c.id) || 0;
		if (w) score += Math.min(60, 15 * w);
		score -= difficulty * 5;
		const est = Number(c.estimatedMinutesToBasicMastery) || 30;
		score -= Math.min(10, Math.floor(est / 10));
		// boost by focus tags / subject
		let focusMatch = false;
		if (focus.size) {
			const matchesSubject = c.subject && focus.has(String(c.subject));
			const matchesTag = Array.isArray(c.tags) && c.tags.some(t => focus.has(String(t)));
			if (matchesSubject) score += 12; // strong nudge
			if (matchesTag) score += 8;  // moderate nudge
			focusMatch = !!(matchesSubject || matchesTag);
		}
		return { concept: c, score, focusMatch };
	});
	const top = scored.sort((a,b) => b.score - a.score).slice(0,3);
	rg.innerHTML = '';
		if (top.length === 0) {
			document.getElementById('recommended-empty')?.classList.remove('hidden');
		} else {
			document.getElementById('recommended-empty')?.classList.add('hidden');
			const userId = getActiveUsername();
			top.forEach(item => {
				const c = item.concept;
				const mastery = getConceptMastery(userId, c.id);
				const card = createConceptCard(c, { masteryTier: mastery?.tier, showOpenConcept: true, focusMatched: item.focusMatch, onClick: concept => setActiveConcept(concept.id) });
				rg.appendChild(card);
			});
		}
}

function setupProfileButton() {
	const btn = document.getElementById('profileBtn');
	if (btn) {
		btn.addEventListener('click', () => { window.location.href = 'profile.html'; });
		return;
	}
	// Fallback: support anchor-based profile link
	const link = document.getElementById('profileLink');
	if (link) {
		// No handler needed for anchors, but ensure prevents default if needed
		// Link already points to profile.html
	}
}

function renderContinue(profile) {
	const cont = document.getElementById('continue-content');
	if (!cont) return;
	cont.innerHTML = '';
	const empty = document.getElementById('continue-empty');
	if (!profile.lastLessonId) {
		if (empty) empty.classList.remove('hidden');
		const startBtn = document.getElementById('empty-start-button');
		if (startBtn) startBtn.onclick = () => setActiveConcept('music.c_major_scale');
		return;
	}
	if (empty) empty.classList.add('hidden');
	const lesson = getLessonById(profile.lastLessonId);
	if (!lesson) return;
	const concept = getConceptById(lesson.conceptId);
	if (!concept) return;
	// badge: in playlist
	const userId = getActiveUsername();
	const playlists = loadPlaylists(userId);
	const inAnyPlaylist = new Set();
	playlists.forEach(pl => (pl.lessonIds || []).forEach(id => inAnyPlaylist.add(id)));
	const card = createLessonCard(lesson, concept, { profile, inPlaylist: inAnyPlaylist.has(lesson.id), onClick: (l) => {
		recordLessonAccess(profile, l.id);
		window.location.href = `lesson.html?lessonId=${l.id}`;
	}, onAddToPlaylist: (l) => openPlaylistModal(l.id) });
	cont.appendChild(card);
}

function setupContinueLast(profile) {
	const btn = document.getElementById('continueLastBtn');
	if (!btn) return;
	if (profile.lastLessonId) {
		const lesson = getLessonById(profile.lastLessonId);
		if (lesson) {
			btn.classList.remove('hidden');
			btn.addEventListener('click', () => {
				window.location.href = `lesson.html?lessonId=${lesson.id}`;
			});
		}
	}
}

function setupRefreshRecs(profile) {
	const btn = document.getElementById('refreshRecsBtn');
	if (!btn) return;
	btn.addEventListener('click', () => {
		renderRecommendations(profile);
		renderToast('Recommendations updated', 'info');
	});
}

function setupPreferencesListener(profile) {
	window.addEventListener('storage', (e) => {
		try {
			const userId = getActiveUsername();
			if (!userId) return;
			if (e && e.key === `gep_userPreferences_${userId}`) {
				renderRecommendations(profile);
				renderToast('Recommendations updated for your focus', 'info');
			}
		} catch {}
	});
}

function renderConceptMap(profile) {
	const container = document.getElementById('concept-map-view');
	if (!container) return;
	container.innerHTML = '';
	const concepts = gsGetAllNodes();
	const userId = getActiveUsername();
	concepts.forEach(concept => {
		const bubble = document.createElement('button');
		bubble.type = 'button';
		bubble.className = 'concept-bubble';
		bubble.dataset.conceptId = concept.id;
		const mastery = getConceptMastery(userId, concept.id);
		const level = mastery?.tier || 'Unrated';
		const levelClass = level.toLowerCase();
		const dotClass = levelClass === 'bronze' ? 'mastery-bronze' : levelClass === 'silver' ? 'mastery-silver' : levelClass === 'gold' ? 'mastery-gold' : 'mastery-unrated';
		bubble.innerHTML = `<span class="mastery-dot ${dotClass}"></span><span class="concept-bubble-title">${concept.title}</span><span class="concept-bubble-subject">${concept.subject}</span>`;
		bubble.addEventListener('click', () => setActiveConcept(concept.id));
		bubble.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveConcept(concept.id); } });
		container.appendChild(bubble);
	});
	applySearchToMap();
}

function attachViewToggle() {
	const buttons = document.querySelectorAll('#view-toggle .view-toggle-button');
	const listView = document.getElementById('concept-list-view');
	const mapView = document.getElementById('concept-map-view');
	const graphView = document.getElementById('concept-graph-view');
	buttons.forEach(btn => {
		btn.addEventListener('click', () => {
			buttons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			const view = btn.dataset.view;
			if (view === 'map') {
				listView.classList.add('hidden');
				graphView.classList.add('hidden');
				mapView.classList.remove('hidden');
			} else if (view === 'graph') {
				listView.classList.add('hidden');
				mapView.classList.add('hidden');
				graphView.classList.remove('hidden');
			} else {
				graphView.classList.add('hidden');
				mapView.classList.add('hidden');
				listView.classList.remove('hidden');
			}
			// reapply search filter when switching views
			applySearchToList();
			applySearchToMap();
			applyGraphSearchFilter(_searchTerm);
		});
	});
}

function initXpBadge(profile) {
	const badge = document.getElementById('xpBadge');
	if (badge) badge.textContent = profile.xp + ' XP';
}

// lesson map provided by lessons.js

function initGraph(profile) {
	const container = document.getElementById('concept-graph-view');
	if (!container) return;
	const concepts = gsGetAllNodes();
	function getMasteryForConcept(conceptId) {
		const userId = getActiveUsername();
		const m = getConceptMastery(userId, conceptId);
		const tier = (m?.tier || 'Unrated');
		const xp = profile.xp || 0;
		return { tier, xp };
	}
	function onSelect(conceptId) { setActiveConcept(conceptId); }
	initGraphView(container, concepts, getMasteryForConcept, onSelect);
	applyGraphSearchFilter(_searchTerm);
	// initialize user edges overlay
	const userId = getActiveUsername();
	_userEdges = loadUserEdges(userId);
	gvSetUserEdges(_userEdges);
}
function setupUserEdgesToggle() {
	const toggle = document.getElementById('toggleUserEdges');
	if (!toggle) return;
	toggle.addEventListener('change', () => {
		gvSetShowUserEdges(!!toggle.checked);
	});
}

function setupGlobalSearch() {
	const input = document.getElementById('globalSearchInput');
	if (!input) return;
	input.addEventListener('input', () => {
		_searchTerm = (input.value || '').trim().toLowerCase();
		applySearchToList();
		applySearchToMap();
		applyGraphSearchFilter(_searchTerm);
	});
}

function matchesConcept(c) {
	const t = _searchTerm;
	if (!t) return true;
	const name = (c.title || c.id || '').toLowerCase();
	const subject = (c.subject || c.primaryDomain || '').toLowerCase();
	const tags = Array.isArray(c.tags) ? c.tags.join(' ').toLowerCase() : '';
	return name.includes(t) || subject.includes(t) || tags.includes(t);
}

function applySearchToList() {
	const list = document.getElementById('concept-list-view');
	if (!list) return;
	const all = Array.from(list.querySelectorAll('.concept-card'));
	const concepts = gsGetAllNodes();
	const byId = new Map(concepts.map(c => [c.id, c]));
	all.forEach(card => {
		const id = card.getAttribute('data-concept-id');
		const concept = byId.get(id);
		if (!concept) return;
		if (!_searchTerm || matchesConcept(concept)) card.classList.remove('dimmed'); else card.classList.add('dimmed');
	});
}

function applySearchToMap() {
	const map = document.getElementById('concept-map-view');
	if (!map) return;
	const all = Array.from(map.querySelectorAll('.concept-bubble'));
	const concepts = gsGetAllNodes();
	const byId = new Map(concepts.map(c => [c.id, c]));
	all.forEach(bubble => {
		const id = bubble.getAttribute('data-concept-id');
		const concept = byId.get(id);
		if (!concept) return;
		if (!_searchTerm || matchesConcept(concept)) bubble.classList.remove('dimmed'); else bubble.classList.add('dimmed');
	});
}

function setupPlaylistModal() {
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

	_plCreateToggle.addEventListener('click', () => {
		_plCreateFields.classList.toggle('hidden');
	});
	_plCancel.addEventListener('click', () => closePlaylistModal());
	_plAdd.addEventListener('click', () => confirmAddToPlaylist());
}

function openPlaylistModal(lessonId) {
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
		// No lists yet; suggest creating
		const opt = document.createElement('option');
		opt.value = '';
		opt.textContent = 'No playlists yet';
		_plSelect.appendChild(opt);
		_plCreateFields.classList.remove('hidden');
	} else {
		lists.forEach(p => {
			const opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.title || p.id;
			_plSelect.appendChild(opt);
		});
	}
	_playlistModal.classList.remove('hidden');
}

function closePlaylistModal() {
	if (_playlistModal) _playlistModal.classList.add('hidden');
	_selectedLessonForPlaylist = null;
}

function confirmAddToPlaylist() {
	const userId = getActiveUsername();
	if (!userId) { showToast('No active user', 'error'); return; }
	const creating = !_plCreateFields.classList.contains('hidden');
	let playlistId = _plSelect.value;
	if (creating) {
		const title = (_plNewTitle.value || '').trim();
		const description = (_plNewDesc.value || '').trim();
		if (!title) { _plErr.textContent = 'Title is required to create a playlist.'; return; }
		const pl = createPlaylist(userId, { title, description, isPublic: false });
		playlistId = pl.id;
	}
	if (!playlistId) { _plErr.textContent = 'Select a playlist or create one.'; return; }
	if (_selectedLessonForPlaylist) {
		addLessonToPlaylist(userId, playlistId, _selectedLessonForPlaylist);
		showToast('Added to playlist', 'success');
	} else {
		showToast('Playlist created', 'success');
	}
	renderPlaylists(_activeProfile);
	// recompute user edges after any playlist change
	const lists = loadPlaylists(userId);
	_userEdges = recomputeUserEdges(userId, lists, (id) => getLessonById(id));
	gvSetUserEdges(_userEdges);
	closePlaylistModal();
}

function openCreatePlaylistModal() {
	if (!_playlistModal) return;
	_selectedLessonForPlaylist = null;
	_plErr.textContent = '';
	_plNewTitle.value = '';
	_plNewDesc.value = '';
	_plCreateFields.classList.remove('hidden');
	_plSelect.innerHTML = '';
	const opt = document.createElement('option');
	opt.value = '';
	opt.textContent = 'Create a new playlist';
	_plSelect.appendChild(opt);
	_playlistModal.classList.remove('hidden');
}

function renderPlaylists(profile) {
	const container = document.getElementById('playlists-content');
	const empty = document.getElementById('playlists-empty');
	if (!container) return;
	const userId = getActiveUsername();
	const lists = loadPlaylists(userId);
	container.innerHTML = '';
	if (!lists.length) {
		if (empty) empty.classList.remove('hidden');
		return;
	}
	if (empty) empty.classList.add('hidden');
	lists.forEach(pl => {
		const card = document.createElement('div');
		card.className = 'card playlist-card';

		const header = document.createElement('div');
		header.className = 'playlist-card__header';
		const h = document.createElement('h3');
		h.className = 'playlist-card__title';
		h.textContent = pl.title || 'Untitled Playlist';
		const meta = document.createElement('div');
		meta.className = 'playlist-card__meta';
		const { completed, total } = getPlaylistProgress(pl, profile);
		const mins = getPlaylistMinutes(pl, (id) => getLessonById(id));
		const progressChip = document.createElement('span');
		progressChip.className = 'chip';
		progressChip.textContent = `${completed} / ${total}`;
		const minutesChip = document.createElement('span');
		minutesChip.className = 'chip chip--minutes';
		minutesChip.textContent = `${mins} min`;
		const exportBtn = document.createElement('button');
		exportBtn.type = 'button';
		exportBtn.className = 'btn subtle';
		exportBtn.textContent = 'Export';
		exportBtn.title = 'Download playlist as JSON';
		exportBtn.addEventListener('click', () => {
			try {
				const data = exportPlaylistData(pl);
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
				const a = document.createElement('a');
				const url = URL.createObjectURL(blob);
				a.href = url;
				const safeTitle = (pl.title || 'playlist').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
				a.download = `playlist_${safeTitle}.json`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
			} catch (e) {
				renderToast('Failed to export playlist', 'error');
			}
		});
		const continueBtn = document.createElement('button');
		continueBtn.type = 'button';
		continueBtn.className = 'btn secondary';
		continueBtn.textContent = 'Continue';
		const nextIdx = (pl.lessonIds || []).findIndex(id => {
			const les = getLessonById(id);
			if (!les) return true;
			const comp = new Set((profile?.conceptProgress?.[les.conceptId]?.completedLessonIds) || []);
			return !comp.has(id);
		});
		if (nextIdx === -1) {
			continueBtn.disabled = true;
			continueBtn.textContent = 'Completed';
		} else {
			continueBtn.addEventListener('click', () => {
				const nid = pl.lessonIds[nextIdx];
				const les = getLessonById(nid);
				if (!les) return;
				recordLessonAccess(getOrCreateDefaultProfile(), nid);
				window.location.href = `lesson.html?lessonId=${nid}`;
			});
		}
		meta.appendChild(progressChip);
		meta.appendChild(minutesChip);
		meta.appendChild(continueBtn);
		meta.appendChild(exportBtn);
		header.appendChild(h);
		header.appendChild(meta);
		card.appendChild(header);

		if (pl.description) {
			const p = document.createElement('p');
			p.className = 'short';
			p.textContent = pl.description;
			card.appendChild(p);
		}

		const list = document.createElement('div');
		list.className = 'playlist-lessons';
		(pl.lessonIds || []).forEach((lessonId, idx) => {
			const lesson = getLessonById(lessonId);
			if (!lesson) return;
			const row = document.createElement('div');
			row.className = 'playlist-lesson';
			const left = document.createElement('div');
			const title = document.createElement('div');
			title.className = 'playlist-lesson__title';
			title.textContent = `${idx + 1}. ${lesson.title}`;
			left.appendChild(title);
			const right = document.createElement('div');
			const completedSet = new Set((profile?.conceptProgress?.[lesson.conceptId]?.completedLessonIds) || []);
			const status = document.createElement('span');
			status.className = 'playlist-lesson__status';
			status.textContent = completedSet.has(lesson.id) ? 'Completed' : 'Pending';
			// Reorder controls
			const upBtn = document.createElement('button');
			upBtn.type = 'button';
			upBtn.className = 'btn subtle';
			upBtn.title = 'Move up';
			upBtn.textContent = '↑';
			upBtn.disabled = idx === 0;
			upBtn.addEventListener('click', () => {
				const userId = getActiveUsername();
				reorderPlaylistLessons(userId, pl.id, idx, idx - 1);
				renderPlaylists(profile);
				// recompute user edges after reorder
				const lists = loadPlaylists(userId);
				_userEdges = recomputeUserEdges(userId, lists, (id) => getLessonById(id));
				gvSetUserEdges(_userEdges);
			});
			const downBtn = document.createElement('button');
			downBtn.type = 'button';
			downBtn.className = 'btn subtle';
			downBtn.title = 'Move down';
			downBtn.textContent = '↓';
			downBtn.disabled = idx === (pl.lessonIds.length - 1);
			downBtn.addEventListener('click', () => {
				const userId = getActiveUsername();
				reorderPlaylistLessons(userId, pl.id, idx, idx + 1);
				renderPlaylists(profile);
				// recompute user edges after reorder
				const lists = loadPlaylists(userId);
				_userEdges = recomputeUserEdges(userId, lists, (id) => getLessonById(id));
				gvSetUserEdges(_userEdges);
			});
			const openBtn = document.createElement('button');
			openBtn.type = 'button';
			openBtn.className = 'btn secondary';
			openBtn.textContent = 'Open';
			openBtn.addEventListener('click', () => {
				recordLessonAccess(getOrCreateDefaultProfile(), lesson.id);
				window.location.href = `lesson.html?lessonId=${lesson.id}`;
			});
			right.appendChild(status);
			right.appendChild(upBtn);
			right.appendChild(downBtn);
			right.appendChild(openBtn);
			row.appendChild(left);
			row.appendChild(right);
			list.appendChild(row);
		});
		if (!pl.lessonIds || pl.lessonIds.length === 0) {
			const emptyRow = document.createElement('div');
			emptyRow.className = 'empty-state';
			emptyRow.textContent = 'No lessons in this playlist yet.';
			card.appendChild(emptyRow);
		}
		card.appendChild(list);
		container.appendChild(card);
	});
}

function setupNewPlaylistButton() {
	const btn = document.getElementById('newPlaylistBtn');
	if (!btn) return;
	btn.addEventListener('click', () => openCreatePlaylistModal());
}

function setupNavPlaylistsButton() {
	const btn = document.getElementById('navPlaylistsBtn');
	if (!btn) return;
	const section = document.getElementById('playlists-section');
	btn.addEventListener('click', () => {
		if (section && typeof section.scrollIntoView === 'function') {
			section.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	});
}

function renderFeaturedPlaylists(profile) {
	const container = document.getElementById('featured-playlists-content');
	const empty = document.getElementById('featured-empty');
	const userId = getActiveUsername();
	if (!container) return;
	container.innerHTML = '';

	// Build a couple of dynamic featured playlists based on available lessons
	const allLessons = getAllLessons();
	const concepts = gsGetAllNodes();

	// Featured 1: Getting Started (first 5 lessons by title)
	const startLessons = allLessons.slice().sort((a,b) => (a.title||'').localeCompare(b.title||'')).slice(0,5);

	// Featured 2: First Steps Across Concepts (first uncompleted from first 5 concepts)
	const firstSteps = [];
	concepts.slice(0, 5).forEach(c => {
		const lessons = getLessonsForConcept(c.id) || [];
		const completed = new Set((profile?.conceptProgress?.[c.id]?.completedLessonIds) || []);
		const pick = lessons.find(l => !completed.has(l.id)) || lessons[0];
		if (pick) firstSteps.push(pick);
	});

	const featured = [
		{ title: 'Getting Started', description: 'A quick intro set to warm up.', lessons: startLessons },
		{ title: 'First Steps Across Concepts', description: 'Sample one lesson from several concepts.', lessons: firstSteps }
	].filter(f => (f.lessons || []).length > 0);

	if (!featured.length) {
		if (empty) empty.classList.remove('hidden');
		return;
	}
	if (empty) empty.classList.add('hidden');

	featured.forEach(f => {
		const card = document.createElement('div');
		card.className = 'card playlist-card';
		const header = document.createElement('div');
		header.className = 'playlist-card__header';
		const h = document.createElement('h3');
		h.className = 'playlist-card__title';
		h.textContent = f.title;
		const meta = document.createElement('div');
		meta.className = 'playlist-card__meta';
		const countChip = document.createElement('span');
		countChip.className = 'chip';
		countChip.textContent = `${f.lessons.length} lessons`;
		meta.appendChild(countChip);
		header.appendChild(h);
		header.appendChild(meta);
		card.appendChild(header);
		if (f.description) {
			const p = document.createElement('p');
			p.className = 'short';
			p.textContent = f.description;
			card.appendChild(p);
		}
		const addBtn = document.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'btn';
		addBtn.textContent = 'Add to My Playlists';
		addBtn.addEventListener('click', () => {
			const pl = createPlaylist(userId, { title: f.title, description: f.description, isPublic: false });
			(f.lessons || []).forEach(l => addLessonToPlaylist(userId, pl.id, l.id));
			renderToast('Playlist added to your library', 'success');
			renderPlaylists(profile);
		});
		card.appendChild(addBtn);
		container.appendChild(card);
	});

	// Continue Playlist widget: show next lesson of the first playlist with pending lessons
	try {
		const lists = loadPlaylists(userId) || [];
		const widget = document.getElementById('continuePlaylistWidget');
		if (widget) {
			let found = null;
			for (const pl of lists) {
				const nextIdx = (pl.lessonIds || []).findIndex(id => {
					const les = getLessonById(id);
					if (!les) return true;
					const comp = new Set((profile?.conceptProgress?.[les.conceptId]?.completedLessonIds) || []);
					return !comp.has(id);
				});
				if (nextIdx !== -1) { found = { pl, idx: nextIdx }; break; }
			}
			if (found) {
				const { pl, idx } = found;
				const nextId = pl.lessonIds[idx];
				const les = getLessonById(nextId);
				widget.style.display = '';
				widget.textContent = `Continue: ${pl.title} → ${les ? les.title : 'Next'}`;
				widget.classList.add('interactive');
				widget.addEventListener('click', () => {
					if (!les) return;
					recordLessonAccess(getOrCreateDefaultProfile(), nextId);
					window.location.href = `lesson.html?lessonId=${nextId}`;
				}, { once: true });
			} else {
				widget.style.display = 'none';
			}
		}
	} catch {}
}

function setupImportPlaylists() {
	const btn = document.getElementById('importPlaylistBtn');
	const fileIn = document.getElementById('importPlaylistInput');
	if (!btn || !fileIn) return;
	btn.addEventListener('click', () => fileIn.click());
	fileIn.addEventListener('change', async () => {
		const file = fileIn.files && fileIn.files[0];
		if (!file) return;
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			const userId = getActiveUsername();
			const created = importPlaylistData(userId, data, (id) => !!getLessonById(id));
			renderToast(`Imported: ${created.title || 'Playlist'}`, 'success');
			renderPlaylists(_activeProfile);
			// recompute user edges after import
			const lists = loadPlaylists(userId);
			_userEdges = recomputeUserEdges(userId, lists, (id) => getLessonById(id));
			gvSetUserEdges(_userEdges);
		} catch (e) {
			console.error('Import failed', e);
			renderToast(e && e.message ? `Import failed: ${e.message}` : 'Import failed', 'error');
		} finally {
			fileIn.value = '';
		}
	});
}