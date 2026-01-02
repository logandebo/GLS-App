// Subtree Graph Renderer (Viewer + Editor modes)
// Provides pan/zoom, auto-layout fallback, SVG edges, and optional node dragging

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;
const X_SPACING = 260;
const Y_SPACING = 160;
const GRID_SIZE = 20;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export function renderSubtreeGraph(containerEl, tree, options = {}){
  const mode = options.mode || 'viewer';
  const onNodeClick = options.onNodeClick || (()=>{});
  const onSelect = options.onSelect || null;
  const isNodeLocked = options.isNodeLocked || (()=>false);
  const getNodeStatus = options.getNodeStatus || (()=>({ locked:false, visited:false, unlocked:true }));
  const getNodeTitle = options.getNodeTitle || (n => n.conceptId);
  const getNodeProgressPercent = options.getNodeProgressPercent || (()=>0);
  const getNodeIsEmpty = options.getNodeIsEmpty || (()=>false);
  const getNodeLessonCounts = options.getNodeLessonCounts || (()=>({ video:0, game:0, quiz:0 }));
  const getEdges = options.getEdges || (t => {
    const edges = [];
    (t.nodes||[]).forEach(n => (n.nextIds||[]).forEach(nx => edges.push({ from:n.conceptId, to:nx })));
    return edges;
  });

  containerEl.innerHTML = '';
  const viewport = document.createElement('div'); viewport.className = 'graph-viewport';
  const world = document.createElement('div'); world.className = 'graph-world';
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('class','graph-edges');
  const nodesEl = document.createElement('div'); nodesEl.className = 'graph-nodes';
  world.appendChild(svg); world.appendChild(nodesEl); viewport.appendChild(world); containerEl.appendChild(viewport);

  let transform = { x: 0, y: 0, scale: 1 };
  let draggingWorld = false; let dragStart = null;
  let nodeMap = new Map(); // conceptId -> { el, x, y }
  let selectedCid = null;
  let snapEnabled = options.snap !== undefined ? !!options.snap : true;

  function applyTransform(){
    world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }

  function worldPointFromViewport(x, y){
    const rect = viewport.getBoundingClientRect();
    const vx = x - rect.left - transform.x;
    const vy = y - rect.top - transform.y;
    return { x: vx / transform.scale, y: vy / transform.scale };
  }

  function onWheel(e){
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const targetScale = clamp(transform.scale + delta, MIN_SCALE, MAX_SCALE);
    const wp = worldPointFromViewport(e.clientX, e.clientY);
    const scaleRatio = targetScale / transform.scale;
    transform.x = e.clientX - wp.x * targetScale - viewport.getBoundingClientRect().left;
    transform.y = e.clientY - wp.y * targetScale - viewport.getBoundingClientRect().top;
    transform.scale = targetScale;
    applyTransform();
  }

  function onMouseDown(e){
    if (e.target.closest('.graph-node')) return; // don't pan when dragging node
    draggingWorld = true;
    dragStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  }
  function onMouseMove(e){
    if (!draggingWorld) return;
    const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y;
    transform.x = dragStart.tx + dx; transform.y = dragStart.ty + dy;
    applyTransform();
  }
  function onMouseUp(){ draggingWorld = false; }

  viewport.addEventListener('wheel', onWheel, { passive:false });
  viewport.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', () => { try { drawEdges(); } catch {} });

  function getPositions(){
    const pos = new Map();
    const nodes = (tree.nodes||[]);
    // Hybrid: use stored positions where available; auto-layout others
    const anyStored = nodes.some(n => n.ui && typeof n.ui.x === 'number' && typeof n.ui.y === 'number');
    const auto = computeAutoLayout(tree);
    auto.forEach((v,k) => pos.set(k,v));
    if (anyStored){ nodes.forEach(n => { if (n.ui && typeof n.ui.x === 'number' && typeof n.ui.y === 'number') pos.set(n.conceptId, { x:n.ui.x, y:n.ui.y }); }); }
    return pos;
  }

  function computeAutoLayout(t){
    const pos = new Map();
    const mode = (t.ui && t.ui.layoutMode) ? String(t.ui.layoutMode) : 'top-down';
    const children = new Map(); const parents = new Map();
    (t.nodes||[]).forEach(n => { children.set(n.conceptId, (n.nextIds||[]).slice()); (n.nextIds||[]).forEach(nx => { const p = parents.get(nx)||new Set(); p.add(n.conceptId); parents.set(nx,p); }); });
    const roots = (t.rootConceptId ? [t.rootConceptId] : (t.nodes||[]).map(n => n.conceptId).filter(cid => !(parents.get(cid)||new Set()).size));
    const visited = new Set(); const queue = []; roots.forEach(r => queue.push({ id:r, level:0 }));
    const levels = new Map();
    while(queue.length){ const { id, level } = queue.shift(); if (visited.has(id)) continue; visited.add(id);
      const arr = levels.get(level)||[]; arr.push(id); levels.set(level,arr);
      (children.get(id)||[]).forEach(nx => queue.push({ id:nx, level:level+1 }));
    }
    // Assign positions based on layout mode
    [...levels.entries()].forEach(([lvl, ids]) => {
      if (mode === 'top-down'){
        const xStart = -((ids.length - 1) * X_SPACING) / 2;
        ids.forEach((cid, idx) => pos.set(cid, { x: xStart + idx * X_SPACING, y: lvl * Y_SPACING }));
      } else {
        const yStart = -((ids.length - 1) * Y_SPACING) / 2;
        ids.forEach((cid, idx) => pos.set(cid, { x: lvl * X_SPACING, y: yStart + idx * Y_SPACING }));
      }
    });
    // Any disconnected nodes
    (t.nodes||[]).forEach(n => { if (!pos.has(n.conceptId)) pos.set(n.conceptId, { x: 0, y: 0 }); });
    return pos;
  }

  function renderNodes(){
    nodesEl.innerHTML=''; nodeMap.clear();
    const pos = getPositions();
    (tree.nodes||[]).forEach(n => {
      const el = document.createElement('div'); el.className = 'graph-node card';
      el.style.transform = `translate(${pos.get(n.conceptId).x}px, ${pos.get(n.conceptId).y}px)`;
      const title = document.createElement('div'); title.className='graph-node__title'; title.textContent = getNodeTitle(n);
      if (mode === 'editor'){
        const drag = document.createElement('div'); drag.className = 'graph-node__drag'; el.appendChild(drag);
      }
      const status = getNodeStatus(n);
      const badge = document.createElement('div'); badge.className='graph-node__badge';
      if (status.unbound){ el.classList.add('is-unbound'); badge.textContent = 'Unbound'; }
      else if (status.locked){ el.classList.add('is-locked'); badge.textContent = '🔒'; el.title = options.getLockedReason ? options.getLockedReason(n) : 'Locked: prerequisites not met.'; }
      else if (status.completed){ el.classList.add('is-visited'); badge.textContent = '✓'; }
      else { el.classList.add('is-unlocked'); badge.textContent = ''; }
      el.appendChild(title); el.appendChild(badge);
      if (mode === 'editor'){
        const c = getNodeLessonCounts(n) || { video:0, game:0, quiz:0, external:0 };
        const meta = document.createElement('div'); meta.className = 'graph-node__meta';
        if (c.video > 0){ const v = document.createElement('span'); v.className='chip'; v.textContent = `🎥 ${c.video}`; meta.appendChild(v); }
        if (c.game > 0){ const g = document.createElement('span'); g.className='chip'; g.textContent = `🎮 ${c.game}`; meta.appendChild(g); }
        if (c.quiz > 0){ const q = document.createElement('span'); q.className='chip'; q.textContent = `❓ ${c.quiz}`; meta.appendChild(q); }
        if (c.external > 0){ const e = document.createElement('span'); e.className='chip'; e.textContent = `🔗 ${c.external}`; meta.appendChild(e); }
        el.appendChild(meta);
      } else {
        // Progress bar (reuse existing course-progress styles)
        const progWrap = document.createElement('div'); progWrap.className = 'course-progress';
        const progBar = document.createElement('div'); progBar.className = 'course-progress__bar';
        const pct = Math.max(0, Math.min(100, Number(getNodeProgressPercent(n)) || 0));
        progBar.style.width = pct + '%';
        // If node has no non-game content, show grey full bar
        if (getNodeIsEmpty(n)) {
          progBar.style.width = '100%';
          progBar.style.background = '#6b7280';
        }
        progWrap.appendChild(progBar);
        el.appendChild(progWrap);
      }
      // Always notify click; viewer/editor decides behavior. Only mark clickable if actionable.
      el.addEventListener('click', () => {
        if (mode === 'editor'){
          selectedCid = n.conceptId;
          updateSelectionHighlight();
          if (onSelect) onSelect(n);
        }
        onNodeClick(n);
      });
      if (!status.locked && !status.unbound){ el.classList.add('clickable'); }
      nodesEl.appendChild(el);
      nodeMap.set(n.conceptId, { el, x: pos.get(n.conceptId).x, y: pos.get(n.conceptId).y });
    });
    drawEdges();
    // Draw again on next frame to account for late layout/ fonts
    try { window.requestAnimationFrame && window.requestAnimationFrame(() => drawEdges()); } catch {}
    if (mode === 'editor') attachDragHandlers();
  }

  function updateSelectionHighlight(){
    if (mode !== 'editor') return;
    nodeMap.forEach((v, cid) => {
      if (v.el){ if (cid === selectedCid) v.el.classList.add('is-selected'); else v.el.classList.remove('is-selected'); }
    });
  }

  function drawEdges(){
    // Compute edges based on node element centers
    const edges = getEdges(tree);
    svg.innerHTML='';

    const supportsCTM = typeof svg.getScreenCTM === 'function' && typeof svg.createSVGPoint === 'function';
    // Helper: convert screen coordinates to SVG coordinates via CTM
    function toSvgCoords(screenX, screenY){
      if (!supportsCTM) return { x: screenX, y: screenY };
      const pt = svg.createSVGPoint();
      pt.x = screenX; pt.y = screenY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: screenX, y: screenY };
      const inv = ctm.inverse();
      const p = pt.matrixTransform(inv);
      return { x: p.x, y: p.y };
    }

    if (supportsCTM){
      // Use DOM rects so positions reflect actual rendered boxes (including card padding)
      edges.forEach(e => {
        const from = nodeMap.get(e.from); const to = nodeMap.get(e.to);
        if (!from || !to) return;
        const fr = from.el.getBoundingClientRect();
        const tr = to.el.getBoundingClientRect();
        // Male link point (source): top center (screen coords)
        const fxS = fr.left + fr.width/2; const fyS = fr.top;
        // Female link point (target): bottom center (screen coords)
        const txS = tr.left + tr.width/2; const tyS = tr.bottom;
        const fSvg = toSvgCoords(fxS, fyS);
        const tSvg = toSvgCoords(txS, tyS);
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        line.setAttribute('x1', String(fSvg.x)); line.setAttribute('y1', String(fSvg.y));
        line.setAttribute('x2', String(tSvg.x)); line.setAttribute('y2', String(tSvg.y));
        line.setAttribute('class','graph-edge');
        svg.appendChild(line);
      });
      // Size SVG via viewBox to align with current world bounds
      const bounds = getNodeBounds();
      const vbX = bounds.minX - 100; const vbY = bounds.minY - 100;
      const vbW = bounds.width + 200; const vbH = bounds.height + 200;
      svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
      svg.setAttribute('width', String(vbW));
      svg.setAttribute('height', String(vbH));
      // Add a subtle boundary background so users can see the link region
      try {
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', String(vbX));
        rect.setAttribute('y', String(vbY));
        rect.setAttribute('width', String(vbW));
        rect.setAttribute('height', String(vbH));
        rect.setAttribute('fill', '#0b0f13'); // slightly darker than viewport bg (#0f1316)
        rect.setAttribute('stroke', '#1a232b');
        rect.setAttribute('stroke-width', '1');
        svg.insertBefore(rect, svg.firstChild);
      } catch {}
    } else {
      // Fallback: world-coordinate lines with matching viewBox origin
      edges.forEach(e => {
        const from = nodeMap.get(e.from); const to = nodeMap.get(e.to);
        if (!from || !to) return;
        const fw = from.el.offsetWidth; const tw = to.el.offsetWidth;
        const fh = from.el.offsetHeight; const th = to.el.offsetHeight;
        const fx = from.x + fw/2; const fy = from.y; // top center
        const tx = to.x + tw/2; const ty = to.y + th; // bottom center
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        line.setAttribute('x1', String(fx)); line.setAttribute('y1', String(fy));
        line.setAttribute('x2', String(tx)); line.setAttribute('y2', String(ty));
        line.setAttribute('class','graph-edge');
        svg.appendChild(line);
      });
      const bounds = getNodeBounds();
      const vbX = bounds.minX - 100; const vbY = bounds.minY - 100;
      const vbW = bounds.width + 200; const vbH = bounds.height + 200;
      svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
      svg.setAttribute('width', String(vbW));
      svg.setAttribute('height', String(vbH));
      // Subtle boundary background for fallback as well
      try {
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', String(vbX));
        rect.setAttribute('y', String(vbY));
        rect.setAttribute('width', String(vbW));
        rect.setAttribute('height', String(vbH));
        rect.setAttribute('fill', '#0b0f13');
        rect.setAttribute('stroke', '#1a232b');
        rect.setAttribute('stroke-width', '1');
        svg.insertBefore(rect, svg.firstChild);
      } catch {}
    }
    svg.style.transform = '';
  }

  function getNodeBounds(){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeMap.forEach(({ el, x, y }) => {
      const w = el.offsetWidth; const h = el.offsetHeight;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    });
    const width = Math.max(0, maxX - minX); const height = Math.max(0, maxY - minY);
    return { minX, minY, maxX, maxY, width, height };
  }

  function fitGraphToViewport(){
    const bounds = getNodeBounds();
    const vr = viewport.getBoundingClientRect();
    const scaleX = vr.width / (bounds.width + 200);
    const scaleY = vr.height / (bounds.height + 200);
    const s = clamp(Math.min(scaleX, scaleY), MIN_SCALE, MAX_SCALE);
    transform.scale = s;
    // center
    const cx = bounds.minX + bounds.width/2; const cy = bounds.minY + bounds.height/2;
    transform.x = vr.width/2 - cx * s; transform.y = vr.height/2 - cy * s;
    applyTransform();
  }

  function attachDragHandlers(){
    nodesEl.querySelectorAll('.graph-node').forEach(el => {
      const cid = [...nodeMap.entries()].find(([,v]) => v.el === el)[0];
      let dragging = false; let start = null;
      el.addEventListener('mousedown', (e) => {
        // Only start drag from the handle
        if (!(e.target && e.target.classList && e.target.classList.contains('graph-node__drag'))) return;
        dragging = true;
        start = { sx: e.clientX, sy: e.clientY, x: nodeMap.get(cid).x, y: nodeMap.get(cid).y };
        e.stopPropagation();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = (e.clientX - start.sx) / transform.scale; const dy = (e.clientY - start.sy) / transform.scale;
        let nx = start.x + dx; let ny = start.y + dy;
        nodeMap.get(cid).x = nx; nodeMap.get(cid).y = ny;
        el.style.transform = `translate(${nx}px, ${ny}px)`; drawEdges();
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return; dragging=false;
        const v = nodeMap.get(cid);
        let fx = v.x; let fy = v.y;
        if (snapEnabled){ fx = Math.round(fx / GRID_SIZE) * GRID_SIZE; fy = Math.round(fy / GRID_SIZE) * GRID_SIZE; v.x = fx; v.y = fy; el.style.transform = `translate(${fx}px, ${fy}px)`; drawEdges(); }
        options.onNodePositionChanged && options.onNodePositionChanged(cid, v.x, v.y);
      });
    });
  }

  // Initial render
  applyTransform();
  renderNodes();

  return {
    setGraphTransform(next){ transform = { ...transform, ...next }; applyTransform(); },
    fitGraphToViewport,
    setSnapEnabled(val){ snapEnabled = !!val; },
    getSelected(){ return selectedCid; },
    getNodePositions(){
      const out = new Map();
      nodeMap.forEach((v, cid) => { out.set(cid, { x: v.x, y: v.y }); });
      return out;
    },
    getTransform(){ return { ...transform }; }
  };
}
