import { loadAllConcepts } from './contentLoader.js';

let _concepts = null; // Array of concepts (merged)
let _relationships = null; // Built-in relationships from graph.json

export async function loadGraph() {
	if (_concepts && _relationships) return { concepts: _concepts, relationships: _relationships };
	// Load relationships from built-in graph.json
	const res = await fetch('data/graph.json');
	const builtIn = await res.json();
	_relationships = Array.isArray(builtIn?.relationships) ? builtIn.relationships : [];
	// Load merged concepts (built-in + custom)
	_concepts = await loadAllConcepts();
	return { concepts: _concepts, relationships: _relationships };
}

export function getAllConcepts() {
	return Array.isArray(_concepts) ? _concepts.slice() : [];
}

export function getConceptById(id) {
	const arr = Array.isArray(_concepts) ? _concepts : [];
	return arr.find(c => c && c.id === id) || null;
}

export function getRelationshipsForConcept(id, type = null) {
	const rels = Array.isArray(_relationships) ? _relationships : [];
	return rels
		.filter(r => r && (r.from === id || r.to === id))
		.filter(r => (type ? r.type === type : true));
}