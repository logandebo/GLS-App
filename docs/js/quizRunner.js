import { renderToast } from './ui.js';

export function runQuiz(lesson, container, onPass, onFail, onProgress) {
	const quiz = lesson.contentConfig?.quiz || lesson.quiz || null;
	if (!quiz) { container.textContent = 'Quiz data missing.'; return; }
	const questions = quiz.questions || [];
	if (!questions.length) { container.textContent = 'No questions.'; return; }
	const form = document.createElement('form');
	form.className = 'quiz-form';
	let hasKeyboardVisual = false;
	questions.forEach((q, qi) => {
		const block = document.createElement('div');
		block.className = 'quiz-question';
		const promptP = document.createElement('p');
		promptP.textContent = q.prompt || 'Untitled question';
		block.appendChild(promptP);

		// Optional visual
		if (q.visual && q.visual.type === 'image' && q.visual.url){
			const img = document.createElement('img');
			img.src = q.visual.url; img.alt = 'Question visual'; img.style.maxWidth = '100%'; img.style.borderRadius = '6px'; img.style.margin = '0.25rem 0 0.5rem 0';
			img.onerror = () => { img.remove(); };
			block.appendChild(img);
		} else if (q.visual && q.visual.type === 'keyboard'){
			hasKeyboardVisual = true;
			const wrap = document.createElement('div'); wrap.className = 'piano'; wrap.style.margin = '0.25rem 0 0.5rem 0';
			const num = Number(q.visual.numKeys || 24);
			const start = noteNameToMidi(q.visual.startNote || 'C3');
			const highlighted = Array.isArray(q.visual.highlighted) ? q.visual.highlighted.map(h => noteNameToMidi(h)) : [];
			for (let m = start; m < start + num; m++){
				const el = document.createElement('div'); const isBlack = isBlackKey(m);
				el.className = 'key ' + (isBlack ? 'black' : 'white'); el.dataset.midi = String(m); el.title = midiToNoteName(m);
				if (highlighted.includes(m)){ el.classList.add('active'); }
				wrap.appendChild(el);
			}
			block.appendChild(wrap);
		}
		(q.choices || []).forEach((choice, ci) => {
			const label = document.createElement('label');
			label.className = 'quiz-option';
			const inp = document.createElement('input');
			inp.type = 'radio';
			inp.name = 'q' + qi;
			inp.value = String(ci);
			inp.addEventListener('change', () => {
				if (typeof onProgress === 'function') {
					const answered = Array.from(form.querySelectorAll('input[type="radio"]'))
						.reduce((acc, r) => (acc.add(r.name), acc), new Set());
					// Count unique names with one checked
					const answeredCount = new Set(Array.from(form.querySelectorAll('input[type="radio"]:checked')).map(r => r.name)).size;
					const pct = Math.round((answeredCount / questions.length) * 100);
					onProgress(pct);
				}
			});
			label.appendChild(inp);
			label.appendChild(document.createTextNode(choice.text || ''));
			block.appendChild(label);
		});
		form.appendChild(block);
	});

	if (hasKeyboardVisual) {
		form.classList.add('quiz-form--wide');
	}
	const submitBtn = document.createElement('button');
	submitBtn.type = 'submit';
	submitBtn.textContent = 'Submit Quiz';
	form.appendChild(submitBtn);
	form.addEventListener('submit', e => {
		e.preventDefault();
		if (form.dataset.locked) return;
		let correct = 0;
		questions.forEach((q, qi) => {
			const chosen = form.querySelector(`input[name="q${qi}"]:checked`);
			(q.choices || []).forEach((c, ci) => {
				const lab = form.querySelector(`input[name="q${qi}"][value="${ci}"]`).parentElement;
				lab.classList.remove('quiz-correct','quiz-incorrect');
				if (c.isCorrect) lab.classList.add('quiz-correct'); else if (chosen && Number(chosen.value) === ci) lab.classList.add('quiz-incorrect');
			});
			if (chosen) {
				const choice = q.choices[Number(chosen.value)];
				if (choice && choice.isCorrect) correct++;
			}
		});
		form.dataset.locked = 'true';
		const scorePct = Math.round((correct / questions.length) * 100);
		if (scorePct >= 60) {
			renderToast('Quiz passed! (' + scorePct + '%)', 'success');
			onPass && onPass(scorePct);
		} else {
			onFail && onFail(scorePct);
			setTimeout(() => {
				delete form.dataset.locked;
				Array.from(form.querySelectorAll('input[type=radio]')).forEach(r => r.disabled = false);
			}, 2500);
		}
		if (typeof onProgress === 'function') onProgress(100);
		Array.from(form.querySelectorAll('input[type=radio]')).forEach(r => r.disabled = true);
	});
	container.appendChild(form);
}

// Lightweight note helpers for keyboard visuals
const NOTE_ORDER = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteNameToMidi(name){
	if (typeof name === 'number') return name;
	const m = String(name||'C4').trim();
	const match = m.match(/^([A-Ga-g])([#b]?)(\d?)$/);
	if (!match){ return 60; }
	let letter = match[1].toUpperCase(); const accidental = match[2] || ''; const octave = match[3] === '' ? 4 : Number(match[3]);
	if (accidental === 'b'){
		const flats = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
		letter = (flats[letter+'b']||letter);
	}
	const idx = NOTE_ORDER.indexOf(letter + accidental);
	if (idx < 0) return 60;
	return (octave + 1) * 12 + idx;
}
function midiToNoteName(midi){ const idx = midi % 12; const octave = Math.floor(midi/12) - 1; return `${NOTE_ORDER[idx]}${octave}`; }
function isBlackKey(midi){ const idx = midi % 12; return [1,3,6,8,10].includes(idx); }
