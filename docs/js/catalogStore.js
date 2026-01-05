// Catalog & Metrics helpers for published Creator Trees
import { loadCustomConcepts, loadPublicConcepts, savePublicConcepts } from './contentLoader.js';
import { graphStoreLoaded, getNode as getMasterNode } from './graphStore.js';
// Storage keys:
// - gep_publicCreatorTrees: array of published trees (global catalog)
// - gep_treeMetrics: map of treeId -> { views, starts, completions }

const CAT_NS = 'gep_publicCreatorTrees';
const MET_NS = 'gep_treeMetrics';

function nowIso() { return new Date().toISOString(); }

let _lastPublishMissingConceptIds = [];
export function getLastPublishMissingConceptIds(){ return Array.isArray(_lastPublishMissingConceptIds) ? _lastPublishMissingConceptIds.slice() : []; }

export function loadPublicCatalog() {
  try {
    const raw = localStorage.getItem(CAT_NS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    const list = Array.isArray(arr) ? arr : [];
    // Normalize legacy concept key casing in nodes when loading
    list.forEach(t => {
      if (!t || !Array.isArray(t.nodes)) return;
      t.nodes.forEach(n => {
        if (!n) return;
        if (!n.conceptId && n.conceptID){ n.conceptId = n.conceptID; delete n.conceptID; }
        if (!n.conceptId && n.concept_id){ n.conceptId = n.concept_id; delete n.concept_id; }
      });
      // Ensure ui
      t.ui = t.ui || { layoutMode: 'top-down' };
      if (!t.ui.layoutMode) t.ui.layoutMode = 'top-down';
    });
    return list;
  } catch {
    return [];
  }
}

export function savePublicCatalog(catalog) {
  try { localStorage.setItem(CAT_NS, JSON.stringify(Array.isArray(catalog) ? catalog : [])); } catch {}
}

export function loadTreeMetrics() {
  try {
    const raw = localStorage.getItem(MET_NS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const map = obj && typeof obj === 'object' ? obj : {};
    // Migrate legacy 'opens' -> 'views' once
    let migrated = false;
    Object.keys(map).forEach(k => {
      const m = map[k];
      if (m && typeof m === 'object' && Number.isFinite(m.opens)){
        const add = Number(m.opens) || 0;
        m.views = (Number(m.views) || 0) + add;
        delete m.opens;
        migrated = true;
      }
    });
    if (migrated) saveTreeMetrics(map);
    return map;
  } catch {
    return {};
  }
}

export function saveTreeMetrics(map) {
  try { localStorage.setItem(MET_NS, JSON.stringify(map && typeof map === 'object' ? map : {})); } catch {}
}

function normalizeMetrics(m) {
  const x = m && typeof m === 'object' ? m : {};
  return {
    views: Number.isFinite(x.views) ? x.views : 0,
    starts: Number.isFinite(x.starts) ? x.starts : 0,
    completions: Number.isFinite(x.completions) ? x.completions : 0
  };
}

export function incrementMetric(treeId, key, amount = 1) {
  const metrics = loadTreeMetrics();
  const cur = normalizeMetrics(metrics[treeId]);
  const next = { ...cur };
  if (key === 'views') next.views = cur.views + amount;
  else if (key === 'starts') next.starts = cur.starts + amount;
  else if (key === 'completions') next.completions = cur.completions + amount;
  metrics[treeId] = next;
  saveTreeMetrics(metrics);
  return next;
}

// Publish or update a tree into global catalog.
// Expects a tree object conforming to creatorTreeStore schema.
export function publishTree(tree) {
  if (!tree || typeof tree !== 'object') throw new Error('Invalid tree');
  const catalog = loadPublicCatalog();
  const idx = catalog.findIndex(t => t.id === tree.id);
  const base = {
    id: tree.id,
    title: tree.title || 'Untitled Tree',
    description: tree.description || '',
    creatorId: tree.creatorId || 'unknown',
    primaryDomain: tree.primaryDomain || 'general',
    tags: Array.isArray(tree.tags) ? tree.tags.slice() : [],
    rootConceptId: tree.rootConceptId || '',
    introVideoUrl: tree.introVideoUrl || '',
    ui: {
      layoutMode: (tree.ui && tree.ui.layoutMode) ? String(tree.ui.layoutMode) : 'top-down'
    },
    nodes: Array.isArray(tree.nodes) ? tree.nodes.map(n => ({
      conceptId: n.conceptId,
      nextIds: Array.isArray(n.nextIds) ? n.nextIds.slice() : [],
      ...(Array.isArray(n.subtreeLessonIds) ? { subtreeLessonIds: n.subtreeLessonIds.slice() } : {}),
      ...(n.subtreeLessonSteps && typeof n.subtreeLessonSteps === 'object' ? { subtreeLessonSteps: { ...n.subtreeLessonSteps } } : {}),
      ...(n.ui ? { ui: { x: Number(n.ui.x)||0, y: Number(n.ui.y)||0 } } : {}),
      unlockConditions: {
        requiredConceptIds: Array.isArray(n.unlockConditions?.requiredConceptIds) ? n.unlockConditions.requiredConceptIds.slice() : [],
        minBadge: n.unlockConditions?.minBadge || 'none',
        ...(n.unlockConditions?.customRuleId ? { customRuleId: n.unlockConditions.customRuleId } : {})
      }
    })) : [],
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (idx === -1) {
    catalog.push(base);
  } else {
    const prev = catalog[idx];
    catalog[idx] = {
      ...base,
      version: (Number(prev.version) || 1) + 1,
      createdAt: prev.createdAt || base.createdAt,
      updatedAt: nowIso()
    };
  }
  savePublicCatalog(catalog);
  // Initialize metrics entry if missing
  const metrics = loadTreeMetrics();
  if (!metrics[tree.id]) {
    metrics[tree.id] = normalizeMetrics({});
    saveTreeMetrics(metrics);
  }
  // Dependency sync: publish referenced custom concepts to public catalog
  try {
    const publicConcepts = loadPublicConcepts();
    const custom = loadCustomConcepts();
    const customById = new Map((Array.isArray(custom) ? custom : []).map(c => [c.id, c]));
    const conceptIds = (Array.isArray(base.nodes) ? base.nodes : []).map(n => n.conceptId).filter(Boolean);
    const missing = [];
    conceptIds.forEach(cid => {
      if (customById.has(cid)) {
        publicConcepts[cid] = customById.get(cid);
      } else {
        // If Master Graph is loaded and concept missing there, mark as missing; else assume built-in
        if (graphStoreLoaded && graphStoreLoaded()) {
          const m = getMasterNode(cid);
          if (!m) missing.push(cid);
        }
      }
    });
    savePublicConcepts(publicConcepts);
    _lastPublishMissingConceptIds = missing;
  } catch (e) {
    // Do not block publish; record missing as empty
    _lastPublishMissingConceptIds = [];
  }
  return catalog.find(t => t.id === tree.id);
}

export function unpublishTree(treeId) {
  const catalog = loadPublicCatalog();
  const next = catalog.filter(t => t.id !== treeId);
  savePublicCatalog(next);
  return next.length !== catalog.length;
}

export function getQueryParam(name) {
  const sp = new URLSearchParams(window.location.search);
  return sp.get(name);
}
