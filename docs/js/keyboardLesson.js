// Keyboard lesson runner: renders an on-screen piano, supports MIDI input, evaluates note selection.
// Minimal MVP: single-note identification with optional repeat attempts.

import { renderToast } from './ui.js';

export function runKeyboardLesson(lesson, container, onComplete, onProgress){
	const cfg = (lesson.contentConfig && lesson.contentConfig.keyboard_lesson) || {};
	const globalIgnoreOctave = !!cfg.ignoreOctave;
	const range = normalizeRange(cfg.range || cfg.allowedRange || 'C3-C5');

	// Determine mode: single note or multi-step sequence
	const isSteps = Array.isArray(cfg.steps) && cfg.steps.length > 0;
	const mode = isSteps ? 'steps' : (String(cfg.mode||'note').toLowerCase());
	// When steps are present, ignore single-target fields completely
	const attemptsRequired = isSteps ? 1 : (Number(cfg.attempts || 1) || 1);
	const targetNote = isSteps ? null : (typeof (cfg.target || cfg.targetNote || 'C4') === 'number' 
		? (cfg.target || cfg.targetNote)
		: noteNameToMidi(cfg.target || cfg.targetNote || 'C4'));

	// Step state
	const steps = isSteps ? cfg.steps.map(normalizeStep) : [];
	let stepIndex = 0;
	let correctCount = 0;
	let totalCount = 0;

	container.innerHTML = '';
	const wrap = document.createElement('div');
	wrap.className = 'keyboard-lesson';
	const header = document.createElement('div'); header.className = 'keyboard-lesson__header';
	const title = document.createElement('h3'); title.textContent = lesson.title || 'Keyboard Lesson';
	const prompt = document.createElement('p'); prompt.className = 'keyboard-lesson__prompt';
	header.appendChild(title); header.appendChild(prompt);
	wrap.appendChild(header);

	// Controls: MIDI enable, input select, and status
	const controls = document.createElement('div'); controls.className = 'keyboard-lesson__controls';
	const midiBtn = document.createElement('button'); midiBtn.className = 'btn secondary'; midiBtn.textContent = 'Enable MIDI';
	const midiSelect = document.createElement('select'); midiSelect.className = 'keyboard-lesson__midi-select'; midiSelect.innerHTML = '<option value="all">All Inputs</option>';
	const midiStatus = document.createElement('span'); midiStatus.className = 'short muted'; midiStatus.textContent = 'MIDI: Disabled';
	controls.appendChild(midiBtn); controls.appendChild(midiSelect); controls.appendChild(midiStatus);
	wrap.appendChild(controls);

	// Piano UI
	const piano = document.createElement('div'); piano.className = 'piano';
	const keys = buildKeys(range);
	keys.forEach(k => piano.appendChild(k.el));
	wrap.appendChild(piano);

	let finished = false;

	container.appendChild(wrap);

	// Event hooks for on-screen piano (support held notes for chords)
	const heldNotes = new Set();
	keys.forEach(k => {
		const down = () => { heldNotes.add(k.midi); setActive(k.midi, true); handleInput(k.midi, true); };
		const up = () => { heldNotes.delete(k.midi); setActive(k.midi, false); };
		k.el.addEventListener('pointerdown', down);
		k.el.addEventListener('pointerup', up);
		k.el.addEventListener('pointerleave', up);
	});

	function updatePrompt(){
		if (mode === 'note'){
			const label = globalIgnoreOctave ? midiToNoteName(targetNote).replace(/\d+$/,'') : midiToNoteName(targetNote);
			prompt.textContent = `Play the note: ${label}`;
		} else {
			if (stepIndex >= steps.length){
				prompt.textContent = 'Sequence complete!';
				return;
			}
			const s = steps[stepIndex];
			const ignore = !!s.ignoreOctave || globalIgnoreOctave;
			const names = s.targets.map(n => (ignore ? midiToNoteName(n).replace(/\d+$/,'') : midiToNoteName(n))).join(s.simultaneous ? ' + ' : ', ');
			prompt.textContent = s.simultaneous ? `Play chord: ${names}` : `Play the note: ${names}`;
		}
	}
	updatePrompt();

	function progress(pct){ if (typeof onProgress === 'function') onProgress(Math.min(100, Math.max(0, Math.round(pct)))); }

	function handleInput(midi, isDown){
		totalCount++;
		const ok = (mode === 'note') ? evaluateNote(targetNote, midi, globalIgnoreOctave) : evaluateStep(midi);
		if (ok){
			correctCount++;
			renderToast('Correct!', 'success');
			if (mode === 'note'){
				const pct = (correctCount/attemptsRequired)*100; progress(pct);
				if (!finished && correctCount >= attemptsRequired){
					finished = true;
					const score = Math.round((correctCount/Math.max(1,totalCount))*100);
					onComplete && onComplete({ completed: true, score });
				}
			} else {
				stepIndex = Math.min(stepIndex+1, steps.length);
				updatePrompt();
				const pct = (stepIndex/Math.max(1,steps.length))*100; progress(pct);
				if (!finished && stepIndex >= steps.length){
					finished = true;
					const score = Math.round((stepIndex/Math.max(1,steps.length))*100);
					onComplete && onComplete({ completed: true, score });
				}
			}
		} else {
			renderToast('Try again', 'warning');
			const pct = mode==='note' ? (correctCount/attemptsRequired)*100 : (stepIndex/Math.max(1,steps.length))*100; progress(pct);
		}
	}

	function evaluateStep(inputMidi){
		const s = steps[stepIndex]; if (!s) return false;
		const ignore = !!s.ignoreOctave || globalIgnoreOctave;
		if (s.simultaneous){
			return s.targets.every(t => containsTarget(heldNotes, t, ignore));
		} else {
			// Advance when the current input matches any target for this step
			return s.targets.some(t => equalsTarget(inputMidi, t, ignore));
		}
	}

	// MIDI enable and selection (direct Web MIDI; independent of WebMidiBridge)
	let midiAccess = null;
	let activeInputId = 'all';
	midiBtn.addEventListener('click', async () => {
		try {
			if (!navigator.requestMIDIAccess) throw new Error('Web MIDI not supported');
			midiAccess = await navigator.requestMIDIAccess({ sysex:false });
			populateInputs();
			attachInputs();
			midiStatus.textContent = midiAccess.inputs.size ? 'MIDI: Connected' : 'MIDI: Enabled (no inputs)';
			renderToast('MIDI enabled', 'success');
		} catch (e){
			console.warn('MIDI init failed', e);
			midiStatus.textContent = 'MIDI: Unavailable';
			renderToast('MIDI unavailable on this device', 'error');
		}
	});
	midiSelect.addEventListener('change', () => { activeInputId = midiSelect.value || 'all'; attachInputs(); updateMidiStatus(); });

	function updateMidiStatus(){
		if (!midiAccess){ midiStatus.textContent = 'MIDI: Disabled'; return; }
		const hasInputs = midiAccess.inputs && midiAccess.inputs.size > 0;
		if (!hasInputs){ midiStatus.textContent = 'MIDI: Enabled (no inputs)'; return; }
		if (activeInputId === 'all'){ midiStatus.textContent = 'MIDI: Connected (all inputs)'; return; }
		const inp = midiAccess.inputs.get(activeInputId);
		midiStatus.textContent = inp ? `MIDI: Connected to ${inp.name || inp.manufacturer || inp.id}` : 'MIDI: Connected';
	}

	function populateInputs(){
		if (!midiAccess) return;
		midiSelect.innerHTML = '<option value="all">All Inputs</option>';
		for (const input of midiAccess.inputs.values()){
			const opt = document.createElement('option'); opt.value = input.id; opt.textContent = input.name || input.manufacturer || input.id; midiSelect.appendChild(opt);
		}
		updateMidiStatus();
		midiAccess.onstatechange = () => { populateInputs(); };
	}
	function attachInputs(){
		if (!midiAccess) return;
		for (const input of midiAccess.inputs.values()) input.onmidimessage = null;
		for (const input of midiAccess.inputs.values()){
			if (activeInputId === 'all' || activeInputId === input.id){
				input.onmidimessage = (evt) => {
					const data = evt.data || [];
					const status = data[0]; const type = status & 0xF0; const note = data[1]; const vel = data[2] || 0;
					if (type === 0x90 && vel > 0){ heldNotes.add(note); setActive(note, true); handleInput(note, true); }
					else if (type === 0x80 || (type === 0x90 && vel === 0)){ heldNotes.delete(note); setActive(note, false); }
				};
			}
		}
		updateMidiStatus();
	}
}

// Helpers
function normalizeRange(spec){
	const parts = String(spec||'C3-C5').split('-');
	const lo = noteNameToMidi(parts[0] || 'C3');
	const hi = noteNameToMidi(parts[1] || 'C5');
	return { lo, hi };
}
function buildKeys(range){
	const map = [];
	for (let m = range.lo; m <= range.hi; m++){
		const isBlack = isBlackKey(m);
		const el = document.createElement('div');
		el.className = 'key ' + (isBlack ? 'black' : 'white');
		el.dataset.midi = String(m);
		el.title = midiToNoteName(m);
		map.push({ midi: m, el });
	}
	return map;
}
function setActive(midi, active){
	const el = document.querySelector(`.key[data-midi="${midi}"]`);
	if (el){ el.classList.toggle('active', !!active); }
}
function evaluate(mode, targetMidi, inputMidi){
	if (mode === 'note'){ return targetMidi === inputMidi; }
	return targetMidi === inputMidi; // placeholder
}

// Note/midi
const NOTE_ORDER = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteNameToMidi(name){
	if (typeof name === 'number') return name;
	const m = String(name||'C4').trim();
	// Accept optional octave; default to 4 when missing
	const match = m.match(/^([A-Ga-g])([#b]?)(\d?)$/);
	if (!match){ return 60; }
	let letter = match[1].toUpperCase(); const accidental = match[2] || ''; const octave = match[3] === '' ? 4 : Number(match[3]);
	if (accidental === 'b'){
		// map flats to equivalent sharps
		const flats = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
		letter = (flats[letter+'b']||letter);
	}
	const idx = NOTE_ORDER.indexOf(letter + accidental);
	if (idx < 0) return 60;
	return (octave + 1) * 12 + idx; // MIDI note where C4 = 60
}
function midiToNoteName(midi){
	const idx = midi % 12; const octave = Math.floor(midi/12) - 1;
	return `${NOTE_ORDER[idx]}${octave}`;
}
function isBlackKey(midi){
	const idx = midi % 12; return [1,3,6,8,10].includes(idx);
}

// Advanced helpers
function equalsTarget(inputMidi, targetMidi, ignoreOctave){
	return ignoreOctave ? (inputMidi % 12) === (targetMidi % 12) : inputMidi === targetMidi;
}
function containsTarget(set, targetMidi, ignoreOctave){
	for (const n of set){ if (equalsTarget(n, targetMidi, ignoreOctave)) return true; }
	return false;
}
function evaluateNote(targetMidi, inputMidi, ignoreOctave){
	return equalsTarget(inputMidi, targetMidi, ignoreOctave);
}
function normalizeStep(s){
	const targets = (Array.isArray(s?.targets) ? s.targets : [s?.target || s?.targetNote || 'C4']).map(n => (typeof n === 'number' ? n : noteNameToMidi(n)));
	const simultaneous = !!s?.simultaneous;
	const ignoreOctave = !!s?.ignoreOctave;
	return { targets, simultaneous, ignoreOctave };
}
