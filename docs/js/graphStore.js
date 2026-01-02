// GraphStore: Master Graph abstraction (Phase: Master Graph Refactor)
// New unified schema per node:
// {
//   id, title, summary, primaryDomain, domains[], tags[], tier (optional future),
//   relationships: { buildsOn:[], relatedTo:[], partOf:null|id },
//   lessons:[], metrics:{ totalViews, totalStarts, totalCompletions, avgScore, estimatedDifficulty }
// }
// Container: { nodes: [...] }

let _nodes = [];
let _nodesById = new Map();

// Migration from legacy graph.json + merged custom concepts structure
// Legacy concept shape fields we map:
//  id, title, shortDescription -> summary, subject -> primaryDomain, tags, difficulty -> metrics.estimatedDifficulty
//  estimatedMinutesToBasicMastery (ignored for master graph schema except may inform metrics)
//  lessonIds -> lessons
// Legacy relationships array objects: { from, to, type }
// Mapping: PART_OF => partOf (child points to parent), RELATED_TO => reciprocal relatedTo[], BUILDS_ON (if present) => buildsOn (directed)

export function migrateLegacyGraph(rawConcepts = [], rawRelationships = []) {
  const nodes = rawConcepts.map(c => {
    const summary = c.shortDescription || c.longDescription || '';
    const primaryDomain = c.subject ? String(c.subject).toLowerCase() : 'general';
    const domains = c.subject ? [String(c.subject).toLowerCase()] : [primaryDomain];
    const relationships = { buildsOn: [], relatedTo: [], partOf: null };
    const lessons = Array.isArray(c.lessonIds) ? c.lessonIds.slice() : [];
    const metrics = {
      totalViews: 0,
      totalStarts: 0,
      totalCompletions: 0,
      avgScore: null,
      estimatedDifficulty: Number(c.difficulty || c.estimatedDifficulty || 1) || 1
    };
    return {
      id: c.id,
      title: c.title || c.id,
      summary,
      primaryDomain,
      subject: c.subject || primaryDomain, // legacy compatibility
      domains,
      tags: Array.isArray(c.tags) ? c.tags.slice() : [],
      tier: null,
      relationships,
      lessons,
      metrics,
      // carry over legacy time estimate for UI buckets
      estimatedMinutesToBasicMastery: c.estimatedMinutesToBasicMastery || null,
      difficulty: c.difficulty || null
    };
  });
  // Index for easy relationship injection
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Process legacy relationships
  rawRelationships.forEach(r => {
    if (!r || !r.from || !r.to) return;
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to) return;
    switch (r.type) {
      case 'PART_OF':
        // Child (from) is part of parent (to)
        if (!from.relationships.partOf) from.relationships.partOf = to.id;
        break;
      case 'RELATED_TO':
        if (!from.relationships.relatedTo.includes(to.id)) from.relationships.relatedTo.push(to.id);
        if (!to.relationships.relatedTo.includes(from.id)) to.relationships.relatedTo.push(from.id);
        break;
      case 'BUILDS_ON':
        if (!from.relationships.buildsOn.includes(to.id)) from.relationships.buildsOn.push(to.id);
        break;
      default:
        // Ignore other types for master graph minimal schema
        break;
    }
  });
  return { nodes };
}

export async function loadGraphStore(fetchFn = fetch) {
  if (_nodes.length) return { nodes: _nodes }; // already loaded
  // Load legacy built-in graph.json
  const res = await fetchFn('data/graph.json');
  const legacy = await res.json();
  const rawConcepts = Array.isArray(legacy?.concepts) ? legacy.concepts : [];
  const rawRelationships = Array.isArray(legacy?.relationships) ? legacy.relationships : [];
  const migrated = migrateLegacyGraph(rawConcepts, rawRelationships);
  _nodes = migrated.nodes;
  _nodesById = new Map(_nodes.map(n => [n.id, n]));
  return migrated;
}

export function getAllNodes() { return _nodes.slice(); }
export function getNode(id) { return _nodesById.get(id) || null; }
export function getNeighbors(id) {
  const node = getNode(id);
  if (!node) return [];
  const nbrIds = new Set();
  node.relationships.buildsOn.forEach(b => nbrIds.add(b));
  node.relationships.relatedTo.forEach(r => nbrIds.add(r));
  if (node.relationships.partOf) nbrIds.add(node.relationships.partOf);
  // Also include children that point to this node via partOf (reverse lookup)
  _nodes.forEach(n => { if (n.relationships.partOf === id) nbrIds.add(n.id); });
  return Array.from(nbrIds).map(nid => getNode(nid)).filter(Boolean);
}

// Utility: build adjacency map (directed for buildsOn, undirected for relatedTo, parent-child for partOf)
export function buildAdjacency() {
  const adj = new Map();
  _nodes.forEach(n => adj.set(n.id, new Set()));
  _nodes.forEach(n => {
    n.relationships.buildsOn.forEach(t => { if (adj.has(n.id)) adj.get(n.id).add(t); });
    n.relationships.relatedTo.forEach(t => { if (adj.has(n.id)) { adj.get(n.id).add(t); } });
    if (n.relationships.partOf && adj.has(n.id)) {
      adj.get(n.id).add(n.relationships.partOf);
      if (adj.has(n.relationships.partOf)) adj.get(n.relationships.partOf).add(n.id);
    }
  });
  return adj;
}

// For future integration replacing existing graph.js consumers, we may expose a shim
export function graphStoreLoaded() { return _nodes.length > 0; }