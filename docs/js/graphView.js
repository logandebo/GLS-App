import { loadGraph } from './graph.js';

let _container = null;
let _concepts = [];
let _getMasteryForConcept = null;
let _onSelect = null;
let _svg = null;
let _nodePositions = new Map(); // conceptId -> {x,y}
let _selectedId = null;
let _relationships = [];
let _searchTerm = '';
let _userEdges = [];
let _showUserEdges = false;

export async function initGraphView(container, concepts, getMasteryForConcept, onSelect) {
	_container = container;
	_concepts = Array.isArray(concepts) ? concepts : [];
	_getMasteryForConcept = typeof getMasteryForConcept === 'function' ? getMasteryForConcept : () => ({ tier: 'unrated', xp: 0 });
	_onSelect = typeof onSelect === 'function' ? onSelect : () => {};

	_container.innerHTML = '';
	_svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	_svg.setAttribute('width', '100%');
	_svg.setAttribute('height', '520');
	_svg.setAttribute('viewBox', '0 0 960 520');
	_container.appendChild(_svg);

	// Load built-in relationships
	try {
		const g = await loadGraph();
		_relationships = Array.isArray(g?.relationships) ? g.relationships : [];
	} catch {
		_relationships = [];
	}

	layoutAndRender();
}

export function updateGraphSelection(conceptId) {
	_selectedId = conceptId;
	Array.from(_svg.querySelectorAll('.graph-node')).forEach(g => {
		const id = g.getAttribute('data-concept-id');
		if (id === conceptId) g.classList.add('selected'); else g.classList.remove('selected');
	});
}

function layoutAndRender() {
	_nodePositions.clear();
	const categories = Array.from(new Set(_concepts.map(c => c.subject || 'General')));
	const catIndex = new Map(categories.map((c, i) => [c, i]));

	// Buckets on X by estimated minutes
	function bucketForMinutes(mins) {
		const m = Number(mins) || 0;
		if (m <= 10) return 0;
		if (m <= 20) return 1;
		if (m <= 40) return 2;
		return 3;
	}

	const width = 960;
	const height = 520;
	const colCount = 4;
	const rowCount = Math.max(categories.length, 1);
	const colGap = width / (colCount + 1);
	const rowGap = height / (rowCount + 1);

	// Compute positions
	const bucketCounters = new Map();
	_concepts.forEach(c => {
		const col = bucketForMinutes(c.estimatedMinutesToBasicMastery);
		const row = catIndex.get(c.subject || 'General') ?? 0;
		const baseX = (col + 1) * colGap;
		const baseY = (row + 1) * rowGap;
		const key = `${col}:${row}`;
		const n = (bucketCounters.get(key) || 0);
		bucketCounters.set(key, n + 1);
		const jitterX = (n % 3 - 1) * 14; // -14,0,14... simple spread
		const jitterY = (Math.floor(n / 3) % 3 - 1) * 10; // -10,0,10...
		_nodePositions.set(c.id, { x: baseX + jitterX, y: baseY + jitterY });
	});

	// Clear SVG
	_svg.innerHTML = '';

	// Draw edges (simple: RELATED_TO faint, PART_OF faint, REQUIRES/prereq stronger if present)
	const nodesSet = new Set(_concepts.map(c => c.id));
	const edgesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	_svg.appendChild(edgesLayer);
	(_relationships || []).forEach(r => {
		if (!r || !nodesSet.has(r.from) || !nodesSet.has(r.to)) return;
		const a = _nodePositions.get(r.from);
		const b = _nodePositions.get(r.to);
		if (!a || !b) return;
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		line.setAttribute('x1', String(a.x));
		line.setAttribute('y1', String(a.y));
		line.setAttribute('x2', String(b.x));
		line.setAttribute('y2', String(b.y));
		let stroke = '#334155';
		let width = 1;
		if (r.type && /require|prereq/i.test(r.type)) { stroke = '#60a5fa'; width = 2; }
		line.setAttribute('stroke', stroke);
		line.setAttribute('stroke-width', String(width));
		line.setAttribute('opacity', r.type === 'RELATED_TO' ? '0.6' : '0.9');
		edgesLayer.appendChild(line);
	});

	// Draw user edges overlay if enabled
	if (_showUserEdges && Array.isArray(_userEdges) && _userEdges.length) {
		const userLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		userLayer.setAttribute('data-layer', 'user-edges');
		_svg.appendChild(userLayer);
		_userEdges.forEach(e => {
			if (!e || !nodesSet.has(e.sourceConceptId) || !nodesSet.has(e.targetConceptId)) return;
			const a = _nodePositions.get(e.sourceConceptId);
			const b = _nodePositions.get(e.targetConceptId);
			if (!a || !b) return;
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			line.setAttribute('x1', String(a.x));
			line.setAttribute('y1', String(a.y));
			line.setAttribute('x2', String(b.x));
			line.setAttribute('y2', String(b.y));
			line.setAttribute('stroke', '#10b981');
			const width = Math.min(4, 1 + (Number(e.weight) || 1));
			line.setAttribute('stroke-width', String(width));
			line.setAttribute('opacity', '0.85');
			userLayer.appendChild(line);
		});
	}

	// Draw nodes
	const nodesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	_svg.appendChild(nodesLayer);
	_concepts.forEach(c => {
		const pos = _nodePositions.get(c.id);
		if (!pos) return;
		const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		group.classList.add('graph-node');
		group.setAttribute('data-concept-id', c.id);
		group.setAttribute('tabindex', '0');
		// Mastery styling
		const m = _getMasteryForConcept(c.id) || { tier: 'unrated', xp: 0 };
		const tier = (m.tier || 'unrated').toLowerCase();
		const xp = Number(m.xp) || 0;
		const radius = Math.max(10, Math.min(24, 10 + Math.floor(xp / 50)));
		let fill = '#64748b';
		if (tier === 'bronze') fill = '#b45309';
		else if (tier === 'silver') fill = '#94a3b8';
		else if (tier === 'gold') fill = '#f59e0b';

		const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		circle.setAttribute('cx', String(pos.x));
		circle.setAttribute('cy', String(pos.y));
		circle.setAttribute('r', String(radius));
		circle.setAttribute('fill', fill);
		circle.setAttribute('stroke', '#111827');
		circle.setAttribute('stroke-width', '1.5');
		group.appendChild(circle);

		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		label.setAttribute('x', String(pos.x));
		label.setAttribute('y', String(pos.y - radius - 6));
		label.setAttribute('text-anchor', 'middle');
		label.setAttribute('fill', '#e5e7eb');
		label.setAttribute('font-size', '10');
		label.textContent = c.title || c.id;
		group.appendChild(label);

		group.addEventListener('click', () => _onSelect(c.id));
		group.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onSelect(c.id); }
		});

		if (_selectedId === c.id) group.classList.add('selected');
		// Apply initial search dimming
		if (_searchTerm && !matchesConcept(c, _searchTerm)) group.classList.add('dimmed');
		nodesLayer.appendChild(group);
	});
}

function matchesConcept(c, term) {
	const t = (term || '').toLowerCase();
	if (!t) return true;
	const name = (c.title || c.id || '').toLowerCase();
	const subject = (c.subject || '').toLowerCase();
	const tags = Array.isArray(c.tags) ? c.tags.join(' ').toLowerCase() : '';
	return name.includes(t) || subject.includes(t) || tags.includes(t);
}

export function applySearchFilter(term) {
	_searchTerm = (term || '').toLowerCase();
	if (!_svg) return;
	const nodes = Array.from(_svg.querySelectorAll('.graph-node'));
	nodes.forEach(n => {
		const id = n.getAttribute('data-concept-id');
		const concept = _concepts.find(c => c.id === id);
		if (!concept) return;
		if (!_searchTerm || matchesConcept(concept, _searchTerm)) n.classList.remove('dimmed'); else n.classList.add('dimmed');
	});
}

export function setUserEdges(edges) {
	_userEdges = Array.isArray(edges) ? edges : [];
	if (_svg) layoutAndRender();
}

export function setShowUserEdges(show) {
	_showUserEdges = !!show;
	if (_svg) layoutAndRender();
}
