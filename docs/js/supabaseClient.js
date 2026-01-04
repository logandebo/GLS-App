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
	_raw: client
};
