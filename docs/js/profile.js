// Switch to Master Graph GraphStore for concept data
import { loadGraphStore, getAllNodes as gsGetAllNodes } from './graphStore.js';
import { loadLessons, getAllLessons, buildLessonMap, getLessonMap, getLessonById } from './lessons.js';
import { getOrCreateDefaultProfile, computeTotalXpFromCompletedLessons, recomputeAllConceptProgress } from './user.js';
import { renderToast } from './ui.js';
import { renderProfilePage } from './user.js';
import { migrateLegacyProfileIfNeeded, ensureActiveUserOrRedirect, getActiveProfile, createDefaultProfile, saveActiveProfile, getActiveUsername } from './storage.js';
import { loadUserProgress as loadUserProgressSupabase, saveUserProgress as saveUserProgressSupabase } from './supabaseStore.js';
import { loadUserPreferences, saveUserPreferences, setFocusTags } from './preferences.js';
import { loadPlaylists, updatePlaylistMeta, deletePlaylist, duplicatePlaylist, getProgress as getPlaylistProgress, getTotalMinutes as getPlaylistMinutes, importPlaylistData, exportPlaylistData } from './playlists.js';


(function initHeader() {
	const usernameEl = document.getElementById('header-username');
	const switchBtn = document.getElementById('header-switch-user');
	async function setHeader() {
		let label = null;
		try {
			if (window.supabaseClient && window.supabaseClient.isConfigured()) {
				const { data } = await window.supabaseClient.getSession();
				const user = data && data.session ? data.session.user : null;
				if (user) {
					const meta = (user.user_metadata || {});
					const liveName = [meta.full_name, meta.preferred_username, meta.username, meta.name]
						.find(v => typeof v === 'string' && v.trim()) || (user.email || '').split('@')[0] || 'user';
					label = `Logged in as: ${liveName} (Live)`;
				}
			}
		} catch {}
		if (!label) {
			const username = getActiveUsername();
			if (username) label = `Logged in as: ${username} (Demo)`;
		}
		if (usernameEl && label) usernameEl.textContent = label;
	}
	setHeader();
	if (window.supabaseClient) {
		try { window.supabaseClient.onAuthStateChange(() => setHeader()); } catch {}
	}
	if (switchBtn) switchBtn.addEventListener('click', () => { window.location.href = 'auth.html'; });
})();

(async function initProfile() {
	migrateLegacyProfileIfNeeded();
	const active = ensureActiveUserOrRedirect();
	if (!active) return;
	let profile = getActiveProfile();
	if (!profile) {
		profile = createDefaultProfile(active);
		saveActiveProfile(profile);
	}
	const summary = document.getElementById('profileSummary');
	const masteryGrid = document.getElementById('masteryGrid');
	if (summary) summary.textContent = 'Loading profile…';
	if (masteryGrid) masteryGrid.textContent = 'Loading…';
	try {
		// If Supabase session exists and cloud progress is available, prefer it
		if (window.supabaseClient && window.supabaseClient.isConfigured()) {
			const { data: sess } = await window.supabaseClient.getSession();
			if (sess && sess.session && sess.session.user) {
				const { progress } = await loadUserProgressSupabase();
				if (progress && typeof progress === 'object') {
					// Replace local profile with cloud copy
					saveActiveProfile(progress);
				}
			}
		}
		await loadGraphStore();
		await loadLessons();
		buildLessonMap(getAllLessons());
		const profile = getOrCreateDefaultProfile();
		// If live user, align local profile username to live username
		if (window.supabaseClient && window.supabaseClient.isConfigured()) {
			const { data: sess } = await window.supabaseClient.getSession();
			const user = sess && sess.session ? sess.session.user : null;
			if (user) {
				const meta = (user.user_metadata || {});
				const liveName = [meta.full_name, meta.preferred_username, meta.username, meta.name]
					.find(v => typeof v === 'string' && v.trim()) || (user.email || '').split('@')[0] || profile.username;
				if (typeof liveName === 'string' && liveName && liveName !== profile.username) {
					profile.username = liveName;
					saveActiveProfile(profile);
				}
			}
		}
		computeTotalXpFromCompletedLessons(profile, getLessonMap());
		recomputeAllConceptProgress(profile, gsGetAllNodes(), getLessonMap());
		renderProfilePage();
		setupFocusUI();
		renderMyPlaylists();
		setupImportPlaylists();
		// After recompute, save to Supabase if signed in
		if (window.supabaseClient && window.supabaseClient.isConfigured()) {
			const { data: sess } = await window.supabaseClient.getSession();
			if (sess && sess.session && sess.session.user) {
				await saveUserProgressSupabase(getOrCreateDefaultProfile());
			}
		}
	} catch (e) {
		console.error('Failed to init profile page', e);
		if (summary) summary.textContent = 'Error loading profile data.';
		if (masteryGrid) masteryGrid.textContent = '';
		renderToast('Failed to load profile. Please try again.', 'error');
	}
})();

// lesson map provided by lessons.js

function setupFocusUI(){
	const userId = getActiveUsername();
	const prefs = loadUserPreferences(userId);
	const chipsEl = document.getElementById('focusChips');
	const inputEl = document.getElementById('focusInput');
	const saveBtn = document.getElementById('focusSaveBtn');
	const clearBtn = document.getElementById('focusClearBtn');
	if (!chipsEl || !saveBtn || !clearBtn) return;

	// Suggest tags from concept subjects and tags
	const concepts = gsGetAllNodes();
	const suggestions = new Set();
	concepts.forEach(c => {
		if (c.subject) suggestions.add(String(c.subject));
		if (Array.isArray(c.tags)) c.tags.forEach(t => suggestions.add(String(t)));
	});
	const current = new Set(prefs.focusTags || []);

	chipsEl.innerHTML = '';
	Array.from(suggestions).sort().slice(0, 40).forEach(tag => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'chip';
		if (current.has(tag)) btn.classList.add('chip--selected');
		btn.textContent = tag;
		btn.addEventListener('click', () => {
			if (current.has(tag)) current.delete(tag); else current.add(tag);
			btn.classList.toggle('chip--selected');
		});
		chipsEl.appendChild(btn);
	});
	inputEl.value = (prefs.focusTags || []).filter(t => !suggestions.has(t)).join(', ');

	saveBtn.addEventListener('click', () => {
		const extra = (inputEl.value || '').split(',').map(s => s.trim()).filter(Boolean);
		extra.forEach(t => current.add(t));
		setFocusTags(userId, Array.from(current));
		try { localStorage.setItem('gep_recompute_recs', '1'); } catch {}
		renderToast('Focus saved', 'success');
	});
	clearBtn.addEventListener('click', () => {
		setFocusTags(userId, []);
		setupFocusUI();
		renderToast('Focus cleared', 'info');
	});
}

function renderMyPlaylists(){
	const userId = getActiveUsername();
	const listEl = document.getElementById('myPlaylistsList');
	const emptyEl = document.getElementById('myPlaylistsEmpty');
	if (!listEl) return;
	const lists = loadPlaylists(userId);
	listEl.innerHTML = '';
	if (!lists.length) {
		if (emptyEl) emptyEl.classList.remove('hidden');
		return;
	}
	if (emptyEl) emptyEl.classList.add('hidden');
	const profile = getOrCreateDefaultProfile();
	lists.forEach(pl => {
		const row = document.createElement('div');
		row.className = 'row';
		const left = document.createElement('div');
		const titleEl = document.createElement('strong');
		titleEl.textContent = pl.title || 'Untitled Playlist';
		const meta = document.createElement('span');
		meta.className = 'chip';
		const { completed, total } = getPlaylistProgress(pl, profile);
		const mins = getPlaylistMinutes(pl, (id) => getLessonById(id));
		meta.textContent = `${completed}/${total} • ${mins} min`;
		left.appendChild(titleEl);
		left.appendChild(document.createTextNode(' '));
		left.appendChild(meta);
		const right = document.createElement('div');
		// Edit
		const editBtn = document.createElement('button');
		editBtn.type = 'button';
		editBtn.className = 'btn secondary';
		editBtn.textContent = 'Edit';
		editBtn.addEventListener('click', () => openEdit(pl));
		// Duplicate
		const dupBtn = document.createElement('button');
		dupBtn.type = 'button';
		dupBtn.className = 'btn secondary';
		dupBtn.textContent = 'Duplicate';
		dupBtn.addEventListener('click', () => {
			const copy = duplicatePlaylist(userId, pl.id);
			if (copy) { renderToast('Playlist duplicated', 'success'); renderMyPlaylists(); }
		});
		// Delete
		const delBtn = document.createElement('button');
				// Export
				const exportBtn = document.createElement('button');
				exportBtn.type = 'button';
				exportBtn.className = 'btn subtle';
				exportBtn.textContent = 'Export';
				exportBtn.addEventListener('click', () => {
					try {
						const data = exportPlaylistData(pl);
						const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
						const a = document.createElement('a');
						const url = URL.createObjectURL(blob);
						a.href = url;
						const safe = (pl.title||'playlist').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
						a.download = `playlist_${safe}.json`;
						document.body.appendChild(a);
						a.click();
						a.remove();
						URL.revokeObjectURL(url);
					} catch (e) {
						renderToast('Failed to export playlist', 'error');
					}
				});
		delBtn.type = 'button';
		delBtn.className = 'btn subtle';
		delBtn.textContent = 'Delete';
		delBtn.addEventListener('click', () => {
			const ok = confirm('Delete this playlist?');
			if (!ok) return;
			deletePlaylist(userId, pl.id);
			renderToast('Playlist deleted', 'info');
			renderMyPlaylists();
		});
		right.appendChild(editBtn);
		right.appendChild(dupBtn);
		right.appendChild(delBtn);
		right.appendChild(exportBtn);
		row.appendChild(left);
		row.appendChild(right);
		listEl.appendChild(row);
	});

	function openEdit(pl){
		const overlay = document.createElement('div');
		overlay.className = 'modal';
		const dlg = document.createElement('div');
		dlg.className = 'modal__dialog';
		dlg.innerHTML = `
			<header class="modal__header"><h3>Edit Playlist</h3></header>
			<div class="modal__body">
				<label class="modal__label">Title
					<input id="plEditTitle" type="text" value="${(pl.title||'').replace(/"/g,'&quot;')}" />
				</label>
				<label class="modal__label">Description
					<textarea id="plEditDesc" rows="3">${pl.description||''}</textarea>
				</label>
			</div>
			<footer class="modal__footer">
				<button id="plEditCancel" class="btn secondary" type="button">Cancel</button>
				<button id="plEditSave" class="btn" type="button">Save</button>
			</footer>
		`;
		overlay.appendChild(dlg);
		document.body.appendChild(overlay);
		overlay.classList.remove('hidden');
		const titleIn = dlg.querySelector('#plEditTitle');
		const descIn = dlg.querySelector('#plEditDesc');
		dlg.querySelector('#plEditCancel').addEventListener('click', () => overlay.remove());
		dlg.querySelector('#plEditSave').addEventListener('click', () => {
			const nextTitle = (titleIn.value||'').trim();
			const nextDesc = descIn.value||'';
			updatePlaylistMeta(userId, pl.id, { title: nextTitle, description: nextDesc });
			overlay.remove();
			renderToast('Playlist updated', 'success');
			renderMyPlaylists();
		});
	}
}

function setupImportPlaylists(){
	const btn = document.getElementById('profileImportPlaylistBtn');
	const fileIn = document.getElementById('profileImportPlaylistInput');
	if (!btn || !fileIn) return;
	btn.addEventListener('click', () => fileIn.click());
	fileIn.addEventListener('change', async () => {
		const file = fileIn.files && fileIn.files[0];
		if (!file) return;
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			const userId = getActiveUsername();
			const created = importPlaylistData(userId, data, (id) => !!getLessonById(id));
			renderToast(`Imported: ${created.title || 'Playlist'}`, 'success');
			renderMyPlaylists();
		} catch (e) {
			console.error('Import failed', e);
			renderToast(e && e.message ? `Import failed: ${e.message}` : 'Import failed', 'error');
		} finally {
			fileIn.value = '';
		}
	});
}
