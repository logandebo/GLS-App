// Supabase-backed persistence for live mode
// Minimal API: user_progress and creator_trees

function getClient() {
	const c = window.supabaseClient && window.supabaseClient._raw;
	return c || null;
}

async function getAuthUser() {
	const c = getClient();
	if (!c) return { user: null };
	const { data } = await c.auth.getSession();
	return { user: data && data.session ? data.session.user : null };
}

// user_progress
export async function loadUserProgress() {
	const c = getClient();
	if (!c) return { progress: null, error: null };
	const { user } = await getAuthUser();
	if (!user) return { progress: null, error: null };
	const { data, error } = await c
		.from('user_progress')
		.select('id, progress_json')
		.eq('owner_id', user.id)
		.limit(1)
		.maybeSingle();
	if (error) return { progress: null, error };
	return { progress: data ? data.progress_json || null : null, id: data ? data.id : null };
}

export async function saveUserProgress(progress) {
	const c = getClient();
	if (!c) return { ok: false, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { ok: false, error: new Error('No auth user') };
	// Check existing
	const { data: existing, error: selErr } = await c
		.from('user_progress')
		.select('id')
		.eq('owner_id', user.id)
		.limit(1);
	if (selErr) return { ok: false, error: selErr };
	if (existing && existing.length > 0) {
		const id = existing[0].id;
		const { error } = await c
			.from('user_progress')
			.update({ progress_json: progress, updated_at: new Date().toISOString() })
			.eq('id', id);
		return { ok: !error, error };
	} else {
		const { error } = await c
			.from('user_progress')
			.insert({ owner_id: user.id, progress_json: progress });
		return { ok: !error, error };
	}
}

// creator_trees
export async function fetchOwnCreatorTrees() {
	const c = getClient();
	if (!c) return { trees: [], error: null };
	const { user } = await getAuthUser();
	if (!user) return { trees: [], error: null };
	const { data, error } = await c
		.from('creator_trees')
		.select('id, title, tree_json, is_published, created_at')
		.eq('owner_id', user.id)
		.order('created_at', { ascending: false });
	return { trees: data || [], error };
}

export async function fetchPublishedCreatorTrees() {
	const c = getClient();
	if (!c) return { trees: [], error: null };
	const { data, error } = await c
		.from('creator_trees')
		.select('id, title, tree_json, is_published, created_at')
		.eq('is_published', true)
		.order('created_at', { ascending: false });
	return { trees: data || [], error };
}

export async function createCreatorTree(title, treeJson) {
	const c = getClient();
	if (!c) return { id: null, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { id: null, error: new Error('No auth user') };
	const { data, error } = await c
		.from('creator_trees')
		.insert({ owner_id: user.id, title: title || 'Untitled', tree_json: treeJson || {}, is_published: false })
		.select('id')
		.single();
	return { id: data ? data.id : null, error };
}

export async function updateCreatorTree(id, patch) {
	const c = getClient();
	if (!c) return { ok: false, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { ok: false, error: new Error('No auth user') };
	const { data, error } = await c
		.from('creator_trees')
		.update(patch || {})
		.eq('id', id)
		.eq('owner_id', user.id)
		.select('id, is_published')
		.maybeSingle();
	try {
		console.debug('[DELETE-DIAG] updateCreatorTree request', {
			table: 'creator_trees', method: 'UPDATE', id, owner_id: user.id, patch: patch || {}
		});
		if (error) console.warn('[DELETE-DIAG] updateCreatorTree error', error);
	} catch {}
	return { ok: !error && !!data, error, data };
}

export async function deleteCreatorTree(id) {
	const c = getClient();
	if (!c) return { ok: false, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { ok: false, error: new Error('No auth user') };
	const { data, error } = await c
		.from('creator_trees')
		.delete()
		.eq('id', id)
		.eq('owner_id', user.id)
		.select('id');
	const count = Array.isArray(data) ? data.length : 0;
	try {
		console.debug('[DELETE-DIAG] deleteCreatorTree request', {
			table: 'creator_trees', method: 'DELETE', id, owner_id: user.id, selected: 'id', deletedCount: count
		});
		if (error) console.error('[DELETE-DIAG] deleteCreatorTree error', error);
	} catch {}
	return { ok: !error && count > 0, error, count };
}

// Fallback helpers: operate by matching local tree id inside tree_json
export async function unpublishCreatorTreeByLocalId(localTreeId) {
	const c = getClient();
	if (!c) return { ok: false, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { ok: false, error: new Error('No auth user') };
	const { data, error } = await c
		.from('creator_trees')
		.update({ is_published: false })
		.eq('owner_id', user.id)
		.contains('tree_json', { id: localTreeId })
		.select('id')
		.limit(1);
	const count = Array.isArray(data) ? data.length : 0;
	return { ok: !error && count > 0, error, count };
}

export async function deleteCreatorTreeByLocalId(localTreeId) {
	const c = getClient();
	if (!c) return { ok: false, error: new Error('Supabase not configured') };
	const { user } = await getAuthUser();
	if (!user) return { ok: false, error: new Error('No auth user') };
	const { data, error } = await c
		.from('creator_trees')
		.delete()
		.eq('owner_id', user.id)
		.contains('tree_json', { id: localTreeId })
		.select('id');
	const count = Array.isArray(data) ? data.length : 0;
	try {
		console.debug('[DELETE-DIAG] deleteCreatorTreeByLocalId request', {
			table: 'creator_trees', method: 'DELETE', owner_id: user.id, filter_contains_tree_json_id: localTreeId, selected: 'id', deletedCount: count
		});
		if (error) console.error('[DELETE-DIAG] deleteCreatorTreeByLocalId error', error);
	} catch {}
	return { ok: !error && count > 0, error, count };
}

export async function setCreatorTreePublished(id, isPublished) {
	return updateCreatorTree(id, { is_published: !!isPublished });
}
