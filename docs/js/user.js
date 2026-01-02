import { getActiveProfile, saveActiveProfile, createDefaultProfile } from './storage.js';

// Legacy wrapper retained for compatibility with existing code.
export function loadUserProfile() {
	return getActiveProfile();
}

export function saveUserProfile(profile) {
	saveActiveProfile(profile);
}

export function getOrCreateDefaultProfile() {
	let p = loadUserProfile();
	if (!p) {
		p = createDefaultProfile('player1');
	}
	// ensure fields exist on older profiles (non-breaking additive)
	let mutated = false;
	if (!p || typeof p !== 'object') {
		p = createDefaultProfile('player1');
		mutated = false; // already saved inside createDefaultProfile
	}
	if (!p.hasOwnProperty('conceptProgress') || typeof p.conceptProgress !== 'object' || p.conceptProgress === null) {
		p.conceptProgress = {};
		mutated = true;
	}
	if (!p.hasOwnProperty('streak') || typeof p.streak !== 'object' || p.streak === null) {
		p.streak = { currentDays: 0, lastActiveDate: null };
		mutated = true;
	} else {
		if (typeof p.streak.currentDays !== 'number') { p.streak.currentDays = 0; mutated = true; }
		if (!p.streak.hasOwnProperty('lastActiveDate')) { p.streak.lastActiveDate = null; mutated = true; }
	}
	if (!p.hasOwnProperty('lastLessonId')) { p.lastLessonId = null; mutated = true; }
	if (!Array.isArray(p.xpEvents)) { p.xpEvents = []; mutated = true; }
	if (typeof p.username !== 'string') { p.username = 'player1'; mutated = true; }
	if (mutated) saveUserProfile(p);
	updateDailyStreak(p);
	return p;
}

function updateDailyStreak(profile) {
	const today = new Date().toISOString().slice(0,10);
	const last = profile.streak.lastActiveDate;
	if (last === today) return;
	if (!last) {
		profile.streak.currentDays = 1;
	} else {
		const lastDate = new Date(last);
		const diffMs = new Date(today) - lastDate;
		const diffDays = diffMs / (1000*60*60*24);
		if (diffDays <= 1.5) {
			profile.streak.currentDays += 1;
		} else {
			profile.streak.currentDays = 1;
		}
	}
	profile.streak.lastActiveDate = today;
	saveUserProfile(profile);
}

export function addXp(profile, amount) {
	// Deprecated in Iteration 2: XP is derived from completed lessons.
	console.warn('addXp is deprecated. Use computeTotalXpFromCompletedLessons instead.');
	return profile.xp;
}

export function markLessonCompleted(profile, lesson, concept) {
	const cp = profile.conceptProgress[concept.id] || {
		masteryLevel: 'Unrated',
		skillScore: 0,
		lastUpdated: new Date().toISOString().slice(0,10),
		completedLessonIds: []
	};
	if (!cp.completedLessonIds.includes(lesson.id)) {
		cp.completedLessonIds.push(lesson.id);
		cp.lastUpdated = new Date().toISOString().slice(0,10);
		profile.conceptProgress[concept.id] = cp;
		profile.lastLessonId = lesson.id;
		logXpEvent(profile, {
			type: 'lesson_completed',
			lessonId: lesson.id,
			conceptId: concept.id,
			xpReward: lesson.xpReward
		});
		saveUserProfile(profile);
	}
}

export function recordLessonAccess(profile, lessonId) {
	profile.lastLessonId = lessonId;
	saveUserProfile(profile);
}

function updateConceptMasteryInternal(cp) {
	const s = cp.skillScore;
	cp.masteryLevel = s >= 300 ? 'Gold' : s >= 180 ? 'Silver' : s >= 80 ? 'Bronze' : 'Unrated';
}

export function updateConceptMastery(profile, conceptId, newScore) {
	const cp = profile.conceptProgress[conceptId];
	if (!cp) return;
	cp.skillScore = newScore;
	updateConceptMasteryInternal(cp);
	cp.lastUpdated = new Date().toISOString().slice(0,10);
	saveUserProfile(profile);
}

// Iteration 2: Mastery refactor based on estimatedMinutes
export function recomputeConceptProgress(profile, concept, conceptLessons) {
	if (!profile || !concept) return;
	const cp = profile.conceptProgress[concept.id] || {
		masteryLevel: 'Unrated',
		skillScore: 0,
		lastUpdated: null,
		completedLessonIds: []
	};
	const completed = new Set(cp.completedLessonIds || []);
	const totalForMastery = Math.max(1, Number(concept.estimatedMinutesToBasicMastery) || 30);
	let minutesCompleted = 0;
	(conceptLessons || []).forEach(l => {
		if (!l) return;
		if (l.conceptId !== concept.id) return;
		if (completed.has(l.id)) {
			minutesCompleted += Number(l.estimatedMinutes) || 0;
		}
	});
	const ratio = Math.max(0, Math.min(1, minutesCompleted / totalForMastery));
	const score = Math.round(ratio * 100);
	cp.skillScore = score;
	cp.masteryLevel = ratio >= 1 ? 'Gold' : ratio >= 0.6 ? 'Silver' : ratio >= 0.3 ? 'Bronze' : 'Unrated';
	cp.lastUpdated = new Date().toISOString().slice(0,10);
	profile.conceptProgress[concept.id] = cp;
	saveUserProfile(profile);
}

export function recomputeAllConceptProgress(profile, concepts, lessonsById) {
	if (!profile || !Array.isArray(concepts)) return;
	const byId = lessonsById || {};
	concepts.forEach(concept => {
		let conceptLessons = [];
		if (Array.isArray(concept.lessonIds) && concept.lessonIds.length) {
			conceptLessons = concept.lessonIds.map(id => byId[id]).filter(Boolean);
		} else {
			// fallback: scan all lessons and match by conceptId
			conceptLessons = Object.values(byId).filter(l => l && l.conceptId === concept.id);
		}
		recomputeConceptProgress(profile, concept, conceptLessons);
	});
}

export function renderProfilePage() {
	const profile = getOrCreateDefaultProfile();
	const summary = document.getElementById('profileSummary');
	if (summary) {
		summary.innerHTML = `<div class="profile-box">\n\t<h2>${profile.username}</h2>\n\t<p>Total XP: <strong>${profile.xp}</strong></p>\n\t<p>Streak: ${profile.streak.currentDays} day(s)</p>\n</div>`;
	}
	const masteryGrid = document.getElementById('masteryGrid');
	if (!masteryGrid) return;
	masteryGrid.innerHTML = '';
	Object.entries(profile.conceptProgress).forEach(([cid, prog]) => {
		const card = document.createElement('div');
		card.className = 'card mastery-card';
		card.innerHTML = `<h3>${cid}</h3>\n\t<p>Mastery: ${prog.masteryLevel}</p>\n\t<p>Score: ${prog.skillScore}</p>\n\t<p>Lessons: ${prog.completedLessonIds.length}</p>`;
		masteryGrid.appendChild(card);
	});
}

// Iteration 2: XP integrity refactor
export function computeTotalXpFromCompletedLessons(profile, lessonsById) {
	let total = 0;
	const seen = new Set();
	Object.values(profile.conceptProgress).forEach(cp => {
		(cp.completedLessonIds || []).forEach(id => {
			if (seen.has(id)) return;
			const l = lessonsById[id];
			if (l && typeof l.xpReward === 'number') {
				total += l.xpReward;
				seen.add(id);
			}
		});
	});
	profile.xp = total;
	saveUserProfile(profile);
	return total;
}

// Iteration 2: Analytics xpEvents hook
export function logXpEvent(profile, event) {
	if (!profile) return;
	if (!Array.isArray(profile.xpEvents)) profile.xpEvents = [];
	const data = {
		...event,
		ts: new Date().toISOString()
	};
	profile.xpEvents.push(data);
	if (profile.xpEvents.length > 200) {
		profile.xpEvents = profile.xpEvents.slice(-200);
	}
	saveUserProfile(profile);
	return data;
}