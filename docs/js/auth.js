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

function init() {
	if (usernameInput) usernameInput.focus();
	renderExistingUsers();
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

function renderExistingUsers() {
	const users = loadUsers();
	const usernames = Object.keys(users);
	if (!userListContainer) return;
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
