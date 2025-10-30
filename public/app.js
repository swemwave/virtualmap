const state = {
  nodes: [],
  nodeMap: new Map(),
  lines: new Map(),
  selected: null,
  currentRoute: [],
};

const startSelect = document.querySelector('#start-select');
const endSelect = document.querySelector('#end-select');
const routeButton = document.querySelector('#route-btn');
const mapCanvas = document.querySelector('#map-canvas');
const viewerTitle = document.querySelector('#viewer-title');
const viewerMeta = document.querySelector('#viewer-meta');
const viewerImage = document.querySelector('#viewer-image');
const viewerNotes = document.querySelector('#viewer-notes');
const prevButton = document.querySelector('#prev-btn');
const nextButton = document.querySelector('#next-btn');

async function loadWaypoints() {
  const response = await fetch('data/waypoints.json');
  if (!response.ok) throw new Error('Unable to load waypoint data');
  const payload = await response.json();
  state.nodes = payload.nodes;
  state.nodes.forEach((node) => state.nodeMap.set(node.id, node));
  populateSelectors();
  drawMap();
  if (state.nodes.length) {
    setSelected(state.nodes[0].id);
  }
}

function populateSelectors() {
  const fragmentStart = document.createDocumentFragment();
  const fragmentEnd = document.createDocumentFragment();
  state.nodes.forEach((node) => {
    const optionA = document.createElement('option');
    optionA.value = node.id;
    optionA.textContent = `${node.id.toUpperCase()} · ${node.corridor}`;
    fragmentStart.appendChild(optionA);
    const optionB = optionA.cloneNode(true);
    fragmentEnd.appendChild(optionB);
  });
  startSelect.replaceChildren(fragmentStart);
  endSelect.replaceChildren(fragmentEnd);
  if (state.nodes.length) {
    startSelect.value = state.nodes[0].id;
    endSelect.value = state.nodes.at(-1).id;
  }
}

function drawMap() {
  mapCanvas.innerHTML = '';
  state.lines.clear();
  const connectionSet = new Set();
  state.nodes.forEach((node) => {
    node.neighbors.forEach((neighborId) => {
      const key = [node.id, neighborId].sort().join('|');
      if (connectionSet.has(key)) return;
      connectionSet.add(key);
      const neighbor = state.nodeMap.get(neighborId);
      if (!neighbor) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', node.position.x);
      line.setAttribute('y1', node.position.y);
      line.setAttribute('x2', neighbor.position.x);
      line.setAttribute('y2', neighbor.position.y);
      line.classList.add('map-connection');
      line.dataset.edgeKey = key;
      mapCanvas.appendChild(line);
      state.lines.set(key, line);
    });
  });

  state.nodes.forEach((node) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.classList.add('map-node');
    circle.setAttribute('r', 1.6);
    circle.setAttribute('cx', node.position.x);
    circle.setAttribute('cy', node.position.y);
    circle.dataset.nodeId = node.id;
    circle.addEventListener('click', () => setSelected(node.id));
    mapCanvas.appendChild(circle);
  });
}

function setSelected(nodeId) {
  const node = state.nodeMap.get(nodeId);
  if (!node) return;
  state.selected = nodeId;
  updateActiveMarker();
  viewerTitle.textContent = `${node.name}`;
  viewerMeta.textContent = `${node.zone} · ${node.corridor}`;
  viewerImage.src = node.image;
  viewerImage.alt = `${node.name} first-person view`;
  viewerNotes.textContent = node.notes;
  startSelect.value = nodeId;
  updateNavButtons();
  highlightRoute(state.currentRoute);
}

function updateActiveMarker() {
  mapCanvas.querySelectorAll('.map-node').forEach((circle) => {
    circle.classList.toggle('active', circle.dataset.nodeId === state.selected);
  });
}

function updateNavButtons() {
  const node = state.nodeMap.get(state.selected);
  if (!node) return;
  const previous = node.neighbors.find((neighbor) => neighbor < node.id);
  const next = node.neighbors.find((neighbor) => neighbor > node.id);
  prevButton.disabled = !previous;
  nextButton.disabled = !next;
  prevButton.onclick = previous ? () => setSelected(previous) : null;
  nextButton.onclick = next ? () => setSelected(next) : null;
}

function planRoute(startId, endId) {
  if (startId === endId) return [startId];
  const queue = [[startId]];
  const visited = new Set([startId]);
  while (queue.length) {
    const path = queue.shift();
    const current = path.at(-1);
    const node = state.nodeMap.get(current);
    if (!node) continue;
    for (const neighbor of node.neighbors) {
      if (visited.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === endId) return nextPath;
      visited.add(neighbor);
      queue.push(nextPath);
    }
  }
  return [];
}

function highlightRoute(route) {
  state.lines.forEach((line) => line.classList.remove('route'));
  if (!route || route.length < 2) return;
  for (let i = 0; i < route.length - 1; i += 1) {
    const key = [route[i], route[i + 1]].sort().join('|');
    const line = state.lines.get(key);
    if (line) line.classList.add('route');
  }
}

routeButton.addEventListener('click', () => {
  const startId = startSelect.value;
  const endId = endSelect.value;
  if (!startId || !endId) return;
  const route = planRoute(startId, endId);
  state.currentRoute = route;
  highlightRoute(route);
  if (route.length) {
    setSelected(route[0]);
    const originNote = state.nodeMap.get(route[0])?.notes ?? '';
    const summary = `${route.length} waypoint(s) between ${startId.toUpperCase()} and ${endId.toUpperCase()}.`;
    viewerNotes.textContent = [summary, originNote].filter(Boolean).join(' ');
  } else {
    viewerNotes.textContent = 'No path available. Confirm the waypoints are connected.';
  }
});

endSelect.addEventListener('change', () => {
  if (!startSelect.value || !endSelect.value) return;
  const route = planRoute(startSelect.value, endSelect.value);
  state.currentRoute = route;
  highlightRoute(route);
});

startSelect.addEventListener('change', () => {
  const selected = startSelect.value;
  if (selected) setSelected(selected);
});

loadWaypoints().catch((error) => {
  viewerTitle.textContent = 'Unable to load waypoints';
  viewerMeta.textContent = error.message;
  console.error(error);
});
