// Supabase auth wiring for auth.html (PagesPublish)

const statusEl = document.getElementById('supabase-status');
const formEl = document.getElementById('supabase-form');
const emailEl = document.getElementById('supabase-email');
const passwordEl = document.getElementById('supabase-password');
const signinBtn = document.getElementById('supabase-signin');
const signupBtn = document.getElementById('supabase-signup');
const logoutContainer = document.getElementById('supabase-logout-container');
const logoutBtn = document.getElementById('supabase-logout');

function setStatus(text) {
	if (statusEl) statusEl.textContent = text || '';
}

function showLoggedInUI() {
	if (logoutContainer) logoutContainer.style.display = 'block';
	if (formEl) formEl.style.display = 'none';
}

function showLoggedOutUI() {
	if (logoutContainer) logoutContainer.style.display = 'none';
	if (formEl) formEl.style.display = 'block';
}

async function refreshSessionUI() {
	if (!window.supabaseClient || !window.supabaseClient.isConfigured()) {
		setStatus('Supabase not configured. Using demo mode only.');
		showLoggedOutUI();
		return;
	}
	const { data, error } = await window.supabaseClient.getSession();
	if (error) {
		setStatus('Error fetching session.');
		showLoggedOutUI();
		return;
	}
	const session = data?.session || null;
	if (session) {
		setStatus(`Signed in as ${session.user?.email || 'unknown user'}`);
		showLoggedInUI();
	} else {
		setStatus('Not signed in. Enter email and password.');
		showLoggedOutUI();
	}
}

function bindEvents() {
	if (signinBtn) {
		signinBtn.addEventListener('click', async () => {
			try {
				const email = emailEl?.value?.trim();
				const password = passwordEl?.value || '';
				if (!email || !password) return;
				const { data, error } = await window.supabaseClient.signInWithEmail(email, password);
				if (error) {
					setStatus(`Sign-in failed: ${error.message}`);
					return;
				}
				await refreshSessionUI();
				window.location.href = 'index.html';
			} catch (e) {
				setStatus('Sign-in failed. Check credentials.');
			}
		});
	}
	if (signupBtn) {
		signupBtn.addEventListener('click', async () => {
			try {
				const email = emailEl?.value?.trim();
				const password = passwordEl?.value || '';
				if (!email || !password) return;
				const { data, error } = await window.supabaseClient.signUpWithEmail(email, password);
				if (error) {
					setStatus(`Sign-up failed: ${error.message}`);
					return;
				}
				await refreshSessionUI();
				setStatus('Sign-up initiated. Check email if confirmation enabled.');
			} catch (e) {
				setStatus('Sign-up failed.');
			}
		});
	}
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async () => {
			try {
				await window.supabaseClient.signOut();
				await refreshSessionUI();
			} catch (e) {
				setStatus('Logout failed.');
			}
		});
	}
	if (window.supabaseClient) {
		window.supabaseClient.onAuthStateChange(() => {
			refreshSessionUI();
		});
	}
}

refreshSessionUI();
bindEvents();
