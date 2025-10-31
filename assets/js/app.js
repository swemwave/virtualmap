const nodeSelect = document.getElementById('nodeSelect');
const filterSelect = document.getElementById('filterSelect');
const fullscreenButton = document.getElementById('fullscreenButton');
const prevStepButton = document.getElementById('prevStep');
const nextStepButton = document.getElementById('nextStep');
const connectionsContainer = document.getElementById('connections');
const metadataPanel = document.getElementById('metadataPanel');
const floorplanImage = document.getElementById('floorplanImage');
const floorplanMarkers = document.getElementById('floorplanMarkers');
const floorplanContainer = document.getElementById('floorplan');
const floorplanGraph = document.getElementById('floorplanGraph');
const floorplanSummary = document.getElementById('floorplanSummary');
const dirController = document.getElementById('directionController');
const dirLeftBtn = document.getElementById('dirLeft');
const dirRightBtn = document.getElementById('dirRight');
const dirForwardBtn = document.getElementById('dirForward');
const dirBackBtn = document.getElementById('dirBack');

let viewer;
let data;
let nodes = [];
let nodesById = new Map();
let currentNodeId;
let floorplanDimensions = { width: 1, height: 1 };
let lastNodeId = null; // track navigation origin for alignment
const orientation = { yawOffset: 0, calibrated: false };
let layoutPositions = new Map();
const directionBuckets = {
  forward: [],
  right: [],
  left: [],
  back: []
};
const directionIndices = {
  forward: 0,
  right: 0,
  left: 0,
  back: 0
};
const directionButtons = {
  forward: dirForwardBtn,
  right: dirRightBtn,
  left: dirLeftBtn,
  back: dirBackBtn
};

function getWorldPosition(nodeId) {
  const node = nodesById.get(nodeId);
  if (node?.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
    return node.position;
  }
  const layoutPos = layoutPositions.get(nodeId);
  if (layoutPos) {
    return {
      x: layoutPos.x / (floorplanDimensions.width || 1),
      y: layoutPos.y / (floorplanDimensions.height || 1)
    };
  }
  return null;
}

init();

async function init() {
  try {
    const response = await fetch('data/panorama-map.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load map data: ${response.status} ${response.statusText}`);
    }
    data = await response.json();
    nodes = (data.nodes ?? []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (!nodes.length) {
      renderError('The panorama map does not contain any nodes yet. Add entries to data/panorama-map.json.');
      return;
    }

    nodesById = new Map(nodes.map((node) => [node.id, node]));
    const layoutResult = computeGraphLayout(nodes);
    layoutPositions = layoutResult.positions;
    floorplanDimensions = layoutResult.dimensions;
    orientation.calibrated = false;
    orientation.yawOffset = 0;

    setupFloorplan(data.meta?.floorplan);
    renderNodeOptions(filterSelect.value);
    createMarkers();
    setupViewer();
    bindEvents();
    const firstNode = nodeSelect.value || nodes[0].id;
    selectNode(firstNode, { updateViewer: false });
  } catch (error) {
    console.error(error);
    renderError(error.message);
  }
}

function setupViewer() {
  const scenes = {};
  for (const node of nodes) {
    scenes[node.id] = createSceneFromNode(node);
  }

  const firstScene = nodeSelect.value || nodes[0].id;
  viewer = pannellum.viewer('panorama', {
    default: {
      firstScene,
      author: 'StanGrad Mapping Project',
      sceneFadeDuration: 800,
      autoLoad: true
    },
    scenes
  });

  viewer.on('scenechange', (sceneId) => {
    selectNode(sceneId, { updateViewer: false });
  });

  viewer.on?.('load', () => { calibrateOrientationIfNeeded(); updateDirectionController(); });
  viewer.on?.('viewchange', () => updateDirectionController());
}

function bindEvents() {
  nodeSelect.addEventListener('change', (event) => {
    selectNode(event.target.value, { prevId: currentNodeId });
  });

  filterSelect.addEventListener('change', (event) => {
    renderNodeOptions(event.target.value);
    createMarkers();
    const filteredNodes = getFilteredNodes();
    if (filteredNodes.length) {
      const nextNodeId = filteredNodes.some((node) => node.id === currentNodeId)
        ? currentNodeId
        : filteredNodes[0].id;
      selectNode(nextNodeId);
    }
  });

  fullscreenButton.addEventListener('click', () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      root.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  nextStepButton?.addEventListener('click', () => stepSequence(1));
  prevStepButton?.addEventListener('click', () => stepSequence(-1));

  // Keyboard controls: ArrowRight/ArrowUp = next, ArrowLeft/ArrowDown = prev
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'Right': // legacy
      case 'ArrowUp':
      case 'Up':
        if (e.key === 'ArrowRight' || e.key === 'Right') {
          useDirection('right');
        } else {
          useDirection('forward');
        }
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'Left':
      case 'ArrowDown':
      case 'Down':
        if (e.key === 'ArrowLeft' || e.key === 'Left') {
          useDirection('left');
        } else {
          useDirection('back');
        }
        e.preventDefault();
        break;
      default:
        break;
    }
  });

  dirForwardBtn?.addEventListener('click', () => useDirection('forward'));
  dirRightBtn?.addEventListener('click', () => useDirection('right'));
  dirLeftBtn?.addEventListener('click', () => useDirection('left'));
  dirBackBtn?.addEventListener('click', () => useDirection('back'));
}

function selectNode(nodeId, options = { updateViewer: true, prevId: null }) {
  if (!nodesById.has(nodeId)) {
    console.warn(`Unknown node id: ${nodeId}`);
    return;
  }

  lastNodeId = options.prevId ?? currentNodeId ?? null;
  currentNodeId = nodeId;
  nodeSelect.value = nodeId;
  if (nodeSelect.value !== nodeId) {
    filterSelect.value = 'all';
    renderNodeOptions('all');
    createMarkers();
    nodeSelect.value = nodeId;
  }

  if (options.updateViewer !== false) {
    const node = nodesById.get(nodeId);
    const pitch = node?.defaultView?.pitch;
    const hfov = node?.defaultView?.hfov;
    const yawAligned = computeAlignedYaw(options.prevId, nodeId, node?.defaultView?.yaw);
    viewer?.loadScene?.(nodeId, pitch, yawAligned, hfov);
  }

  updateMetadata();
  renderConnections();
  highlightMarker(nodeId);
  updateStepButtons();
  updateRouteTrace(lastNodeId, nodeId);
  calibrateOrientationIfNeeded();
  updateDirectionController();
}

function computeAlignedYaw(prevId, currId, fallbackYaw) {
  if (!prevId || !nodesById.has(prevId) || !nodesById.has(currId)) {
    return Number.isFinite(fallbackYaw) ? worldYawToViewerYaw(fallbackYaw) : fallbackYaw;
  }
  const prevPos = getWorldPosition(prevId);
  const currPos = getWorldPosition(currId);
  if (!prevPos || !currPos) return fallbackYaw;
  const dx = currPos.x - prevPos.x;
  const dy = -(currPos.y - prevPos.y);
  const angleRad = Math.atan2(dy, dx);
  let yaw = angleRad * 180 / Math.PI; // degrees
  yaw = (yaw % 360 + 360) % 360;
  return worldYawToViewerYaw(yaw);
}

function stepSequence(direction) {
  const curr = nodesById.get(currentNodeId);
  if (!curr) return;
  const neighbors = Array.isArray(curr.connections) ? curr.connections : [];
  if (!neighbors.length) return;
  const next = pickNeighborBySequence(curr, neighbors, direction);
  if (!next) return;
  selectNode(next.id, { prevId: currentNodeId });
}

function pickNeighborBySequence(curr, neighborIds, direction) {
  const currSeq = typeof curr.sequence === 'number' ? curr.sequence : 0;
  const candidates = neighborIds
    .map((id) => nodesById.get(id))
    .filter(Boolean)
    .map((n) => ({ id: n.id, seq: typeof n.sequence === 'number' ? n.sequence : Number.NaN }))
    .filter((n) => Number.isFinite(n.seq));
  if (!candidates.length) return null;
  if (direction > 0) {
    // forward: smallest sequence greater than current
    const forwards = candidates.filter((c) => c.seq > currSeq);
    if (forwards.length) return forwards.sort((a, b) => a.seq - b.seq)[0];
    // dead end in forward direction
    return null;
  } else {
    // backward: largest sequence less than current
    const backwards = candidates.filter((c) => c.seq < currSeq);
    if (backwards.length) return backwards.sort((a, b) => b.seq - a.seq)[0];
    return null;
  }
}

function updateStepButtons() {
  const curr = nodesById.get(currentNodeId);
  if (!curr) {
    if (nextStepButton) nextStepButton.disabled = true;
    if (prevStepButton) prevStepButton.disabled = true;
    return;
  }
  const neighbors = Array.isArray(curr.connections) ? curr.connections : [];
  const forward = pickNeighborBySequence(curr, neighbors, 1);
  const backward = pickNeighborBySequence(curr, neighbors, -1);
  if (nextStepButton) nextStepButton.disabled = !forward;
  if (prevStepButton) prevStepButton.disabled = !backward;
}

function updateDirectionController() {
  if (!dirController) return;
  const curr = nodesById.get(currentNodeId);
  if (!curr) {
    dirController.style.display = 'none';
    return;
  }
  const neighbors = Array.isArray(curr.connections)
    ? curr.connections.map((id) => nodesById.get(id)).filter(Boolean)
    : [];
  if (!neighbors.length) {
    dirController.style.display = 'none';
    return;
  }

  const viewYaw = normalizeYaw(viewer?.getYaw?.());
  const buckets = categorizeNeighbors(curr, neighbors, viewYaw);
  let anyEnabled = false;

  for (const direction of Object.keys(directionButtons)) {
    directionBuckets[direction] = buckets[direction] ?? [];
    directionIndices[direction] = 0;
    const button = directionButtons[direction];
    const list = directionBuckets[direction];
    if (!button) continue;
    if (list.length) {
      button.disabled = false;
      button.title = list.map((entry) => entry.label || entry.id).join(', ');
      if (list.length > 1) {
        button.dataset.count = String(list.length);
      } else {
        button.removeAttribute('data-count');
      }
      anyEnabled = true;
    } else {
      button.disabled = true;
      button.removeAttribute('title');
      button.removeAttribute('data-count');
    }
  }

  dirController.style.display = anyEnabled ? '' : 'none';
}

function categorizeNeighbors(curr, neighbors, viewYaw) {
  const result = {
    forward: [],
    right: [],
    left: [],
    back: []
  };
  for (const nb of neighbors) {
    const yawTo = worldYawToViewerYaw(computeYawBetween(curr.id, nb.id));
    const delta = deltaYaw(viewYaw, yawTo);
    const abs = Math.abs(delta);
    let bucket;
    if (abs <= 45) {
      bucket = 'forward';
    } else if (abs >= 135) {
      bucket = 'back';
    } else if (delta > 0) {
      bucket = 'right';
    } else {
      bucket = 'left';
    }
    const label = Number.isFinite(nb.sequence)
      ? `${nb.sequence}: ${nb.title ?? nb.id}`
      : nb.title ?? nb.id;
    result[bucket].push({ id: nb.id, label, delta, yaw: yawTo });
  }

  for (const dir of Object.keys(result)) {
    result[dir].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  }

  return result;
}

function useDirection(direction) {
  const entries = directionBuckets[direction] || [];
  if (!entries.length) return;
  const currentIndex = directionIndices[direction] ?? 0;
  const entry = entries[currentIndex % entries.length];
  directionIndices[direction] = (currentIndex + 1) % entries.length;
  selectNode(entry.id, { prevId: currentNodeId });
}

function normalizeYaw(yaw) {
  if (!Number.isFinite(yaw)) return 0;
  let y = yaw % 360;
  if (y < 0) y += 360;
  return y;
}

function deltaYaw(fromYaw, toYaw) {
  const a = normalizeYaw(fromYaw);
  const b = normalizeYaw(toYaw);
  let d = b - a;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

function updateMetadata() {
  const node = nodesById.get(currentNodeId);
  if (!node) {
    metadataPanel.innerHTML = '';
    return;
  }

  const features = Array.isArray(node.features) && node.features.length
    ? `<p class="meta__features"><strong>Tags:</strong> ${node.features.join(', ')}</p>`
    : '';
  const levelLabel = node.level ? `<p class="meta__level">Level ${node.level}</p>` : '';
  const sequenceLabel = typeof node.sequence === 'number'
    ? `<p class="meta__sequence">Panorama ${node.sequence} of ${nodes.length}</p>`
    : '';

  metadataPanel.innerHTML = `
    <h2 class="meta__title">${node.title ?? node.id}</h2>
    <p class="meta__type">${formatType(node.type)}</p>
    <p class="meta__description">${node.description ?? 'No description provided yet.'}</p>
    ${levelLabel}
    ${sequenceLabel}
    ${features}
  `;
}

function renderConnections() {
  const node = nodesById.get(currentNodeId);
  connectionsContainer.innerHTML = '';
  if (!node || !Array.isArray(node.connections) || !node.connections.length) {
    const placeholder = document.createElement('p');
    placeholder.className = 'connections__empty';
    placeholder.textContent = 'No adjacent panoramas linked yet. Extend the graph in data/panorama-map.json.';
    connectionsContainer.appendChild(placeholder);
    return;
  }

  for (const targetId of node.connections) {
    if (!nodesById.has(targetId)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'connection-button';
    button.textContent = nodesById.get(targetId).title ?? targetId;
    button.addEventListener('click', () => selectNode(targetId, { prevId: currentNodeId }));
    connectionsContainer.appendChild(button);
  }
}

// --- Route trace ---
let routeTraceEdges = new Set();

function updateRouteTrace(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const from = nodesById.get(fromId);
  const to = nodesById.get(toId);
  if (!from || !to) return;
  // Only trace along actual connections
  if (!Array.isArray(from.connections) || !from.connections.includes(toId)) return;
  const key = [fromId, toId].sort().join('|');
  if (routeTraceEdges.has(key)) {
    applyTraceStyles([key]);
    return;
  }
  routeTraceEdges.add(key);
  applyTraceStyles([key]);
}

function applyTraceStyles(keys) {
  if (!floorplanGraph) return;
  for (const key of keys) {
    const edge = floorplanGraph.querySelector(`[data-edge-key="${key}"]`);
    if (edge) edge.classList.add('floorplan__edge--trace');
  }
}

function setupFloorplan(floorplan) {
  const fallbackSrc = 'assets/images/floorplan-placeholder.svg';
  const fallbackAlt = 'Floor plan placeholder';
  if (!layoutPositions.size) {
    floorplanDimensions = { width: 1, height: 1 };
  }
  if (floorplanImage) {
    floorplanImage.style.display = 'none';
  }
  if (!floorplan) {
    floorplanImage.src = fallbackSrc;
    floorplanImage.alt = fallbackAlt;
    floorplanContainer?.setAttribute('aria-label', 'Top-down map placeholder');
    updateFloorplanSummary(null);
    configureFloorplanGraph(floorplanDimensions.width, floorplanDimensions.height);
    return;
  }

  const width = Number(floorplan.width) || 100;
  const height = Number(floorplan.height) || 100;
  const resolvedWidth = layoutPositions.size ? floorplanDimensions.width : width;
  const resolvedHeight = layoutPositions.size ? floorplanDimensions.height : height;
  floorplanDimensions = { width: resolvedWidth, height: resolvedHeight };
  floorplanImage.src = floorplan.image ?? fallbackSrc;
  floorplanImage.alt = floorplan.alt ?? 'Floor plan overview';
  const levelInfo = Array.isArray(floorplan.levels) && floorplan.levels.length
    ? floorplan.levels.map((level) => level.label ?? `Level ${level.floor ?? ''}`).join(', ')
    : null;
  const ariaLabel = levelInfo
    ? `Top-down map of ${levelInfo}`
    : 'Top-down map of the current floor';
  floorplanContainer?.setAttribute('aria-label', ariaLabel);
  updateFloorplanSummary(floorplan);
  configureFloorplanGraph(floorplanDimensions.width, floorplanDimensions.height);
}

function createMarkers() {
  floorplanMarkers.innerHTML = '';
  createFloorplanEdges();
  const filtered = getFilteredNodes();
  for (const node of nodes) {
    if (!layoutPositions.has(node.id)) continue;
    const coords = toFloorplanCoordinates(node.id);
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'floorplan__marker';
    marker.style.left = `${coords.x}%`;
    marker.style.top = `${coords.y}%`;
    marker.dataset.nodeId = node.id;
    marker.title = node.title ?? node.id;
    if (Number.isFinite(node.sequence)) {
      marker.textContent = String(node.sequence);
    }
    marker.addEventListener('click', () => selectNode(node.id));
    if (!filtered.some((filteredNode) => filteredNode.id === node.id)) {
      marker.style.opacity = '0.35';
    }
    floorplanMarkers.appendChild(marker);
  }
  highlightMarker(currentNodeId);
}

function highlightMarker(nodeId) {
  let active = false;
  for (const marker of floorplanMarkers.querySelectorAll('.floorplan__marker')) {
    if (marker.dataset.nodeId === nodeId) {
      marker.classList.add('floorplan__marker--active');
      marker.setAttribute('aria-current', 'true');
      active = true;
    } else {
      marker.classList.remove('floorplan__marker--active');
      marker.removeAttribute('aria-current');
    }
  }
  highlightEdges(active ? nodeId : null);
}

function createSceneFromNode(node) {
  const hotSpots = [];
  if (Array.isArray(node.connections) && node.connections.length) {
    for (const neighborId of node.connections) {
      const neighbor = nodesById.get(neighborId);
      if (!getWorldPosition(node.id) || !getWorldPosition(neighborId)) continue;
      const yaw = worldYawToViewerYaw(computeYawBetween(node.id, neighborId));
      hotSpots.push({
        pitch: 0,
        yaw,
        type: 'scene',
        text: neighbor.title ?? neighbor.id,
        sceneId: neighbor.id,
        targetYaw: computeAlignedYaw(node.id, neighbor.id, yaw),
        cssClass: 'hotspot-arrow'
      });
    }
  }

  return {
    type: 'equirectangular',
    panorama: node.image,
    title: node.title,
    pitch: node.defaultView?.pitch ?? 0,
    yaw: node.defaultView?.yaw ?? 0,
    hfov: node.defaultView?.hfov ?? 105,
    autoLoad: true,
    compass: true,
    hotSpots
  };
}

function getFilteredNodes() {
  const filter = filterSelect.value;
  if (!filter || filter === 'all') {
    return nodes;
  }
  return nodes.filter((node) => node.type === filter);
}

function computeYawBetween(fromId, toId) {
  const fromPos = getWorldPosition(fromId);
  const toPos = getWorldPosition(toId);
  if (!fromPos || !toPos) return 0;
  const dx = toPos.x - fromPos.x;
  const dy = -(toPos.y - fromPos.y); // invert axis because data Y grows downward
  let yaw = Math.atan2(dy, dx) * 180 / Math.PI;
  yaw = (yaw % 360 + 360) % 360;
  return yaw;
}

function worldYawToViewerYaw(y) {
  return normalizeYaw((y ?? 0) + (orientation.yawOffset ?? 0));
}

function calibrateOrientationIfNeeded() {
  if (orientation.calibrated) return;
  const curr = nodesById.get(currentNodeId);
  if (!curr) return;
  const neighborObjs = Array.isArray(curr.connections) ? curr.connections.map((id) => nodesById.get(id)).filter(Boolean) : [];
  if (!neighborObjs.length) return;
  const currentViewYaw = viewer?.getYaw?.();
  if (!Number.isFinite(currentViewYaw)) return;
  const viewYaw = normalizeYaw(currentViewYaw);
  // Prefer forward sequence neighbor
  const forward = pickNeighborBySequence(curr, curr.connections ?? [], 1);
  const anchor = forward ? nodesById.get(forward.id) : pickClosestByYaw(curr, neighborObjs, viewYaw);
  if (!anchor) return;
  const worldYawToAnchor = computeYawBetween(curr.id, anchor.id);
  const offset = normalizeYaw(viewYaw) - normalizeYaw(worldYawToAnchor);
  orientation.yawOffset = offset;
  orientation.calibrated = true;
}

function pickClosestByYaw(curr, neighbors, viewYaw) {
  let best = null;
  let minAbs = Infinity;
  for (const nb of neighbors) {
    const yawTo = worldYawToViewerYaw(computeYawBetween(curr.id, nb.id));
    const d = Math.abs(deltaYaw(viewYaw, yawTo));
    if (d < minAbs) { minAbs = d; best = nb; }
  }
  return best;
}

function computeGraphLayout(nodeList) {
  if (!nodeList.length) {
    return { positions: new Map(), dimensions: { width: 100, height: 100 } };
  }

  const positions = new Map();
  const anchors = new Map();
  const nodeCount = nodeList.length;
  const angleStep = (2 * Math.PI) / nodeCount;
  const baseSize = 100;
  const jitter = () => (Math.random() - 0.5) * 1.5;
  nodeList.forEach((node, index) => {
    let anchorX;
    let anchorY;
    if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
      anchorX = node.position.x * baseSize;
      anchorY = (1 - node.position.y) * baseSize; // flip so higher Y is higher on map
    } else {
      const angle = angleStep * index;
      anchorX = Math.cos(angle) * (baseSize * 0.35) + baseSize * 0.5;
      anchorY = Math.sin(angle) * (baseSize * 0.35) + baseSize * 0.5;
    }
    anchors.set(node.id, { x: anchorX, y: anchorY });
    positions.set(node.id, {
      x: anchorX + jitter(),
      y: anchorY + jitter()
    });
  });

  const edges = [];
  const seen = new Set();
  for (const node of nodeList) {
    if (!Array.isArray(node.connections)) continue;
    for (const neighborId of node.connections) {
      if (!nodesById.has(neighborId)) continue;
      const key = node.id < neighborId ? `${node.id}|${neighborId}` : `${neighborId}|${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([node.id, neighborId]);
    }
  }

  const area = baseSize * baseSize;
  const k = Math.sqrt(area / Math.max(1, nodeCount));
  let temperature = 0.3;
  const iterations = Math.min(800, 150 + nodeCount * 3);
  const anchorStrength = 0.05;

  for (let iter = 0; iter < iterations; iter += 1) {
    const disps = new Map(nodeList.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodeCount; i += 1) {
      const nodeA = nodeList[i];
      const posA = positions.get(nodeA.id);
      for (let j = i + 1; j < nodeCount; j += 1) {
        const nodeB = nodeList[j];
        const posB = positions.get(nodeB.id);
        let dx = posA.x - posB.x;
        let dy = posA.y - posB.y;
        let dist = Math.hypot(dx, dy) || 0.0001;
        const repulse = (k * k) / dist;
        dx /= dist;
        dy /= dist;
        const dispA = disps.get(nodeA.id);
      const dispB = disps.get(nodeB.id);
      dispA.x += dx * repulse;
      dispA.y += dy * repulse;
      dispB.x -= dx * repulse;
      dispB.y -= dy * repulse;
    }
  }

  for (const [aId, bId] of edges) {
      const posA = positions.get(aId);
      const posB = positions.get(bId);
      let dx = posA.x - posB.x;
      let dy = posA.y - posB.y;
      let dist = Math.hypot(dx, dy) || 0.0001;
      const attract = (dist * dist) / k;
      dx /= dist;
      dy /= dist;
      const dispA = disps.get(aId);
      const dispB = disps.get(bId);
      dispA.x -= dx * attract;
      dispA.y -= dy * attract;
      dispB.x += dx * attract;
      dispB.y += dy * attract;
    }

  for (const node of nodeList) {
    const disp = disps.get(node.id);
    const anchor = anchors.get(node.id);
    if (anchor) {
      const pos = positions.get(node.id);
      disp.x += (anchor.x - pos.x) * anchorStrength;
      disp.y += (anchor.y - pos.y) * anchorStrength;
    }
    let dispLength = Math.hypot(disp.x, disp.y) || 0.0001;
    const pos = positions.get(node.id);
    pos.x += (disp.x / dispLength) * Math.min(dispLength, temperature);
    pos.y += (disp.y / dispLength) * Math.min(dispLength, temperature);
  }

    temperature *= 0.92;
  }

  // Rotate layout so that the first sequence edge points East for consistency
  const root = nodeList[0];
  const rootPos = positions.get(root.id);
  if (rootPos) {
    const nextId = Array.isArray(root.connections)
      ? root.connections.find((id) => positions.has(id))
      : null;
    if (nextId) {
      const nextPos = positions.get(nextId);
      const dx = nextPos.x - rootPos.x;
      const dy = nextPos.y - rootPos.y;
      const currentAngle = Math.atan2(dy, dx);
      const rotateBy = -currentAngle;
      positions.forEach((pos) => {
        const x = pos.x - rootPos.x;
        const y = pos.y - rootPos.y;
        const rotatedX = x * Math.cos(rotateBy) - y * Math.sin(rotateBy);
        const rotatedY = x * Math.sin(rotateBy) + y * Math.cos(rotateBy);
        pos.x = rotatedX + rootPos.x;
        pos.y = rotatedY + rootPos.y;
      });
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  positions.forEach((pos) => {
    if (pos.x < minX) minX = pos.x;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.y > maxY) maxY = pos.y;
  });

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  let scaledWidth;
  let scaledHeight;

  if (spanX >= spanY) {
    scaledWidth = baseSize;
    scaledHeight = (spanY / spanX) * baseSize;
  } else {
    scaledHeight = baseSize;
    scaledWidth = (spanX / spanY) * baseSize;
  }

  const padding = baseSize * 0.08;
  scaledWidth += padding * 2;
  scaledHeight += padding * 2;

  positions.forEach((pos) => {
    const normalizedX = (pos.x - minX) / spanX;
    const normalizedY = (pos.y - minY) / spanY;
    pos.x = normalizedX * (scaledWidth - padding * 2) + padding;
    pos.y = normalizedY * (scaledHeight - padding * 2) + padding;
  });

  return {
    positions,
    dimensions: {
      width: scaledWidth,
      height: scaledHeight
    }
  };
}

function renderNodeOptions(filter) {
  const filtered = filter === 'all' ? nodes : nodes.filter((node) => node.type === filter);
  nodeSelect.innerHTML = '';
  for (const node of filtered) {
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = node.title ?? node.id;
    if (node.id === currentNodeId) {
      option.selected = true;
    }
    nodeSelect.appendChild(option);
  }
  if (filtered.length === 0) {
    const option = document.createElement('option');
    option.disabled = true;
    option.textContent = 'No locations match this filter';
    nodeSelect.appendChild(option);
  }
}

function formatType(type) {
  if (!type) return 'Uncategorized location';
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} node`;
}

function toFloorplanCoordinates(nodeId) {
  const pos = layoutPositions.get(nodeId);
  if (!pos) return { x: 0, y: 0 };
  return {
    x: (pos.x / floorplanDimensions.width) * 100,
    y: (pos.y / floorplanDimensions.height) * 100,
    absX: pos.x,
    absY: pos.y
  };
}

function configureFloorplanGraph(width, height) {
  if (!floorplanGraph) return;
  floorplanGraph.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (floorplanContainer) {
    floorplanContainer.style.aspectRatio = `${Math.max(width, 1)} / ${Math.max(height, 1)}`;
  }
  clearFloorplanGraph();
}

function clearFloorplanGraph() {
  if (!floorplanGraph) return;
  floorplanGraph.innerHTML = '';
}

function createFloorplanEdges() {
  if (!floorplanGraph) return;
  clearFloorplanGraph();
  const rendered = new Set();
  for (const node of nodes) {
    if (!Array.isArray(node.connections)) continue;
    const source = toFloorplanCoordinates(node.id);
    for (const targetId of node.connections) {
      const key = [node.id, targetId].sort().join('|');
      if (rendered.has(key)) continue;
      const target = nodesById.get(targetId);
      if (!target) continue;
      const targetPoint = toFloorplanCoordinates(targetId);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', source.absX);
      line.setAttribute('y1', source.absY);
      line.setAttribute('x2', targetPoint.absX);
      line.setAttribute('y2', targetPoint.absY);
      line.classList.add('floorplan__edge');
      line.dataset.edgeKey = key;
      floorplanGraph.appendChild(line);
      rendered.add(key);
    }
  }
}

function highlightEdges(nodeId) {
  if (!floorplanGraph) return;
  for (const edge of floorplanGraph.querySelectorAll('.floorplan__edge')) {
    edge.classList.remove('floorplan__edge--active');
  }
  if (!nodeId) return;
  const node = nodesById.get(nodeId);
  if (!node?.connections) return;
  for (const targetId of node.connections) {
    const key = [node.id, targetId].sort().join('|');
    const edge = floorplanGraph.querySelector(`[data-edge-key="${key}"]`);
    edge?.classList.add('floorplan__edge--active');
  }
}

function updateFloorplanSummary(floorplan) {
  if (!floorplanSummary) return;
  if (!floorplan) {
    floorplanSummary.textContent = 'Floor plan unavailable. Add a floorplan object to the panorama map metadata.';
    return;
  }
  const levelInfo = Array.isArray(floorplan.levels) && floorplan.levels.length
    ? floorplan.levels.map((level) => level.label ?? `Level ${level.floor ?? ''}`).join(', ')
    : null;
  const count = nodes.length;
  const label = levelInfo ? `${levelInfo}` : 'Floor overview';
  floorplanSummary.textContent = `${label} · ${count} panorama${count === 1 ? '' : 's'}`;
}

function renderError(message) {
  metadataPanel.innerHTML = `
    <h2 class="meta__title">Unable to initialise viewer</h2>
    <p class="meta__description">${message}</p>
  `;
  document.getElementById('panorama').innerHTML = '';
}
