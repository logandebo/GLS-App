import { renderToast } from './ui.js';
import { runQuiz } from './quizRunner.js';
import { runKeyboardLesson } from './keyboardLesson.js';

export function runLesson(lesson, concept, profile, onComplete, onProgress) {
	const container = document.getElementById('lessonContainer');
	if (!container) return;
	container.innerHTML = '';
	// Normalize legacy fields if present
	const type = lesson.type || lesson.contentType || 'video';
	const cfg = lesson.contentConfig || {};
	switch (type) {
		case 'video':
			const url = cfg.video?.url || lesson.media?.videoUrl || lesson.media?.url || '';
			if (!url) { container.textContent = 'No video URL provided.'; return; }
			const port = document.createElement('div');
			port.className = 'video-port';
			const video = document.createElement('video');
			video.controls = true;
			video.src = url;
			video.className = 'video-player';
			if (typeof onProgress === 'function') {
				video.addEventListener('timeupdate', () => {
					try {
						const pct = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
						onProgress(Math.min(100, Math.max(0, pct)));
					} catch {}
				});
			}
			video.addEventListener('ended', () => onComplete && onComplete({
				completed: true,
				minutes: Number(lesson.minutes || lesson.estimatedMinutes || lesson.estimatedMinutesToComplete || 0) || 0,
				score: null
			}));
			port.appendChild(video);
			container.appendChild(port);
			break;
		case 'unity_game':
			const gameUrl = cfg.unity_game?.url || lesson.media?.url || '';
			if (!gameUrl) { container.textContent = 'No Unity build URL provided.'; return; }

			// Try direct embed when game URL points to a UnityBuilds index.html (enables MIDI bridge)
			const canDirectEmbed = (() => {
				try {
					const u = new URL(gameUrl, window.location.origin);
					return u.pathname.startsWith('/UnityBuilds/') && u.pathname.endsWith('/index.html');
				} catch { return false; }
			})();

			if (canDirectEmbed) {
				// Derive folder/product from /UnityBuilds/<ProductName>/index.html
				const urlObj = new URL(gameUrl, window.location.origin);
				const parts = urlObj.pathname.split('/').filter(Boolean);
				const productName = parts[1] || 'UnityBuild';

				(async () => {
					const baseDir = `/UnityBuilds/${productName}/Build/`;
					// Helper to test URL existence using HEAD (fallback to GET on HEAD failure)
					async function urlExists(u) {
						try {
							const head = await fetch(u, { method: 'HEAD', cache: 'no-store' });
							if (head.ok) return true;
							// Some servers may not allow HEAD; try a lightweight GET
							const get = await fetch(u, { method: 'GET', cache: 'no-store' });
							return get.ok;
						} catch { return false; }
					}

					// Detect actual base filename for this build (Unity varies between <ProductName>.* and UnityBuilds.*)
					let baseName = productName;
					if (!(await urlExists(`${baseDir}${baseName}.loader.js`))) {
						if (await urlExists(`${baseDir}UnityBuilds.loader.js`)) {
							baseName = 'UnityBuilds';
						} else {
							console.warn('Unity loader script not found for direct embed, using iframe instead.');
							renderUnityIframe(gameUrl, container);
							return;
						}
					}

					// Detect compression (.gz) for framework/wasm/data
					const useGzip = await urlExists(`${baseDir}${baseName}.framework.js.gz`);
					const gz = useGzip ? '.gz' : '';

					const config = {
						dataUrl: `${baseDir}${baseName}.data${gz}`,
						frameworkUrl: `${baseDir}${baseName}.framework.js${gz}`,
						codeUrl: `${baseDir}${baseName}.wasm${gz}`,
						streamingAssetsUrl: `/UnityBuilds/${productName}/StreamingAssets`,
						companyName: 'GLS',
						productName: productName,
						productVersion: '1.0'
					};

					ensureScript(`${baseDir}${baseName}.loader.js`)
						.then(() => ensureScript('/js/midi/webMidiBridge.js'))
						.then(() => {
							const canvas = document.createElement('canvas');
							canvas.id = 'unity-canvas';
							canvas.className = 'unity-frame';
							canvas.style.width = '100%';
							container.appendChild(canvas);
							return createUnityInstance(canvas, config);
						})
						.then((instance) => {
							window.__UNITY_READY__ = true;
							setupMidiBridge(instance);
							// Fixed fullscreen button (bottom-right)
							ensureFullscreenButton(() => {
								try { instance && instance.SetFullscreen && instance.SetFullscreen(1); }
								catch {
									const c = document.getElementById('unity-canvas');
									c && c.requestFullscreen && c.requestFullscreen();
								}
							});
							// Fit canvas to viewport with 16:9 aspect ratio
							const canvasEl = document.getElementById('unity-canvas');
							const resize = () => {
								const header = document.querySelector('.site-header');
								const headerH = header ? header.offsetHeight : 0;
								const extra = 200; // meta + progress + margins + controls
								const availH = Math.max(300, (window.innerHeight - headerH - extra));
								const containerW = (document.getElementById('lessonContainer')?.clientWidth) || window.innerWidth;
								const targetW = Math.min(containerW, Math.floor(availH * (16 / 9))); // width limited by height
								const targetH = Math.floor(targetW / (16 / 9));
								if (canvasEl) { canvasEl.style.width = targetW + 'px'; canvasEl.style.height = targetH + 'px'; }
								const bottom = document.getElementById('unityBottomControls');
								if (bottom) bottom.style.width = targetW + 'px';
							};
							resize();
							window.addEventListener('resize', resize, { passive: true });
						})
						.catch((err) => {
							console.error('Unity direct embed failed, falling back to iframe', err);
							renderUnityIframe(gameUrl, container);
						});
				})();
			} else {
				// Fallback: iframe embed
				renderUnityIframe(gameUrl, container);
			}
			// Removed mark-complete button per request
			break;
		case 'external_link':
			const links = (cfg.external_link?.links && Array.isArray(cfg.external_link.links))
				? cfg.external_link.links
				: (cfg.external_link?.externalUrl ? [{ url: cfg.external_link.externalUrl, label: cfg.external_link.label || '' }] : []);
			const previewUrl = cfg.external_link?.previewVideoUrl || lesson.previewVideoUrl || '';
			if (!links.length) { container.textContent = 'No external link provided.'; return; }
			// Link buttons
			const linkWrap = document.createElement('div');
			linkWrap.className = 'external-link';
			for (const item of links) {
				if (!item || !item.url) continue;
				const a = document.createElement('a');
				a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
				a.className = 'btn'; a.textContent = item.label || 'Open External Content';
				linkWrap.appendChild(a);
			}
			container.appendChild(linkWrap);
			// Optional preview video (shows only when present)
			if (previewUrl) {
				const port = document.createElement('div'); port.className = 'video-port';
				const video = document.createElement('video'); video.controls = true; video.src = previewUrl; video.className = 'video-player';
				if (typeof onProgress === 'function') {
					video.addEventListener('timeupdate', () => {
						try {
							const pct = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
							onProgress(Math.min(100, Math.max(0, pct)));
						} catch {}
					});
				}
				port.appendChild(video);
				container.appendChild(port);
			}
			// Completion button
			const extCompleteBtn = document.createElement('button');
			extCompleteBtn.type = 'button';
			extCompleteBtn.textContent = 'Mark Lesson Completed';
			extCompleteBtn.className = 'btn';
			extCompleteBtn.addEventListener('click', () => {
				renderToast('Lesson marked complete', 'success');
				onComplete && onComplete({
					completed: true,
					minutes: Number(lesson.minutes || lesson.estimatedMinutes || lesson.estimatedMinutesToComplete || 0) || 0,
					score: null
				});
			});
			container.appendChild(extCompleteBtn);
			break;
		case 'quiz':
			runQuiz(lesson, container, (scorePct) => {
				onComplete && onComplete({
					completed: true,
					minutes: Number(lesson.minutes || lesson.estimatedMinutes || lesson.estimatedMinutesToComplete || 0) || 0,
					score: Number(scorePct) || 0
				});
			}, (scorePct) => { renderToast('Quiz failed (' + scorePct + '%)', 'error'); }, onProgress);
			break;
		case 'keyboard_lesson':
			// New interactive keyboard lesson type
			runKeyboardLesson(lesson, container, (session) => {
				onComplete && onComplete({
					completed: true,
					minutes: Number(lesson.minutes || lesson.estimatedMinutes || lesson.estimatedMinutesToComplete || 0) || 0,
					score: typeof session?.score === 'number' ? session.score : null
				});
			}, onProgress);
			break;
		default:
			container.textContent = 'Unsupported lesson type.';
	}
}

// Inject a script tag if not already loaded
async function ensureScript(src) {
	return new Promise((resolve, reject) => {
		if ([...document.scripts].some(s => s.src.endsWith(src))) return resolve();
		const tag = document.createElement('script');
		tag.src = src; tag.async = true;
		tag.onload = () => resolve();
		tag.onerror = () => reject(new Error('Failed to load ' + src));
		document.head.appendChild(tag);
	});
}

function setupMidiBridge(unityInstance) {
	try {
		if (!window.WebMidiBridge) return;
		if (typeof window.WebMidiBridge.setTargetObjectName === 'function') {
			window.WebMidiBridge.setTargetObjectName('WebGLReceiver');
		}
		if (typeof window.WebMidiBridge.setUnityInstance === 'function') {
			window.WebMidiBridge.setUnityInstance(unityInstance);
		}
		// Controls strip: MIDI controls
		const ui = document.createElement('div');
		ui.className = 'unity-controls';
		const enableBtn = document.createElement('button'); enableBtn.className='btn secondary'; enableBtn.textContent='Enable MIDI';
		const select = document.createElement('select'); select.innerHTML = '<option value="all">All Inputs</option>';
		enableBtn.addEventListener('click', async () => {
			try { await window.WebMidiBridge.initWebMIDI(); populateInputs(select); } catch (e) { console.error('Web MIDI init failed', e); }
		});
		select.addEventListener('change', () => { window.WebMidiBridge.selectInput && window.WebMidiBridge.selectInput(select.value); });
		ui.appendChild(enableBtn); ui.appendChild(select);
		const container = document.getElementById('lessonContainer');
		container && container.insertBefore(ui, container.firstChild);
	} catch (e) { console.warn('MIDI bridge setup failed', e); }
}

// Create a single fullscreen button fixed at bottom-right
function ensureFullscreenButton(onClick) {
	let wrap = document.getElementById('unityBottomControls');
	if (!wrap) {
		wrap = document.createElement('div');
		wrap.id = 'unityBottomControls';
		wrap.className = 'unity-bottom-controls';
		const container = document.getElementById('lessonContainer');
		container && container.appendChild(wrap);
	}
	let btn = document.getElementById('unityFsButton');
	if (!btn) {
		btn = document.createElement('button');
		btn.id = 'unityFsButton';
		btn.className = 'btn';
		btn.textContent = 'Full Screen';
		wrap.appendChild(btn);
	}
	btn.onclick = onClick;
}

function populateInputs(select) {
	const list = (window.WebMidiBridge.getInputs && window.WebMidiBridge.getInputs()) || [];
	select.innerHTML = '<option value="all">All Inputs</option>';
	for (const inp of list) {
		const opt = document.createElement('option');
		opt.value = inp.id; opt.textContent = inp.name || inp.manufacturer || inp.id;
		select.appendChild(opt);
	}
}

function renderUnityIframe(gameUrl, container) {
	const iframe = document.createElement('iframe');
	iframe.src = gameUrl;
	iframe.title = 'Unity Game';
	iframe.className = 'unity-frame';
	iframe.allowFullscreen = true;
	iframe.setAttribute('scrolling','no');
	container.appendChild(iframe);

	// Fixed fullscreen button for iframe
	ensureFullscreenButton(() => {
		if (iframe.requestFullscreen) iframe.requestFullscreen();
		else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
	});
	// Resize maintaining 16:9 and fit viewport
	const resize = () => {
		const header = document.querySelector('.site-header');
		const headerH = header ? header.offsetHeight : 0;
		const extra = 200; // meta + progress + margins + controls
		const availH = Math.max(300, (window.innerHeight - headerH - extra));
		const containerW = (document.getElementById('lessonContainer')?.clientWidth) || window.innerWidth;
		const targetW = Math.min(containerW, Math.floor(availH * (16 / 9)));
		const targetH = Math.floor(targetW / (16 / 9));
		iframe.style.width = targetW + 'px';
		iframe.style.height = targetH + 'px';
		const bottom = document.getElementById('unityBottomControls');
		if (bottom) bottom.style.width = targetW + 'px';
	};
	resize();
	window.addEventListener('resize', resize, { passive: true });
}
