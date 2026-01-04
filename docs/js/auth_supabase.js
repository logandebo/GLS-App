// Supabase auth wiring for auth.html (PagesPublish)

const statusEl = document.getElementById('supabase-status');
const formEl = document.getElementById('supabase-form');
const tabSignin = document.getElementById('live-tab-signin');
const tabSignup = document.getElementById('live-tab-signup');
const usernameRow = document.getElementById('supabase-username-row');
const usernameEl = document.getElementById('supabase-username');
const emailRow = document.getElementById('supabase-email-row');
const emailEl = document.getElementById('supabase-email');
const confirmEmailRow = document.getElementById('supabase-email-confirm-row');
const confirmEmailEl = document.getElementById('supabase-email-confirm');
const passwordEl = document.getElementById('supabase-password');
const confirmRow = document.getElementById('supabase-password-confirm-row');
const confirmEl = document.getElementById('supabase-password-confirm');
const signinBtn = document.getElementById('supabase-signin');
const signupBtn = document.getElementById('supabase-signup');
const logoutContainer = document.getElementById('supabase-logout-container');
const logoutBtn = document.getElementById('supabase-logout');
const enterBtn = document.getElementById('supabase-enter');

function setStatus(text) {
	if (statusEl) statusEl.textContent = text || '';
}

function showLoggedInUI() {
	if (logoutContainer) logoutContainer.style.display = 'block';
	if (formEl) formEl.style.display = 'none';
	if (tabSignin) tabSignin.style.display = 'none';
	if (tabSignup) tabSignup.style.display = 'none';
}

function showLoggedOutUI() {
	if (logoutContainer) logoutContainer.style.display = 'none';
	if (formEl) formEl.style.display = 'block';
	if (tabSignin) tabSignin.style.display = 'inline-block';
	if (tabSignup) tabSignup.style.display = 'inline-block';
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
				// Allow user to choose when to enter; also show Enter Live Site button
				if (enterBtn) enterBtn.focus();
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
				const username = usernameEl?.value?.trim();
				const confirmPwd = confirmEl?.value || '';
                const confirmEmail = confirmEmailEl?.value?.trim() || '';
				if (!email || !password) { setStatus('Email and password are required.'); return; }
				if (!username) { setStatus('Username is required for sign-up.'); return; }
				if (confirmEmailRow && confirmEmailEl && email !== confirmEmail) { setStatus('Emails do not match.'); return; }
				if (confirmRow && confirmEl && password !== confirmPwd) { setStatus('Passwords do not match.'); return; }
				const metadata = { username, name: username, full_name: username, preferred_username: username };
				const { data, error } = await window.supabaseClient.signUpWithEmail(email, password, metadata);
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
	if (enterBtn) {
		enterBtn.addEventListener('click', async () => {
			try {
				// Ensure the session was persisted before navigating
				if (window.supabaseClient && window.supabaseClient.isConfigured()) {
					await window.supabaseClient.waitForSessionReady(2000, 150);
				}
			} catch {}
			window.location.href = 'index.html';
		});
	}

// Tabs: Sign In vs Sign Up
let mode = 'signin';
function setMode(next){
	mode = next === 'signup' ? 'signup' : 'signin';
	if (tabSignin) tabSignin.classList.toggle('active', mode==='signin');
	if (tabSignup) tabSignup.classList.toggle('active', mode==='signup');
	if (signinBtn) signinBtn.style.display = mode==='signin' ? 'inline-block' : 'none';
	if (signupBtn) signupBtn.style.display = mode==='signup' ? 'inline-block' : 'none';
	if (confirmRow) confirmRow.style.display = mode==='signup' ? 'flex' : 'none';
	if (confirmEmailRow) confirmEmailRow.style.display = mode==='signup' ? 'flex' : 'none';
	// Username only for sign-up (to store display name)
	if (usernameRow) usernameRow.style.display = mode==='signup' ? 'flex' : 'none';
	// Email visible in both modes
	if (emailRow) emailRow.style.display = 'flex';
	if (usernameEl) {
		if (mode==='signup') { usernameEl.setAttribute('required',''); usernameEl.setAttribute('minlength','3'); }
		else { usernameEl.removeAttribute('required'); usernameEl.removeAttribute('minlength'); }
	}
	if (confirmEl) {
		if (mode==='signup') confirmEl.setAttribute('required',''); else confirmEl.removeAttribute('required');
	}
	if (confirmEmailEl) {
		if (mode==='signup') confirmEmailEl.setAttribute('required',''); else confirmEmailEl.removeAttribute('required');
	}
	setStatus(mode==='signin' ? 'Enter email and password to sign in.' : 'Create your account with username, email, and password.');
}

if (tabSignin) tabSignin.addEventListener('click', () => setMode('signin'));
if (tabSignup) tabSignup.addEventListener('click', () => setMode('signup'));
// Initialize tab based on URL hash (#signup to open sign-up)
const initial = (location.hash||'').toLowerCase().includes('signup') ? 'signup' : 'signin';
setMode(initial);
	if (window.supabaseClient) {
		window.supabaseClient.onAuthStateChange(() => {
			refreshSessionUI();
		});
	}
}

refreshSessionUI();
bindEvents();
