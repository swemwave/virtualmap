const nodeSelect = document.getElementById('nodeSelect');
const filterSelect = document.getElementById('filterSelect');
const fullscreenButton = document.getElementById('fullscreenButton');
const connectionsContainer = document.getElementById('connections');
const metadataPanel = document.getElementById('metadataPanel');
const floorplanImage = document.getElementById('floorplanImage');
const floorplanMarkers = document.getElementById('floorplanMarkers');
const floorplanContainer = document.getElementById('floorplan');
const floorplanGraph = document.getElementById('floorplanGraph');
const floorplanSummary = document.getElementById('floorplanSummary');

let viewer;
let data;
let nodes = [];
let nodesById = new Map();
let currentNodeId;
let floorplanDimensions = { width: 1, height: 1 };

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
}

function bindEvents() {
  nodeSelect.addEventListener('change', (event) => {
    selectNode(event.target.value);
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
}

function selectNode(nodeId, options = { updateViewer: true }) {
  if (!nodesById.has(nodeId)) {
    console.warn(`Unknown node id: ${nodeId}`);
    return;
  }

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
    const yaw = node?.defaultView?.yaw;
    const hfov = node?.defaultView?.hfov;
    viewer?.loadScene?.(nodeId, pitch, yaw, hfov);
  }

  updateMetadata();
  renderConnections();
  highlightMarker(nodeId);
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
    button.addEventListener('click', () => selectNode(targetId));
    connectionsContainer.appendChild(button);
  }
}

function setupFloorplan(floorplan) {
  const fallbackSrc = 'assets/images/floorplan-placeholder.svg';
  const fallbackAlt = 'Floor plan placeholder';
  floorplanDimensions = { width: 1, height: 1 };
  if (!floorplan) {
    floorplanImage.src = fallbackSrc;
    floorplanImage.alt = fallbackAlt;
    floorplanContainer?.setAttribute('aria-label', 'Top-down map placeholder');
    updateFloorplanSummary(null);
    clearFloorplanGraph();
    return;
  }

  const width = Number(floorplan.width) || 100;
  const height = Number(floorplan.height) || 100;
  floorplanDimensions = { width, height };
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
  configureFloorplanGraph(width, height);
}

function createMarkers() {
  floorplanMarkers.innerHTML = '';
  createFloorplanEdges();
  const filtered = getFilteredNodes();
  for (const node of nodes) {
    if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
      continue;
    }
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'floorplan__marker';
    marker.style.left = `${node.position.x * 100}%`;
    marker.style.top = `${node.position.y * 100}%`;
    marker.dataset.nodeId = node.id;
    marker.title = node.title ?? node.id;
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
  return {
    type: 'equirectangular',
    panorama: node.image,
    title: node.title,
    pitch: node.defaultView?.pitch ?? 0,
    yaw: node.defaultView?.yaw ?? 0,
    hfov: node.defaultView?.hfov ?? 105,
    autoLoad: true,
    compass: true,
    hotSpots: []
  };
}

function getFilteredNodes() {
  const filter = filterSelect.value;
  if (!filter || filter === 'all') {
    return nodes;
  }
  return nodes.filter((node) => node.type === filter);
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

function toFloorplanCoordinates(position) {
  return {
    x: position.x * floorplanDimensions.width,
    y: position.y * floorplanDimensions.height
  };
}

function configureFloorplanGraph(width, height) {
  if (!floorplanGraph) return;
  floorplanGraph.setAttribute('viewBox', `0 0 ${width} ${height}`);
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
    if (!node.position || !Array.isArray(node.connections)) continue;
    const source = toFloorplanCoordinates(node.position);
    for (const targetId of node.connections) {
      const key = [node.id, targetId].sort().join('|');
      if (rendered.has(key)) continue;
      const target = nodesById.get(targetId);
      if (!target?.position) continue;
      const targetPoint = toFloorplanCoordinates(target.position);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', source.x);
      line.setAttribute('y1', source.y);
      line.setAttribute('x2', targetPoint.x);
      line.setAttribute('y2', targetPoint.y);
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
