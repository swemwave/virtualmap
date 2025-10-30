const nodeSelect = document.getElementById('nodeSelect');
const filterSelect = document.getElementById('filterSelect');
const fullscreenButton = document.getElementById('fullscreenButton');
const connectionsContainer = document.getElementById('connections');
const metadataPanel = document.getElementById('metadataPanel');
const floorplanImage = document.getElementById('floorplanImage');
const floorplanMarkers = document.getElementById('floorplanMarkers');

let viewer;
let data;
let nodes = [];
let nodesById = new Map();
let currentNodeId;

init();

async function init() {
  try {
    const response = await fetch('data/panorama-map.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load map data: ${response.status} ${response.statusText}`);
    }
    data = await response.json();
    nodes = data.nodes ?? [];
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
    ? `<ul class="meta__features" aria-label="Location tags">${node.features
        .map((feature) => `<li class="meta__tag">${feature}</li>`)
        .join('')}</ul>`
    : '';

  metadataPanel.innerHTML = `
    <p class="meta__eyebrow">${formatType(node.type)}</p>
    <h2 class="meta__title">${node.title ?? node.id}</h2>
    <p class="meta__description">${node.description ?? 'No description provided yet.'}</p>
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
  if (!floorplan) {
    floorplanImage.src = 'assets/images/floorplan-placeholder.svg';
    floorplanImage.alt = 'Floor plan placeholder';
    return;
  }
  floorplanImage.src = floorplan.image ?? 'assets/images/floorplan-placeholder.svg';
  floorplanImage.alt = floorplan.alt ?? 'Floor plan overview';
}

function createMarkers() {
  floorplanMarkers.innerHTML = '';
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
  for (const marker of floorplanMarkers.querySelectorAll('.floorplan__marker')) {
    if (marker.dataset.nodeId === nodeId) {
      marker.classList.add('floorplan__marker--active');
      marker.setAttribute('aria-current', 'true');
    } else {
      marker.classList.remove('floorplan__marker--active');
      marker.removeAttribute('aria-current');
    }
  }
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

function renderError(message) {
  metadataPanel.innerHTML = `
    <h2 class="meta__title">Unable to initialise viewer</h2>
    <p class="meta__description">${message}</p>
  `;
  document.getElementById('panorama').innerHTML = '';
}
