// CreatorTreeStore: manages user-created learning subtree structures separate from Master Graph.
// Schema per instructions:
// {
//   id: string,
//   title: string,
//   description: string,
//   creatorId: string,
//   primaryDomain: string,
//   tags: string[],
//   rootConceptId: string,
//   nodes: [
//     {
//       conceptId: string,
//       nextIds: string[],
//       unlockConditions: {
//         requiredConceptIds: string[],
//         minBadge: string, // 'none' | 'bronze' | 'silver' | 'gold'
//         customRuleId?: string // future extension
//       }
//     }
//   ]
// }
// Stored per user under localStorage key: gep_creatorTrees_<userId>

import { generateCourseSlug } from './utils/slug.js';

const DEFAULT_MIN_BADGE = 'none';

function storageKey(userId) {
  return `gep_creatorTrees_${userId}`;
}

export function loadCreatorTrees(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

export function saveCreatorTrees(userId, trees) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(trees || []));
  } catch {}
}

function generateTreeId() {
  return 'tree_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function createCreatorTree(userId, meta) {
  const trees = loadCreatorTrees(userId);
  const tree = {
    id: generateTreeId(),
    slug: generateCourseSlug(meta?.title || 'course'),
    title: (meta?.title || 'Untitled Tree').trim(),
    description: meta?.description || '',
    creatorId: userId,
    primaryDomain: meta?.primaryDomain || 'general',
    tags: Array.isArray(meta?.tags) ? meta.tags.slice() : [],
    rootConceptId: meta?.rootConceptId || '',
    ui: { layoutMode: 'top-down' },
    nodes: []
  };
  // Ensure slug is set; keep stable unless user regenerates
  if (!tree.slug) tree.slug = generateCourseSlug(tree.title || 'course');
  trees.push(tree);
  saveCreatorTrees(userId, trees);
  return tree;
}

export function getCreatorTree(userId, treeId) {
  return loadCreatorTrees(userId).find(t => t.id === treeId) || null;
}

export function updateCreatorTree(userId, treeId, patch) {
  const trees = loadCreatorTrees(userId);
  const idx = trees.findIndex(t => t.id === treeId);
  if (idx === -1) return null;
  const next = { ...trees[idx], ...patch };
  // Do not allow overwriting nodes unless explicitly provided
  if (!patch.nodes) next.nodes = trees[idx].nodes;
  trees[idx] = next;
  saveCreatorTrees(userId, trees);
  return next;
}

export function deleteCreatorTree(userId, treeId) {
  const trees = loadCreatorTrees(userId);
  const filtered = trees.filter(t => t.id !== treeId);
  saveCreatorTrees(userId, filtered);
  return filtered.length !== trees.length;
}

function findNode(tree, conceptId) {
  return tree.nodes.find(n => n.conceptId === conceptId) || null;
}

export function addNodeToTree(userId, treeId, conceptId) {
  const trees = loadCreatorTrees(userId);
  const tree = trees.find(t => t.id === treeId);
  if (!tree) return null;
  if (findNode(tree, conceptId)) return tree; // already present
  const node = {
    conceptId,
    nextIds: [],
    unlockConditions: { requiredConceptIds: [], minBadge: DEFAULT_MIN_BADGE }
  };
  tree.nodes.push(node);
  if (!tree.rootConceptId) tree.rootConceptId = conceptId;
  saveCreatorTrees(userId, trees);
  return tree;
}

export function connectNodes(userId, treeId, fromConceptId, toConceptId) {
  const trees = loadCreatorTrees(userId);
  const tree = trees.find(t => t.id === treeId);
  if (!tree) return null;
  const fromNode = findNode(tree, fromConceptId);
  const toNode = findNode(tree, toConceptId);
  if (!fromNode || !toNode) return tree; // must exist first
  if (!fromNode.nextIds.includes(toConceptId)) fromNode.nextIds.push(toConceptId);
  saveCreatorTrees(userId, trees);
  return tree;
}

export function updateUnlockConditions(userId, treeId, conceptId, conditions) {
  const trees = loadCreatorTrees(userId);
  const tree = trees.find(t => t.id === treeId);
  if (!tree) return null;
  const node = findNode(tree, conceptId);
  if (!node) return tree;
  const nextCond = { ...node.unlockConditions };
  if (conditions.requiredConceptIds) nextCond.requiredConceptIds = conditions.requiredConceptIds.slice();
  if (conditions.minBadge) nextCond.minBadge = conditions.minBadge;
  if (conditions.customRuleId) nextCond.customRuleId = conditions.customRuleId;
  node.unlockConditions = nextCond;
  saveCreatorTrees(userId, trees);
  return tree;
}

// Set explicit nextIds for branching; replaces existing links for the node.
export function setNodeNextIds(userId, treeId, conceptId, nextIds) {
  const trees = loadCreatorTrees(userId);
  const tree = trees.find(t => t.id === treeId);
  if (!tree) return null;
  const node = findNode(tree, conceptId);
  if (!node) return tree;
  const unique = Array.isArray(nextIds) ? [...new Set(nextIds.filter(id => id && id !== conceptId))] : [];
  node.nextIds = unique;
  saveCreatorTrees(userId, trees);
  return tree;
}

// Basic validation: duplicates, unknown concepts, empty root, minBadge value
// masterById: Map of conceptId -> concept (from GraphStore)
export function validateCreatorTree(tree, masterById) {
  const errors = [];
  const seen = new Set();
  tree.nodes.forEach(n => {
    if (seen.has(n.conceptId)) errors.push(`Duplicate conceptId: ${n.conceptId}`); else seen.add(n.conceptId);
    if (!masterById.get(n.conceptId)) errors.push(`Unknown conceptId: ${n.conceptId}`);
    const badge = (n.unlockConditions?.minBadge || '').toLowerCase();
    if (badge && !['none','bronze','silver','gold'].includes(badge)) errors.push(`Invalid minBadge for ${n.conceptId}: ${badge}`);
    (n.unlockConditions?.requiredConceptIds || []).forEach(rc => {
      if (!masterById.get(rc)) errors.push(`Unknown requiredConceptId '${rc}' referenced by ${n.conceptId}`);
    });
    // Validate nextIds references
    (n.nextIds || []).forEach(nx => {
      if (nx === n.conceptId) errors.push(`Self link not allowed: ${n.conceptId}`);
      if (!tree.nodes.some(nn => nn.conceptId === nx)) errors.push(`nextId '${nx}' of ${n.conceptId} not found in tree nodes`);
      if (!masterById.get(nx)) errors.push(`nextId '${nx}' of ${n.conceptId} not found in Master Graph`);
    });
  });

  // Cycle detection across the whole graph (multi-root friendly)
  const adjacency = new Map();
  tree.nodes.forEach(n => adjacency.set(n.conceptId, (n.nextIds || []).slice()));
  const visiting = new Set();
  const visitedCycle = new Set();
  function dfsCycle(id) {
    if (visiting.has(id)) { errors.push(`Cycle detected involving ${id}`); return; }
    if (visitedCycle.has(id)) return;
    visiting.add(id);
    (adjacency.get(id) || []).forEach(next => dfsCycle(next));
    visiting.delete(id);
    visitedCycle.add(id);
  }
  tree.nodes.forEach(n => dfsCycle(n.conceptId));

  // Reachability detection from all start nodes (nodes with no parents). If none, skip unreachable check.
  const parents = new Map();
  tree.nodes.forEach(n => (n.nextIds || []).forEach(nx => {
    const p = parents.get(nx) || new Set();
    p.add(n.conceptId);
    parents.set(nx, p);
  }));
  const starts = tree.nodes.filter(n => !(parents.get(n.conceptId) || new Set()).size).map(n => n.conceptId);
  if (starts.length > 0) {
    const visited = new Set();
    function dfsReach(id){ if (visited.has(id)) return; visited.add(id); (adjacency.get(id) || []).forEach(next => dfsReach(next)); }
    starts.forEach(s => dfsReach(s));
    tree.nodes.forEach(n => { if (!visited.has(n.conceptId)) errors.push(`Unreachable node: ${n.conceptId}`); });
  }
  return { ok: errors.length === 0, errors };
}

// Export a single tree
export function exportCreatorTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

// Import a tree (optionally validate against master graph). Returns the created tree or throws.
export function importCreatorTree(userId, data, masterById) {
  if (!data || typeof data !== 'object') throw new Error('Invalid tree data');
  const tree = {
    id: generateTreeId(),
    slug: generateCourseSlug(data.title || 'course'),
    title: (data.title || 'Imported Tree').trim(),
    description: data.description || '',
    creatorId: userId,
    primaryDomain: data.primaryDomain || 'general',
    tags: Array.isArray(data.tags) ? data.tags.slice() : [],
    rootConceptId: data.rootConceptId || '',
    nodes: Array.isArray(data.nodes) ? data.nodes.map(n => ({
      conceptId: n.conceptId,
      nextIds: Array.isArray(n.nextIds) ? n.nextIds.slice() : [],
      unlockConditions: {
        requiredConceptIds: Array.isArray(n.unlockConditions?.requiredConceptIds) ? n.unlockConditions.requiredConceptIds.slice() : [],
        minBadge: n.unlockConditions?.minBadge || DEFAULT_MIN_BADGE,
        ...(n.unlockConditions?.customRuleId ? { customRuleId: n.unlockConditions.customRuleId } : {})
      }
    })) : []
  };
  if (!tree.slug) tree.slug = generateCourseSlug(tree.title || 'course');
  if (masterById) {
    const result = validateCreatorTree(tree, masterById);
    if (!result.ok) throw new Error('Tree validation failed: ' + result.errors.join('; '));
  }
  const trees = loadCreatorTrees(userId);
  trees.push(tree);
  saveCreatorTrees(userId, trees);
  return tree;
}

// Convenience: build a masterById map from GraphStore nodes
export function buildMasterIndex(nodes) {
  return new Map(nodes.map(n => [n.id, n]));
}

// TODO (future tasks): cycle detection, branching UI helpers, unlock evaluation engine.
