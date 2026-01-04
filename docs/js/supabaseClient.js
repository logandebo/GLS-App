// Shared Supabase client and helpers (PagesPublish)

const hasConfig = Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);

let client = null;
if (hasConfig && window.supabase && typeof window.supabase.createClient === 'function') {
	try {
		client = window.supabase.createClient(
			window.SUPABASE_URL,
			window.SUPABASE_ANON_KEY,
			{
				auth: {
					persistSession: true,
					autoRefreshToken: true,
					// Use a stable storage key so session persists across pages consistently
					storageKey: 'gls-auth'
				}
			}
		);
		// One-time migration: if legacy 'sb-*auth-token' exists but 'gls-auth' is missing, copy it
		try {
			const keys = Object.keys(localStorage || {});
			const legacyKey = keys.find(k => k.startsWith('sb-') && k.includes('auth-token')) || null;
			const currentKey = 'gls-auth';
			if (legacyKey && !localStorage.getItem(currentKey)) {
				const val = localStorage.getItem(legacyKey);
				if (val) {
					localStorage.setItem(currentKey, val);
					console.log('[DEBUG] Migrated legacy Supabase session from', legacyKey, 'to', currentKey);
				}
			}
		} catch {}
	} catch (e) {
		console.warn('[Supabase] createClient failed', e);
	}
}

function isConfigured() {
	return Boolean(client);
}

async function getSession() {
	if (!client) return { data: { session: null }, error: null };
	return client.auth.getSession();
}

function onAuthStateChange(callback) {
	if (!client) return () => {};
	const { data: sub } = client.auth.onAuthStateChange((_event, session) => callback(session));
	return () => sub.subscription.unsubscribe();
}

// Wait for session hydration after navigation. Polls until a session is available
// or a timeout is reached. Returns true if a session was found, false otherwise.
async function waitForSessionReady(maxMs = 2000, intervalMs = 150) {
	try {
		if (!client) return false;
		const start = Date.now();
		try { console.log(`[DEBUG] waitForSessionReady start maxMs=${maxMs} intervalMs=${intervalMs}`); } catch {}
		while (Date.now() - start < maxMs) {
			const { data } = await client.auth.getSession();
			if (data && data.session) return true;
			await new Promise((r) => setTimeout(r, intervalMs));
		}
		try { console.log('[DEBUG] waitForSessionReady timeout without session'); } catch {}
		return false;
	} catch {
		return false;
	}
}

async function signInWithEmail(email, password) {
	if (!client) throw new Error('Supabase not configured');
	return client.auth.signInWithPassword({ email, password });
}

async function signUpWithEmail(email, password, data) {
	if (!client) throw new Error('Supabase not configured');
	return client.auth.signUp({ email, password, options: { data: data || {} } });
}

async function signOut() {
	if (!client) return;
	await client.auth.signOut();
}

window.supabaseClient = {
	isConfigured,
	getSession,
	onAuthStateChange,
	signInWithEmail,
	signUpWithEmail,
	signOut,
	waitForSessionReady,
	_raw: client
};
