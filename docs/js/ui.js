import { getActiveUsername } from './storage.js';
import { addGoal as storeAddGoal } from './goalsStore.js';
import { createKebabMenuButton } from './menus.js';

function difficultyIcons(d) {
	const capped = Math.min(Math.max(d || 1, 1), 5);
	let icons = '';
	for (let i = 0; i < capped; i++) icons += '★';
	for (let i = capped; i < 5; i++) icons += '☆';
	return `<span class="difficulty-icons" aria-label="Difficulty ${capped} of 5">${icons}</span>`;
}

	function thumbnailImg(src, alt) {
		const safe = src || 'assets/img/c_major.png';
		return `<img src="${safe}" alt="${alt}" class="thumb" />`;
	}

export function createConceptCard(concept, options = {}) {
	const el = document.createElement('div');
	el.className = 'card concept-card';
	el.dataset.conceptId = concept.id;
	el.tabIndex = 0;
	el.setAttribute('role', 'button');
	el.setAttribute('aria-label', `Explore ${concept.title} lessons`);
	const masteryMins = concept.estimatedMinutesToBasicMastery ? `${concept.estimatedMinutesToBasicMastery} min` : '—';
	// Thumbnail fallback order: concept.thumbnail -> default
	const thumbSrc = concept.thumbnail || 'assets/img/thumb_default.png';
	const img = document.createElement('img');
	img.className = 'card-thumbnail';
	img.alt = concept.title + ' thumbnail';
	img.src = thumbSrc;
	img.onerror = () => { img.src = 'assets/img/thumb_default.png'; };
	el.appendChild(img);
	// Header with optional mastery badge
	const title = document.createElement('h3');
	title.textContent = concept.title;
	el.appendChild(title);
	if (options.masteryTier) {
		const tier = String(options.masteryTier || 'Unrated');
		const badge = document.createElement('span');
		badge.className = `badge badge--mastery badge--${tier.toLowerCase()}`;
		badge.textContent = tier;
		el.appendChild(badge);
	}
	const desc = document.createElement('p');
	desc.className = 'short';
	desc.textContent = concept.shortDescription || '';
	el.appendChild(desc);
	const metaDiv = document.createElement('div');
	metaDiv.className = 'meta';
	metaDiv.innerHTML = `Difficulty: ${difficultyIcons(concept.difficulty)} • Mastery ~ ${masteryMins}`;
	el.appendChild(metaDiv);

	// Optional focus chip for recommendations
	if (options.focusMatched) {
		const focusChip = document.createElement('span');
		focusChip.className = 'chip chip--focus';
		focusChip.textContent = 'Focused';
		metaDiv.appendChild(focusChip);
	}

	// Optional actions row (Open Concept)
	if (options.showOpenConcept) {
		const actions = document.createElement('div');
		actions.className = 'actions';
		const openBtn = document.createElement('button');
		openBtn.type = 'button';
		openBtn.className = 'btn secondary';
		openBtn.textContent = 'Open Concept';
		openBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			window.location.href = `concept.html?conceptId=${encodeURIComponent(concept.id)}`;
		});
		actions.appendChild(openBtn);
		el.appendChild(actions);
	}
	if (concept.isCustom) {
		const badge = document.createElement('span');
		badge.className = 'badge badge--custom';
		badge.textContent = 'Creator';
		el.appendChild(badge);
	}
	if (options.onClick) {
		el.addEventListener('click', () => options.onClick(concept));
		el.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				options.onClick(concept);
			}
		});
	}
	return el;
}

export function createLessonCard(lesson, concept, options = {}) {
	const el = document.createElement('article');
	el.className = 'lesson-card card';
	el.tabIndex = 0;
	el.setAttribute('role', 'button');
	el.setAttribute('aria-label', `Open lesson ${lesson.title} in ${concept.title}`);
	el.dataset.lessonId = lesson.id;
	const thumbSrc = (lesson.media && (lesson.media.thumbnail || lesson.media.thumb)) || concept.thumbnail || 'assets/img/thumb_default.png';
	const minutes = typeof lesson.minutes === 'number' ? lesson.minutes : (lesson.estimatedMinutes || lesson.estimatedMinutesToComplete || null);
	const time = minutes ? `${minutes} min` : '—';
	const rawType = (lesson.type || lesson.contentType || 'core').toString();
	const typeLabel = rawType.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
	const diff = lesson.difficulty;
	const diffLabel = typeof diff === 'string' ? diff[0].toUpperCase() + diff.slice(1) : (Number(diff) <= 1 ? 'Beginner' : Number(diff) <= 2 ? 'Intermediate' : 'Advanced');
	const xp = lesson.xpReward || lesson.xp || null;

	const thumbWrap = document.createElement('div');
	thumbWrap.className = 'lesson-card__thumb';
	const img = document.createElement('img');
	img.alt = lesson.title + ' thumbnail';
	img.src = thumbSrc;
	img.onerror = () => { img.src = 'assets/img/thumb_default.png'; };
	thumbWrap.appendChild(img);

	const body = document.createElement('div');
	body.className = 'lesson-card__body';

	const header = document.createElement('header');
	header.className = 'lesson-card__header';
	const titleEl = document.createElement('h4');
	titleEl.className = 'lesson-card__title';
	titleEl.textContent = lesson.title;
	header.appendChild(titleEl);
	if (lesson.isCustom) {
		const badge = document.createElement('span');
		badge.className = 'badge badge--custom';
		badge.textContent = 'Creator';
		header.appendChild(badge);
	}
	if (options.inPlaylist) {
		const pBadge = document.createElement('span');
		pBadge.className = 'badge badge--playlist';
		pBadge.textContent = 'In Playlist';
		header.appendChild(pBadge);
	}

	// 3-dot menu
	const menuItems = [
		{ label: 'Add to Playlist', onClick: () => { if (typeof options.onAddToPlaylist === 'function') options.onAddToPlaylist(lesson, concept); } },
		{ label: 'Set as Goal', onClick: () => {
			const userId = getActiveUsername();
			storeAddGoal(userId, concept.id);
			renderToast('Added to Goals', 'success');
		} }
	];
	const { button: kebabBtn } = createKebabMenuButton(menuItems);
	header.appendChild(kebabBtn);

	const meta = document.createElement('div');
	meta.className = 'lesson-card__meta';
	meta.innerHTML = `
		<span class="chip chip--type" title="Lesson type">${typeLabel}</span>
		<span class="chip chip--minutes" title="Estimated time">${time}</span>
		<span class="chip chip--difficulty" title="Difficulty">${diffLabel}</span>
		${xp !== null ? `<span class="chip chip--xp" title="XP reward">${xp} XP</span>` : ''}
	`;

	const progress = document.createElement('div');
	progress.className = 'lesson-card__progress';
	const status = document.createElement('span');
	const prof = options.profile;
	let statusClass = 'status--not-started';
	let statusText = 'Not Started';
	if (prof && prof.conceptProgress && prof.conceptProgress[concept.id]) {
		const completed = new Set(prof.conceptProgress[concept.id].completedLessonIds || []);
		if (completed.has(lesson.id)) {
			statusClass = 'status--completed';
			statusText = 'Completed';
		} else if (prof.lastLessonId === lesson.id) {
			statusClass = 'status--in-progress';
			statusText = 'In Progress';
		}
	}
	status.className = `status ${statusClass}`;
	status.textContent = statusText;
	progress.appendChild(status);

	body.appendChild(header);
	if (lesson.summary) {
		const p = document.createElement('p');
		p.className = 'short';
		p.textContent = lesson.summary;
		body.appendChild(p);
	}
	body.appendChild(meta);
	body.appendChild(progress);



	el.appendChild(thumbWrap);
	el.appendChild(body);

	if (options.onClick) {
		el.addEventListener('click', () => options.onClick(lesson, concept));
		el.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				options.onClick(lesson, concept);
			}
		});
	}
	return el;
}

export function renderToast(message, type = 'info') {
	const container = document.getElementById('toast-container') || document.getElementById('toastContainer');
	if (!container) return;
	const t = document.createElement('div');
	t.className = `toast toast-${type}`;
	t.textContent = message;
	container.appendChild(t);
	setTimeout(() => {
		t.classList.add('fade');
		setTimeout(() => t.remove(), 400);
	}, 2500);
}

// Backwards-compatible alias expected by creator.js (was showToast before refactor)
export function showToast(message, type = 'info') {
	renderToast(message, type);
}