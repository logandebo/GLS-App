// Multi-user storage helpers (Iteration 4 Step 1)
// Tabs for indentation, vanilla ES module.

export const USERS_KEY = 'gep_users';
export const ACTIVE_USER_KEY = 'gep_activeUser';

export function loadUsers() {
	const raw = localStorage.getItem(USERS_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export function saveUsers(usersObj) {
	localStorage.setItem(USERS_KEY, JSON.stringify(usersObj));
}

export function getActiveUsername() {
	const raw = localStorage.getItem(ACTIVE_USER_KEY);
	if (!raw) return null;
	return raw; // stored as plain string for now
}

export function setActiveUsername(username) {
	localStorage.setItem(ACTIVE_USER_KEY, username);
}

export function getActiveProfile() {
	const users = loadUsers();
	const username = getActiveUsername();
	if (!username) return null;
	return users[username] || null;
}

export function saveActiveProfile(profile) {
	const users = loadUsers();
	const username = profile?.username || getActiveUsername();
	if (!username) return;
	const profileWithUsername = { ...profile, username };
	users[username] = profileWithUsername;
	saveUsers(users);
	setActiveUsername(username);
}

export function createDefaultProfile(username) {
	const profile = {
		username,
		xp: 0,
		conceptProgress: {},
		lastLessonId: null,
		streak: { currentDays: 0, lastActiveDate: null },
		xpEvents: []
	};
	saveActiveProfile(profile);
	return profile;
}

// Migration helper (Iteration 4 Step 2)
export function migrateLegacyProfileIfNeeded() {
	const users = loadUsers();
	const hasUsers = Object.keys(users).length > 0;
	if (hasUsers) {
		if (!getActiveUsername()) {
			const firstUsername = Object.keys(users)[0];
			if (firstUsername) setActiveUsername(firstUsername);
		}
		return;
	}

	let legacyProfile = null;
	const legacyNew = localStorage.getItem('userProfile');
	const legacyOld = localStorage.getItem('gep_profile');

	if (legacyNew) {
		try { legacyProfile = JSON.parse(legacyNew); } catch {}
	} else if (legacyOld) {
		try { legacyProfile = JSON.parse(legacyOld); } catch {}
	}

	if (!legacyProfile) return;

	let username = legacyProfile.username;
	if (!username || typeof username !== 'string') username = 'player1';

	const profileWithUsername = { ...legacyProfile, username };
	const newUsers = { [username]: profileWithUsername };
	saveUsers(newUsers);
	setActiveUsername(username);

	localStorage.removeItem('userProfile');
	localStorage.removeItem('gep_profile');
}

// Auth guard: ensure an active user or redirect to auth.html
export function ensureActiveUserOrRedirect() {
	// Guest mode permitted in new flow; do not auto-redirect.
	// Callers should use authStore.requireAuth() in page entrypoints.
	return getActiveUsername();
}
