import {
	loadUsers,
	setActiveUsername,
	createDefaultProfile,
	getActiveProfile,
	saveActiveProfile
} from './storage.js';

const form = document.getElementById('auth-form');
const usernameInput = document.getElementById('auth-username');
const userListContainer = document.getElementById('auth-user-list');

init();

async function init() {
	if (usernameInput) usernameInput.focus();
	await renderExistingUsers();
	setupFormHandler();
}

function setupFormHandler() {
	if (!form) return;
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const raw = usernameInput.value.trim();
		if (!raw) return;
		const username = raw.toLowerCase();
		const users = loadUsers();
		if (!users[username]) {
			const profile = createDefaultProfile(username);
			saveActiveProfile(profile);
		} else {
			setActiveUsername(username);
		}
		window.location.href = 'index.html';
	});
}

async function renderExistingUsers() {
	const users = loadUsers();
	let usernames = Object.keys(users);
	if (!userListContainer) return;

	// If a live session exists, exclude that username from demo list
	try {
		const sb = window.supabaseClient;
		if (sb && sb.isConfigured && sb.isConfigured()) {
			const { data } = await sb.getSession();
			const user = data && data.session ? data.session.user : null;
			if (user) {
				const meta = user.user_metadata || {};
				const liveName = [meta.full_name, meta.preferred_username, meta.username, meta.name]
					.find(v => typeof v === 'string' && v.trim()) || (user.email || '').split('@')[0] || null;
				if (liveName) usernames = usernames.filter(u => u !== liveName);
			}
		}
	} catch {}

	if (!usernames.length) {
		userListContainer.innerHTML = '';
		return;
	}
	const list = document.createElement('ul');
	list.className = 'auth-user-list__items';
	usernames.forEach(u => {
		const li = document.createElement('li');
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = u;
		button.addEventListener('click', () => {
			setActiveUsername(u);
			window.location.href = 'index.html';
		});
		li.appendChild(button);
		list.appendChild(li);
	});
	userListContainer.innerHTML = '';
	userListContainer.appendChild(list);
}
