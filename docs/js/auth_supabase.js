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
const forgotLink = document.getElementById('supabase-forgot-link');
const forgotPanel = document.getElementById('supabase-forgot-panel');
const forgotEmailEl = document.getElementById('forgot-email');
const forgotSendBtn = document.getElementById('forgot-send');
const forgotBackLink = document.getElementById('forgot-back');
const forgotStatusEl = document.getElementById('forgot-status');

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
	if (forgotPanel) forgotPanel.style.display = 'none';
}

async function refreshSessionUI() {
	if (!window.supabaseClient || !window.supabaseClient.isConfigured()) {
		setStatus('Supabase not configured. Using demo mode only.');
		showLoggedOutUI();
		return;
	}
	const { data, error } = await window.supabaseClient.getSession();
	try {
		console.log('[AUTH] refreshSessionUI session', { hasSession: !!(data && data.session), user_id: data?.session?.user?.id || null });
	} catch {}
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
	// Forgot password: open panel
	if (forgotLink) {
		forgotLink.addEventListener('click', (e) => {
			e.preventDefault();
			if (formEl) formEl.style.display = 'none';
			if (forgotPanel) forgotPanel.style.display = 'block';
			if (forgotEmailEl && emailEl?.value) forgotEmailEl.value = emailEl.value;
			if (forgotStatusEl) forgotStatusEl.textContent = '';
		});
	}
	// Forgot password: back to login
	if (forgotBackLink) {
		forgotBackLink.addEventListener('click', (e) => {
			e.preventDefault();
			if (forgotPanel) forgotPanel.style.display = 'none';
			if (formEl) formEl.style.display = 'block';
			setMode('signin');
		});
	}
	// Forgot password: send reset link
	if (forgotSendBtn) {
		forgotSendBtn.addEventListener('click', async () => {
			const email = (forgotEmailEl?.value || '').trim();
			if (!email) { if (forgotStatusEl) forgotStatusEl.textContent = 'Please enter your email.'; return; }
			// Disable button briefly to avoid spam-clicking
			forgotSendBtn.disabled = true;
			try {
				// Compute redirectTo pointing to reset_password.html alongside auth.html.
				// Note: Ensure this exact URL is whitelisted in Supabase Auth → URL Configuration (prod + dev).
				// For GitHub Pages, update as needed to your repository path.
				const redirectTo = new URL('reset_password.html', window.location.href).toString();
				const { error } = await window.supabaseClient.resetPasswordForEmail(email, redirectTo);
				if (error) {
					if (forgotStatusEl) forgotStatusEl.textContent = `Request failed: ${error.message}`;
				} else {
					if (forgotStatusEl) forgotStatusEl.textContent = "If an account exists for that email, we've sent a password reset link.";
				}
			} catch (e) {
				if (forgotStatusEl) forgotStatusEl.textContent = 'Network error. Please try again.';
			} finally {
				setTimeout(() => { forgotSendBtn.disabled = false; }, 6000);
			}
		});
	}
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
				// Ensure session persisted, then redirect straight to home
				try {
					await window.supabaseClient.waitForSessionReady(3000, 150);
					const { data: s } = await window.supabaseClient.getSession();
					if (s?.session) { window.location.href = 'index.html'; return; }
				} catch {}
				// Fallback: refresh UI if session isn’t ready yet
				await refreshSessionUI();
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
				// If confirmation disabled and session is ready, redirect; else notify
				try {
					await window.supabaseClient.waitForSessionReady(3000, 150);
					const { data: s } = await window.supabaseClient.getSession();
					if (s?.session) { window.location.href = 'index.html'; return; }
				} catch {}
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
				// Log session BEFORE signOut
				try {
					const { data } = await window.supabaseClient.getSession();
					console.log('[AUTH] Logout click BEFORE signOut', { hasSession: !!(data && data.session), user_id: data?.session?.user?.id || null });
				} catch {}
				await window.supabaseClient.signOut();
				// Proactively clear current and legacy Supabase auth tokens to prevent session resurrection
				try {
					const { SUPABASE_STORAGE_KEY } = await import('./config.js');
					if (SUPABASE_STORAGE_KEY) {
						localStorage.removeItem(SUPABASE_STORAGE_KEY);
					}
					const keys = Object.keys(localStorage || {});
					keys.filter(k => k.startsWith('sb-') && k.includes('auth'))
						.forEach(k => localStorage.removeItem(k));
					// Set a flag indicating an explicit logout occurred to block migration
					localStorage.setItem('gls-auth-logged-out', '1');
				} catch {}
				// Log localStorage state AFTER logout token clearing
				try {
					const keysAfter = Object.keys(localStorage || {});
					const authKeysAfter = keysAfter.filter(k => k.includes('auth') || k.startsWith('sb-'));
					console.log('[AUTH] Logout AFTER clearing tokens', {
						keys: keysAfter,
						authKeys: authKeysAfter,
						glsAuth: (await import('./config.js')).SUPABASE_STORAGE_KEY ? localStorage.getItem((await import('./config.js')).SUPABASE_STORAGE_KEY) : null
					});
				} catch {}
				// Log session AFTER signOut
				try {
					const { data } = await window.supabaseClient.getSession();
					console.log('[AUTH] Logout AFTER signOut session', { hasSession: !!(data && data.session), user_id: data?.session?.user?.id || null });
				} catch {}
				await refreshSessionUI();
			} catch (e) {
				setStatus('Logout failed.');
			}
		});
	}
	if (enterBtn) {
		enterBtn.addEventListener('click', async () => {
			try { console.log('[DEBUG] Enter Live Site clicked: waiting for session then navigating'); } catch {}
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
	// Forgot password link only in Sign In mode; also close panel when switching away
	if (forgotLink) forgotLink.style.display = mode==='signin' ? 'inline-block' : 'none';
	if (mode==='signup' && forgotPanel) { forgotPanel.style.display = 'none'; if (formEl) formEl.style.display = 'block'; }
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

export function initAuthPage(){
	refreshSessionUI();
	bindEvents();
}
