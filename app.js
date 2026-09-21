"use strict";

const ui = {
  worldTick: document.querySelector("#world-tick"), eventHead: document.querySelector("#event-head"),
  worldClock: document.querySelector("#world-clock"), people: document.querySelector("#inhabitant-list"),
  places: document.querySelector("#place-list"), inspector: document.querySelector("#inspector-content"),
  inspectorPanel: document.querySelector("#inspector"), inspectorExpand: document.querySelector("#inspector-expand"),
  from: document.querySelector("#from-tick"), to: document.querySelector("#to-tick"),
  slider: document.querySelector("#tick-slider"), selected: document.querySelector("#selected-tick"),
  show: document.querySelector("#show-range"), latest: document.querySelector("#jump-live"),
  replay: document.querySelector("#replay"), follow: document.querySelector("#live-follow"),
  status: document.querySelector("#feed-status"), feed: document.querySelector("#event-feed"),
  error: document.querySelector("#error-banner"),
  chronicleTab: document.querySelector("#chronicle-tab"), graphTab: document.querySelector("#graph-tab"),
  logosTab: document.querySelector("#logos-tab"), logosLabTab: document.querySelector("#logos-lab-tab"),
  chronicleView: document.querySelector("#chronicle-view"), graphView: document.querySelector("#graph-view"),
  logosView: document.querySelector("#logos-view"), logosLabView: document.querySelector("#logos-lab-view"),
  logosContent: document.querySelector("#logos-content"), logosLabContent: document.querySelector("#logos-lab-content"),
  logosRefresh: document.querySelector("#logos-refresh"), logosLabRefresh: document.querySelector("#logos-lab-refresh"),
  graph: document.querySelector("#world-graph"), graphScene: document.querySelector("#graph-scene"),
  graphEdges: document.querySelector("#graph-edges"), graphNodes: document.querySelector("#graph-nodes"),
  graphFilters: document.querySelector("#graph-filters"), graphSearch: document.querySelector("#graph-search"),
  graphReset: document.querySelector("#graph-reset"), graphFit: document.querySelector("#graph-fit"), graphHealth: document.querySelector("#graph-health"),
  graphStatus: document.querySelector("#graph-status"),
  graphTooltip: document.querySelector("#graph-tooltip"), graphStage: document.querySelector("#graph-stage"),
  engineRoomOpen: document.querySelector("#engine-room-open"), engineRoom: document.querySelector("#engine-room"),
  engineRoomClose: document.querySelector("#engine-room-close"), engineRoomRefresh: document.querySelector("#engine-room-refresh"),
  engineRoomCopy: document.querySelector("#engine-room-copy"), engineRoomContent: document.querySelector("#engine-room-content"), engineRoomObserved: document.querySelector("#engine-room-observed"),
};

let world = null;
let replayTimer = null;
let selectedInspector = null;
let selectedGraphNode = null;
let graphInspectorTab = "overview";
let graphInspectorMode = "node";
const characterLensCache = new Map();
const jsonExpansionState = new Map();
const jsonScrollState = new Map();
const inspectorDisclosureState = new Map();
let graphPositions = new Map();
let graphViewBox = { x: 0, y: 0, width: 1400, height: 900 };
let graphDrag = null;
let graphFiltersInitialized = false;
let graphTooltipHideTimer = null;
let modelHealthSnapshot = null;
let modelHealthRetryTimer = null;
let worldRefreshInFlight = false;
let worldRenderDeferred = false;
let logosSnapshot = null;
let logosLabSnapshot = null;
const visibleGraphTypes = new Set();
const defaultGraphTypes = new Set(["place"]);
const viewerConfig = window.BRACKENFORD_VIEWER || { mode: "api" };
const graphTypeOrder = ["place", "inhabitant", "npc", "resource", "building", "situation", "store", "item"];
const graphTypeLabels = {
  place: "Places", inhabitant: "Inhabitants", npc: "Other residents", resource: "Resources",
  building: "Buildings", situation: "Situations", store: "Shared stores", item: "Items",
};
const graphTypeSingular = {
  place: "Place", inhabitant: "Inhabitant", npc: "Other resident", resource: "Resource",
  building: "Building", situation: "Situation", store: "Shared store", item: "Item",
};
const svgNamespace = "http://www.w3.org/2000/svg";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
function pretty(value) { return String(value ?? "—").replaceAll("_", " ").replaceAll("-", " "); }
function placeName(value) { return world?.places.find(place => place.id === value)?.name || (String(value).startsWith("wild-") ? "Wilderness" : title(value)); }
function title(value) { return pretty(value).replace(/\b\w/g, letter => letter.toUpperCase()); }

async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Viewer request failed (${response.status})`);
  return body;
}

async function getWorld() {
  return getJson(viewerConfig.mode === "static" ? "data/world.json" : "/api/world");
}

async function getEvents(first, last) {
  if (viewerConfig.mode !== "static") {
    return getJson(`/api/events?from_tick=${first}&to_tick=${last}&limit=500`);
  }
  const relevant = (world.event_chunks || []).filter(chunk => chunk.last_tick >= first && chunk.first_tick <= last);
  const events = [];
  let truncated = false;
  for (const chunk of relevant) {
    const body = await getJson(`data/events/${chunk.file}`);
    for (const event of body.events) {
      if (event.tick >= first && event.tick <= last) events.push(event);
      if (events.length > 500) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { from_tick: first, to_tick: last, events: events.slice(0, 500), truncated, limit: 500 };
}

async function getCharacterLens(identity) {
  if (viewerConfig.mode === "static" || !world.character_lens_available) {
    throw new Error("Character lens is available only from an explicitly enabled local viewer.");
  }
  return getJson(`/api/character?identity=${encodeURIComponent(identity)}`);
}
async function getModelHealth() {
  if (viewerConfig.mode === "static" || world?.model_health_available === false) throw new Error("Engine room is available only from a loopback local viewer.");
  return getJson("/api/model-health");
}
async function getAutomationActivity(kind) {
  if (viewerConfig.mode === "static") throw new Error("Automation activity is available only from the loopback local viewer.");
  return getJson(kind === "lab" ? "/api/logos-lab-activity" : "/api/logos-activity");
}
function showError(error) { ui.error.textContent = error.message || String(error); ui.error.hidden = false; }
function clearError() { ui.error.hidden = true; }
function navButton(kind, id, name, meta) {
  return `<button type="button" data-kind="${kind}" data-id="${escapeHtml(id)}"><span class="nav-title">${escapeHtml(name)}</span><span class="nav-meta">${escapeHtml(meta || "")}</span></button>`;
}

function renderWorld() {
  ui.worldTick.textContent = world.tick.toLocaleString();
  ui.eventHead.textContent = world.event_head.event_id ? `#${world.event_head.sequence.toLocaleString()} · ${world.event_head.event_id.slice(0, 8)}` : "No events";
  const clock = world.clock || {};
  ui.worldClock.textContent = clock.phase ? `Day ${clock.day} · ${title(clock.phase)}` : `Tick ${world.tick}`;
  ui.people.innerHTML = world.inhabitants.map(person => navButton("person", person.id, person.name, placeName(person.current_place))).join("");
  ui.places.innerHTML = world.places.map(place => navButton("place", place.id, place.name, `${place.inhabitants.length} here`)).join("");
  ui.slider.max = String(world.tick);
  ui.from.max = ui.to.max = String(world.tick);
  ui.engineRoomOpen.hidden = !world.model_health_available;
  ui.logosTab.hidden = !world.logos_activity_available;
  ui.logosLabTab.hidden = !world.logos_lab_activity_available;
  document.querySelectorAll(".directory button").forEach(button => button.addEventListener("click", inspect));
  renderGraph();
  if (!ui.graphView.hidden) {
    if (graphInspectorMode === "health") renderSchemaHealth();
    else if (selectedGraphNode) {
      const node = world.graph?.nodes.find(item => item.id === selectedGraphNode);
      if (node) renderGraphInspector(node);
    }
  } else if (!ui.chronicleView.hidden && selectedInspector) {
    renderInspector(selectedInspector.kind, selectedInspector.id);
  }
}

function tags(values) {
  return values?.length ? `<div class="tags">${values.map(value => `<span class="tag">${escapeHtml(pretty(value))}</span>`).join("")}</div>` : `<p class="muted">None recorded.</p>`;
}
function list(values, formatter) {
  return values?.length ? `<ul class="detail-list">${values.map(value => `<li>${formatter(value)}</li>`).join("")}</ul>` : `<p class="muted">None recorded.</p>`;
}
function inventory(items) {
  return list(items, item => `${escapeHtml(title(item.item_id))} <strong>× ${Number(item.quantity).toLocaleString()}</strong>`);
}
function inspect(event) {
  const button = event.currentTarget;
  selectedInspector = { kind: button.dataset.kind, id: button.dataset.id };
  document.querySelectorAll(".directory button").forEach(item => item.classList.toggle("active", item === button));
  if (!ui.graphView.hidden) {
    selectGraphNode(`${button.dataset.kind === "person" ? "inhabitant" : button.dataset.kind}:${button.dataset.id}`);
  } else {
    renderInspector(selectedInspector.kind, selectedInspector.id);
  }
}

function renderInspector(kind, id) {
  if (kind === "person") {
    const person = world.inhabitants.find(item => item.id === id);
    if (!person) return;
    const skills = Object.entries(person.skills || {}).sort((a, b) => (b[1].level || 0) - (a[1].level || 0));
    ui.inspector.innerHTML = `
      <h2>${escapeHtml(person.name)}</h2><p class="role">${escapeHtml(person.species ? `${title(person.species)} · ${person.role}` : person.role)}</p>
      <div class="fact-grid"><div class="fact"><span>Location</span><strong>${escapeHtml(placeName(person.current_place))}</strong></div><div class="fact"><span>Work role</span><strong>${escapeHtml(title(person.work_role || person.role))}</strong></div></div>
      <section class="detail-section"><h3>Inventory</h3>${inventory(person.inventory)}</section>
      <section class="detail-section"><h3>Skills</h3>${list(skills, ([name, value]) => `${escapeHtml(title(name))} <strong>level ${escapeHtml(value.level ?? 0)}</strong>`)}</section>
      <section class="detail-section"><h3>Attributes</h3>${tags(Object.entries(person.attributes || {}).map(([name, value]) => `${pretty(name)} ${value}`))}</section>
      <section class="detail-section"><h3>Affordances</h3>${tags(person.affordances)}</section>`;
  } else {
    const place = world.places.find(item => item.id === id);
    if (!place) return;
    const residents = place.inhabitants.map(personId => world.inhabitants.find(item => item.id === personId)).filter(Boolean);
    ui.inspector.innerHTML = `
      <h2>${escapeHtml(place.name)}</h2><p class="role">${escapeHtml(place.description || place.name)}</p>
      <section class="detail-section"><h3>Inhabitants</h3>${list(residents, person => `<strong>${escapeHtml(person.name)}</strong><br>${escapeHtml(person.role || "")}`)}</section>
      <section class="detail-section"><h3>Other residents</h3>${list(place.npcs, npc => `<strong>${escapeHtml(npc.name || title(npc.id))}</strong><br>${escapeHtml(npc.role || "")}`)}</section>
      <section class="detail-section"><h3>Resources</h3>${list(place.resources, node => `<strong>${escapeHtml(title(node.material || node.id))}</strong> · ${Number(node.quantity || 0).toLocaleString()} available<br>${escapeHtml(title(node.kind))}`)}</section>
      <section class="detail-section"><h3>Buildings</h3>${list(place.buildings, building => `<strong>${escapeHtml(building.name || title(building.id))}</strong>`)}</section>
      <section class="detail-section"><h3>Active situations</h3>${list(place.situations, situation => `<strong>${escapeHtml(title(situation.template || situation.id))}</strong><br>${escapeHtml(title(situation.status))}`)}</section>`;
  }
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function graphGlyph(node, radius) {
  if (node.type === "building" || node.type === "store") {
    return svgElement("rect", { class: "node-core", x: -radius, y: -radius, width: radius * 2, height: radius * 2, rx: node.type === "store" ? 3 : 1 });
  }
  if (node.type === "situation" || node.type === "item") {
    return svgElement("polygon", { class: "node-core", points: `0,${-radius} ${radius},0 0,${radius} ${-radius},0` });
  }
  if (node.type === "resource") {
    const side = radius * .86;
    return svgElement("polygon", { class: "node-core", points: `${-side},${-radius / 2} 0,${-radius} ${side},${-radius / 2} ${side},${radius / 2} 0,${radius} ${-side},${radius / 2}` });
  }
  return svgElement("circle", { class: "node-core", r: radius });
}


function renderGraphFilters(graph) {
  const types = graphTypeOrder.filter(type => graph.nodes.some(node => node.type === type));
  if (!graphFiltersInitialized) {
    types.filter(type => defaultGraphTypes.has(type)).forEach(type => visibleGraphTypes.add(type));
    graphFiltersInitialized = true;
  }
  ui.graphFilters.innerHTML = types.map(type => {
    const count = graph.counts.by_type[type] || 0;
    return `<label class="graph-filter" data-type="${type}"><input type="checkbox" value="${type}" ${visibleGraphTypes.has(type) ? "checked" : ""}><span class="graph-filter-symbol" aria-hidden="true"></span><span>${escapeHtml(graphTypeLabels[type])} · ${count.toLocaleString()}</span></label>`;
  }).join("");
  ui.graphFilters.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
    if (input.checked) visibleGraphTypes.add(input.value); else visibleGraphTypes.delete(input.value);
    applyGraphVisibility();
  }));
}

function renderGraphHealthStatus() {
  const health = world?.schema_health;
  if (!health) return;
  const count = Number(health.summary?.issues || 0);
  ui.graphHealth.dataset.status = health.status;
  ui.graphHealth.querySelector("strong").textContent = count.toLocaleString();
  ui.graphHealth.setAttribute("aria-label", `Structure health: ${count} issue${count === 1 ? "" : "s"}`);
}

function renderGraph() {
  const graph = world?.graph;
  if (!graph) return;
  const firstLayout = graphPositions.size === 0;
  graphPositions = layoutWorldGraph(graph, graphPositions);
  if (firstLayout) resetGraphView();
  renderGraphFilters(graph);
  renderGraphHealthStatus();
  ui.graphEdges.replaceChildren();
  ui.graphNodes.replaceChildren();
  delete ui.graph.dataset.labelScale;
  graph.edges.forEach(edge => {
    const source = graphPositions.get(edge.source);
    const target = graphPositions.get(edge.target);
    if (!source || !target) return;
    const line = svgElement("line", {
      x1: source.x, y1: source.y, x2: target.x, y2: target.y,
      class: "graph-edge", "data-id": edge.id, "data-source": edge.source,
      "data-target": edge.target, "data-relation": edge.relation,
    });
    const titleElement = svgElement("title");
    titleElement.textContent = `${edge.label} · ${edge.path}`;
    line.append(titleElement);
    ui.graphEdges.append(line);
  });
  graph.nodes.forEach(node => {
    const position = graphPositions.get(node.id);
    const radius = node.type === "place" ? 11 : node.type === "inhabitant" ? 7.5 : node.type === "building" || node.type === "store" ? 7 : 6;
    const group = svgElement("g", {
      transform: `translate(${position.x} ${position.y})`, class: "graph-node", tabindex: "0",
      role: "button", "aria-label": `${node.label}, ${graphTypeLabels[node.type] || node.type}`,
      "data-id": node.id, "data-type": node.type,
    });
    group.append(svgElement("circle", { class: "node-halo", r: radius + 3 }));
    group.append(graphGlyph(node, radius));
    const label = svgElement("text", { class: "node-label", x: radius + 6, y: 4 });
    label.textContent = node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label;
    group.append(label);
    const titleElement = svgElement("title");
    titleElement.textContent = `${node.label} · ${node.path}`;
    group.append(titleElement);
    group.addEventListener("mouseenter", event => showGraphTooltip(node, event.clientX, event.clientY));
    group.addEventListener("mousemove", event => positionGraphTooltip(event.clientX, event.clientY));
    group.addEventListener("mouseleave", scheduleGraphTooltipHide);
    group.addEventListener("focus", () => {
      const bounds = group.getBoundingClientRect();
      showGraphTooltip(node, bounds.right, bounds.top + bounds.height / 2);
    });
    group.addEventListener("blur", scheduleGraphTooltipHide);
    group.addEventListener("click", event => { event.stopPropagation(); selectGraphNode(node.id); });
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectGraphNode(node.id); }
    });
    ui.graphNodes.append(group);
  });
  if (selectedGraphNode && !graph.nodes.some(node => node.id === selectedGraphNode)) selectedGraphNode = null;
  applyGraphVisibility();
  applyGraphViewBox();
}

function applyGraphVisibility() {
  const graph = world?.graph;
  if (!graph) return;
  hideGraphTooltip();
  const visibleNodes = new Set(graph.nodes.filter(node => visibleGraphTypes.has(node.type)).map(node => node.id));
  ui.graphNodes.querySelectorAll(".graph-node").forEach(element => {
    element.hidden = !visibleNodes.has(element.dataset.id);
    element.style.display = element.hidden ? "none" : "";
  });
  let edgeCount = 0;
  ui.graphEdges.querySelectorAll(".graph-edge").forEach(element => {
    const visible = visibleNodes.has(element.dataset.source) && visibleNodes.has(element.dataset.target);
    element.style.display = visible ? "" : "none";
    if (visible) edgeCount += 1;
  });
  const nodeCount = visibleNodes.size;
  ui.graphStatus.textContent = `${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} relationships · snapshot at tick ${world.tick.toLocaleString()}`;
  highlightGraphSelection();
}

function selectGraphNode(nodeId, center = false) {
  const node = world?.graph?.nodes.find(item => item.id === nodeId);
  if (!node) return;
  if (selectedGraphNode !== nodeId) graphInspectorTab = "overview";
  graphInspectorMode = "node";
  selectedGraphNode = nodeId;
  visibleGraphTypes.add(node.type);
  const checkbox = ui.graphFilters.querySelector(`input[value="${CSS.escape(node.type)}"]`);
  if (checkbox) checkbox.checked = true;
  applyGraphVisibility();
  renderGraphInspector(node);
  if (center) centerGraphNode(nodeId);
}

function graphTooltipDetails(node) {
  const entries = Object.entries(node.detail || {});
  const preferred = node.type === "place"
    ? ["inhabitants", "residents", "resources", "buildings", "situations"]
    : ["role", "current_place", "material", "quantity", "status", "capacity", "resource_kind", "expires_at"];
  return [...entries].sort(([first], [second]) => {
    const firstIndex = preferred.indexOf(first);
    const secondIndex = preferred.indexOf(second);
    return (firstIndex < 0 ? 99 : firstIndex) - (secondIndex < 0 ? 99 : secondIndex);
  }).slice(0, node.type === "place" ? 5 : 3);
}

function showGraphTooltip(node, clientX, clientY) {
  cancelGraphTooltipHide();
  const connections = world.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const details = graphTooltipDetails(node);
  ui.graphTooltip.innerHTML = `
    <div class="tooltip-type" data-type="${node.type}"><span class="tooltip-symbol" data-type="${node.type}" aria-hidden="true"></span>${escapeHtml(graphTypeSingular[node.type] || node.type)}</div>
    <strong>${escapeHtml(node.label)}</strong>
    ${details.length ? `<dl>${details.map(([name, value]) => `<div><dt>${escapeHtml(title(name))}</dt><dd>${escapeHtml(name === "current_place" ? placeName(value) : Array.isArray(value) ? value.join(", ") : value)}</dd></div>`).join("")}</dl>` : ""}
    <div class="tooltip-footer"><span>${connections.length.toLocaleString()} direct connection${connections.length === 1 ? "" : "s"}</span><button type="button" data-tooltip-inspect="${escapeHtml(node.id)}">Click to inspect</button></div>`;
  ui.graphTooltip.querySelector("[data-tooltip-inspect]").addEventListener("click", () => {
    selectGraphNode(node.id);
    hideGraphTooltip();
  });
  ui.graphTooltip.hidden = false;
  positionGraphTooltip(clientX, clientY);
}

function positionGraphTooltip(clientX, clientY) {
  if (ui.graphTooltip.hidden) return;
  const stage = ui.graphStage.getBoundingClientRect();
  const tooltip = ui.graphTooltip.getBoundingClientRect();
  const preferredLeft = clientX - stage.left + 16;
  const preferredTop = clientY - stage.top + 14;
  const left = Math.max(10, Math.min(preferredLeft, stage.width - tooltip.width - 10));
  const top = Math.max(10, Math.min(preferredTop, stage.height - tooltip.height - 10));
  ui.graphTooltip.style.transform = `translate(${left}px, ${top}px)`;
}

function hideGraphTooltip() {
  cancelGraphTooltipHide();
  ui.graphTooltip.hidden = true;
}

function scheduleGraphTooltipHide() {
  cancelGraphTooltipHide();
  graphTooltipHideTimer = window.setTimeout(hideGraphTooltip, 280);
}

function cancelGraphTooltipHide() {
  if (graphTooltipHideTimer) window.clearTimeout(graphTooltipHideTimer);
  graphTooltipHideTimer = null;
}

function highlightGraphSelection() {
  const connected = new Set(selectedGraphNode ? [selectedGraphNode] : []);
  if (selectedGraphNode) world.graph.edges.forEach(edge => {
    if (edge.source === selectedGraphNode) connected.add(edge.target);
    if (edge.target === selectedGraphNode) connected.add(edge.source);
  });
  ui.graphNodes.querySelectorAll(".graph-node").forEach(element => {
    const isConnected = connected.has(element.dataset.id) && element.dataset.id !== selectedGraphNode;
    element.classList.toggle("selected", element.dataset.id === selectedGraphNode);
    element.classList.toggle("connected", Boolean(selectedGraphNode) && isConnected);
    element.classList.toggle("dimmed", Boolean(selectedGraphNode) && !connected.has(element.dataset.id));
  });
  ui.graphEdges.querySelectorAll(".graph-edge").forEach(element => {
    const isConnected = element.dataset.source === selectedGraphNode || element.dataset.target === selectedGraphNode;
    element.classList.toggle("connected", isConnected);
    element.classList.toggle("dimmed", Boolean(selectedGraphNode) && !isConnected);
  });
}

function renderGraphInspector(node) {
  const connections = world.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const outgoing = connections.filter(edge => edge.reference_source === node.id);
  const incoming = connections.filter(edge => edge.reference_target === node.id);
  const related = connections.filter(edge => !edge.reference_source || !edge.reference_target);
  const details = Object.entries(node.detail || {});
  const projection = graphNodeProjection(node, connections);
  const projectionTreeState = jsonTreeStateKey(node, "projection");
  const modelViewAvailable = node.type === "inhabitant" && world.character_lens_available;
  if (["timeline", "model"].includes(graphInspectorTab) && !modelViewAvailable) graphInspectorTab = "overview";
  const selected = tab => graphInspectorTab === tab;
  const referenceButtons = (edges, direction) => edges.length ? `<div class="detail-list connection-list">${edges.map(edge => {
    const otherId = direction === "outgoing" ? edge.reference_target
      : direction === "incoming" ? edge.reference_source
      : edge.source === node.id ? edge.target : edge.source;
    const other = world.graph.nodes.find(item => item.id === otherId);
    return `<button type="button" data-node="${escapeHtml(otherId)}"><span><strong>${escapeHtml(other?.label || otherId)}</strong><small>${escapeHtml(edge.path)}</small></span><span>${escapeHtml(edge.label)} ${direction === "incoming" ? "←" : "→"}</span></button>`;
  }).join("")}</div>` : '<p class="muted">None.</p>';
  ui.inspector.innerHTML = `
    <p class="eyebrow">${escapeHtml((graphTypeLabels[node.type] || node.type).toUpperCase())}</p>
    <h2>${escapeHtml(node.label)}</h2>
    ${node.type === "place" ? "" : `<p class="role">${escapeHtml(node.ref)}</p>`}
    <div class="inspector-tabs" role="tablist" aria-label="Node details">
      <button type="button" role="tab" data-inspector-tab="overview" aria-selected="${selected("overview")}" class="${selected("overview") ? "active" : ""}">Overview</button>
      <button type="button" role="tab" data-inspector-tab="json" aria-selected="${selected("json")}" class="${selected("json") ? "active" : ""}">JSON</button>
      <button type="button" role="tab" data-inspector-tab="references" aria-selected="${selected("references")}" class="${selected("references") ? "active" : ""}">References</button>
      ${modelViewAvailable ? `<button type="button" role="tab" data-inspector-tab="timeline" aria-selected="${selected("timeline")}" class="${selected("timeline") ? "active" : ""}">Timeline</button>` : ""}
      ${modelViewAvailable ? `<button type="button" role="tab" data-inspector-tab="model" aria-selected="${selected("model")}" class="${selected("model") ? "active" : ""}">Model view</button>` : ""}
    </div>
    <div role="tabpanel" class="inspector-panel" data-inspector-panel="overview" ${selected("overview") ? "" : "hidden"}>
      ${details.length ? `<section class="detail-section"><h3>Projected fields</h3>${list(details, ([name, value]) => `${escapeHtml(title(name))} <strong>${escapeHtml(name === "current_place" ? placeName(value) : Array.isArray(value) ? value.join(", ") : value)}</strong>`)}</section>` : ""}
      <section class="detail-section"><h3>Connections</h3><p class="muted">${connections.length.toLocaleString()} direct relationship${connections.length === 1 ? "" : "s"}. Open References to see their data direction.</p></section>
    </div>
    <div role="tabpanel" class="inspector-panel" data-inspector-panel="json" ${selected("json") ? "" : "hidden"}>
      <section class="detail-section"><div class="section-heading"><h3>Authoritative JSON path</h3><button type="button" class="text-action" data-copy-path>Copy path</button></div><div class="graph-path">${escapeHtml(node.path)}</div></section>
      <div class="json-toolbar"><span>Public projection</span><button type="button" class="text-action" data-copy-json>Copy JSON</button></div>
      <div class="json-tree" data-json-scroll="${escapeHtml(projectionTreeState)}" aria-label="${escapeHtml(node.label)} JSON">${renderJsonTree(projection, 0, node, "$", null, projectionTreeState)}</div>
      <p class="json-note">Highlighted values are typed graph references. Select one to inspect its target. This is the bounded read-only projection, not the complete world state.</p>
    </div>
    <div role="tabpanel" class="inspector-panel" data-inspector-panel="references" ${selected("references") ? "" : "hidden"}>
      <section class="detail-section"><h3>References from this node · ${outgoing.length}</h3>${referenceButtons(outgoing, "outgoing")}</section>
      <section class="detail-section"><h3>Referenced by · ${incoming.length}</h3>${referenceButtons(incoming, "incoming")}</section>
      ${related.length ? `<section class="detail-section"><h3>Other relationships · ${related.length}</h3>${referenceButtons(related, "related")}</section>` : ""}
    </div>
    ${modelViewAvailable ? `<div role="tabpanel" class="inspector-panel" data-inspector-panel="timeline" ${selected("timeline") ? "" : "hidden"}>${characterTimelineMarkup(node)}</div>` : ""}
    ${modelViewAvailable ? `<div role="tabpanel" class="inspector-panel" data-inspector-panel="model" ${selected("model") ? "" : "hidden"}>${characterLensMarkup(node)}</div>` : ""}`;
  ui.inspector.querySelectorAll("[data-node]").forEach(button => button.addEventListener("click", () => selectGraphNode(button.dataset.node, true)));
  ui.inspector.querySelectorAll("[data-json-node]").forEach(button => button.addEventListener("click", () => selectGraphNode(button.dataset.jsonNode, true)));
  bindInspectorViewState(node);
  ui.inspector.querySelectorAll("[data-inspector-tab]").forEach(button => button.addEventListener("click", () => {
    graphInspectorTab = button.dataset.inspectorTab;
    renderGraphInspector(node);
    ui.inspector.querySelector(`[data-inspector-tab="${graphInspectorTab}"]`)?.focus();
  }));
  ui.inspector.querySelector("[data-copy-path]")?.addEventListener("click", event => copyInspectorText(node.path, event.currentTarget, "Path copied"));
  ui.inspector.querySelector("[data-copy-json]")?.addEventListener("click", event => copyInspectorText(JSON.stringify(projection, null, 2), event.currentTarget, "JSON copied"));
  bindCharacterLensActions(node);
  if ((selected("timeline") || selected("model")) && !characterLensCache.has(node.ref)) loadCharacterLens(node);
}

function characterTimelineMarkup(node) {
  const entry = characterLensCache.get(node.ref);
  if (!entry || entry.status === "loading") {
    return '<div class="lens-loading"><span class="lens-spinner" aria-hidden="true"></span><p>Reading validated character events…</p></div>';
  }
  if (entry.status === "error") {
    return `<div class="lens-error"><strong>Timeline unavailable</strong><p>${escapeHtml(entry.message)}</p><button type="button" data-refresh-lens>Try again</button></div>`;
  }
  const timeline = entry.data.strategy_timeline;
  if (timeline.status === "not_started") {
    return '<div class="timeline-empty"><strong>Experiment not started</strong><p>No reviewed broad-ambition revision is present in this world snapshot.</p></div>';
  }
  if (timeline.status === "not_participant") {
    return '<div class="timeline-empty"><strong>Not an experiment participant</strong><p>This character has no broad ambition in the reviewed revision.</p></div>';
  }
  const categories = Object.entries(timeline.counts || {}).sort(([left], [right]) => left.localeCompare(right));
  const rows = timeline.events.map(event => `
    <li class="strategy-event ${escapeHtml(event.status)}">
      <div class="strategy-event-heading"><span>Tick ${Number(event.tick).toLocaleString()}</span><span>${escapeHtml(event.category)} · ${escapeHtml(event.status)}</span></div>
      <p>${escapeHtml(event.summary)}</p>
      <details><summary>${escapeHtml(event.kind)} · ${escapeHtml(event.type)}</summary><pre>${escapeHtml(JSON.stringify(event.detail, null, 2))}</pre></details>
    </li>`).join("");
  return `
    <div class="timeline-note"><strong>Evidence, not an ambition score</strong><span>Validated decisions and explicit collaborative outcomes since the seed revision. No model interprets whether they are strategic.</span></div>
    <blockquote class="ambition-seed">${escapeHtml(timeline.ambition)}</blockquote>
    <div class="lens-meta timeline-meta">
      <div><span>Seed tick</span><strong>${Number(timeline.from_tick).toLocaleString()}</strong></div>
      <div><span>Evidence rows</span><strong>${Number(timeline.total_events).toLocaleString()}</strong></div>
      <div><span>Through tick</span><strong>${Number(timeline.through_tick).toLocaleString()}</strong></div>
    </div>
    <div class="timeline-categories">${categories.map(([category, count]) => `<span>${escapeHtml(category)} <strong>${Number(count).toLocaleString()}</strong></span>`).join("") || '<span>No events yet</span>'}</div>
    ${timeline.truncated ? `<p class="json-note">Showing the newest ${Number(timeline.limit).toLocaleString()} evidence rows.</p>` : ""}
    <ol class="strategy-timeline">${rows || '<li class="timeline-empty"><p>No matching validated decisions or collaborative outcomes yet.</p></li>'}</ol>`;
}

function characterLensMarkup(node) {
  const entry = characterLensCache.get(node.ref);
  if (!entry || entry.status === "loading") {
    return '<div class="lens-loading"><span class="lens-spinner" aria-hidden="true"></span><p>Building the current model-facing view…</p></div>';
  }
  if (entry.status === "error") {
    return `<div class="lens-error"><strong>Model view unavailable</strong><p>${escapeHtml(entry.message)}</p><button type="button" data-refresh-lens>Try again</button></div>`;
  }
  const lens = entry.data;
  const stale = lens.tick !== world.tick;
  const modelTreeState = jsonTreeStateKey(node, "model");
  return `
    <div class="lens-warning"><strong>Private model context</strong><span>This includes ${escapeHtml(node.label)}'s memories, beliefs and identity seed. It is available only in this loopback debug session.</span></div>
    <div class="lens-meta">
      <div><span>View tick</span><strong>${Number(lens.tick).toLocaleString()}${stale ? " · older snapshot" : ""}</strong></div>
      <div><span>Characters</span><strong>${Number(lens.evidence.world_view_characters).toLocaleString()}</strong></div>
      <div><span>SHA-256</span><strong title="${escapeHtml(lens.evidence.world_view_sha256)}">${escapeHtml(lens.evidence.world_view_sha256.slice(0, 12))}…</strong></div>
    </div>
    <div class="json-toolbar"><span>Exact WorldStore.agent_view</span><div><button type="button" class="text-action" data-refresh-lens>Refresh</button><button type="button" class="text-action" data-copy-lens="world">Copy JSON</button></div></div>
    <div class="json-tree lens-json" data-json-scroll="${escapeHtml(modelTreeState)}" aria-label="${escapeHtml(node.label)} model world view">${renderJsonTree(lens.world_view, 0, node, "$", null, modelTreeState)}</div>
    <p class="json-note">${escapeHtml(lens.evidence.scheduling_note)}</p>
    <details class="prompt-block" data-inspector-disclosure="identity" ${inspectorDisclosureOpen(node, "identity") ? "open" : ""}><summary>Identity context</summary><pre>${escapeHtml(lens.identity_context)}</pre></details>
    <details class="prompt-block" data-inspector-disclosure="contract" ${inspectorDisclosureOpen(node, "contract") ? "open" : ""}><summary>Dynamic action contract</summary><pre>${escapeHtml(lens.action_contract)}</pre></details>
    <details class="prompt-block" data-inspector-disclosure="direct" ${inspectorDisclosureOpen(node, "direct") ? "open" : ""}><summary>Direct model input</summary><div class="prompt-actions"><button type="button" class="text-action" data-copy-lens="direct-system">Copy system</button><button type="button" class="text-action" data-copy-lens="direct-user">Copy user JSON</button></div><h4>System</h4><pre>${escapeHtml(lens.direct_model_input.system)}</pre><h4>User</h4><pre>${escapeHtml(lens.direct_model_input.user)}</pre></details>
    <details class="prompt-block" data-inspector-disclosure="openchara" ${inspectorDisclosureOpen(node, "openchara") ? "open" : ""}><summary>OpenChara latest user message</summary><div class="prompt-actions"><button type="button" class="text-action" data-copy-lens="openchara-user">Copy message</button></div><p>${escapeHtml(lens.openchara_model_input.system_note)}</p><pre>${escapeHtml(lens.openchara_model_input.user)}</pre></details>`;
}

function jsonTreeStateKey(node, surface) {
  const stateKey = `${node.id}:${surface}`;
  if (!jsonExpansionState.has(stateKey)) jsonExpansionState.set(stateKey, new Set(["$"]));
  return stateKey;
}

function inspectorDisclosureOpen(node, disclosure) {
  return inspectorDisclosureState.get(node.id)?.has(disclosure) || false;
}

function bindInspectorViewState(node) {
  ui.inspector.querySelectorAll("details[data-json-state]").forEach(details => details.addEventListener("toggle", () => {
    const expanded = jsonExpansionState.get(details.dataset.jsonState) || new Set();
    if (details.open) expanded.add(details.dataset.jsonPath);
    else expanded.delete(details.dataset.jsonPath);
    jsonExpansionState.set(details.dataset.jsonState, expanded);
  }));
  ui.inspector.querySelectorAll("[data-json-scroll]").forEach(tree => {
    const saved = jsonScrollState.get(tree.dataset.jsonScroll);
    if (Number.isFinite(saved)) tree.scrollTop = saved;
    tree.addEventListener("scroll", () => jsonScrollState.set(tree.dataset.jsonScroll, tree.scrollTop), { passive: true });
  });
  ui.inspector.querySelectorAll("details[data-inspector-disclosure]").forEach(details => details.addEventListener("toggle", () => {
    const expanded = inspectorDisclosureState.get(node.id) || new Set();
    if (details.open) expanded.add(details.dataset.inspectorDisclosure);
    else expanded.delete(details.dataset.inspectorDisclosure);
    inspectorDisclosureState.set(node.id, expanded);
  }));
}

async function loadCharacterLens(node, force = false) {
  const existing = characterLensCache.get(node.ref);
  if (!force && existing) return;
  characterLensCache.set(node.ref, { status: "loading" });
  if (selectedGraphNode === node.id && ["timeline", "model"].includes(graphInspectorTab)) renderGraphInspector(node);
  try {
    const data = await getCharacterLens(node.ref);
    characterLensCache.set(node.ref, { status: "ready", data });
  } catch (error) {
    characterLensCache.set(node.ref, { status: "error", message: error.message || String(error) });
  }
  if (selectedGraphNode === node.id && ["timeline", "model"].includes(graphInspectorTab)) renderGraphInspector(node);
}

function bindCharacterLensActions(node) {
  const entry = characterLensCache.get(node.ref);
  ui.inspector.querySelectorAll("[data-refresh-lens]").forEach(button => button.addEventListener("click", () => loadCharacterLens(node, true)));
  if (entry?.status !== "ready") return;
  const lens = entry.data;
  const values = {
    world: JSON.stringify(lens.world_view, null, 2),
    "direct-system": lens.direct_model_input.system,
    "direct-user": lens.direct_model_input.user,
    "openchara-user": lens.openchara_model_input.user,
  };
  ui.inspector.querySelectorAll("[data-copy-lens]").forEach(button => button.addEventListener("click", event => {
    copyInspectorText(values[button.dataset.copyLens], event.currentTarget, "Copied");
  }));
}

function graphNodeProjection(node, connections) {
  if (node.type === "inhabitant") return world.inhabitants.find(item => item.id === node.ref) || node;
  if (node.type === "place") return world.places.find(item => item.id === node.ref) || node;
  if (node.type === "store") return world.shared_stores.find(item => item.id === node.ref) || node;
  if (["npc", "resource", "building", "situation"].includes(node.type)) {
    const collection = { npc: "npcs", resource: "resources", building: "buildings", situation: "situations" }[node.type];
    for (const place of world.places) {
      const match = (place[collection] || []).find(item => String(item.id || item.building_id) === node.ref);
      if (match) return node.type === "npc" ? { ...match, current_place: place.id } : match;
    }
  }
  if (node.type === "item") {
    return {
      item_id: node.ref,
      occurrences: connections.map(edge => ({ relation: edge.relation, label: edge.label, source: edge.source, target: edge.target, path: edge.path })),
    };
  }
  return { id: node.ref, type: node.type, label: node.label, path: node.path, ...node.detail };
}

function jsonReference(node, path, key, value) {
  if (typeof value !== "string") return null;
  if ((key === "source" || key === "target") && world.graph.nodes.some(item => item.id === value)) return value;
  let type = null;
  if (key === "current_place" || key === "location") type = "place";
  else if (key === "item_id") type = "item";
  else if (/^\$\.inhabitants\[\d+\]$/.test(path)) type = "inhabitant";
  else if (key === "id" && path.startsWith("$.npcs[")) type = "npc";
  else if (key === "id" && path.startsWith("$.resources[")) type = "resource";
  else if ((key === "id" || key === "building_id") && path.startsWith("$.buildings[")) type = "building";
  else if (key === "id" && path.startsWith("$.situations[")) type = "situation";
  if (!type) return null;
  const candidate = `${type}:${value}`;
  if (!world.graph.nodes.some(item => item.id === candidate)) return null;
  return world.graph.edges.some(edge =>
    (edge.reference_source === node.id && edge.reference_target === candidate)
    || ((edge.source === node.id || edge.target === node.id) && (edge.source === candidate || edge.target === candidate))
  ) ? candidate : null;
}

function renderJsonTree(value, depth, node, path = "$", key = null, stateKey = "") {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === "string") {
    const target = jsonReference(node, path, key, value);
    if (target) return `<button type="button" class="json-reference" data-json-node="${escapeHtml(target)}"><span>${escapeHtml(JSON.stringify(value))}</span><span aria-hidden="true">↗</span></button>`;
    return `<span class="json-string">${escapeHtml(JSON.stringify(value))}</span>`;
  }
  if (typeof value === "number" || typeof value === "boolean") return `<span class="json-primitive">${escapeHtml(value)}</span>`;
  if (Array.isArray(value) || (value && typeof value === "object")) {
    const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
    const shape = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
    if (!entries.length) return `<span class="json-empty">${Array.isArray(value) ? "[]" : "{}"}</span>`;
    const open = jsonExpansionState.get(stateKey)?.has(path);
    return `<details class="json-branch" data-json-state="${escapeHtml(stateKey)}" data-json-path="${escapeHtml(path)}" ${open ? "open" : ""}><summary>${shape}</summary><div>${entries.map(([childKey, item]) => {
      const childPath = Array.isArray(value) ? `${path}[${childKey}]` : `${path}.${childKey}`;
      return `<div class="json-row"><span class="json-key">${escapeHtml(childKey)}:</span><span>${renderJsonTree(item, depth + 1, node, childPath, childKey, stateKey)}</span></div>`;
    }).join("")}</div></details>`;
  }
  return `<span class="json-null">${escapeHtml(String(value))}</span>`;
}

function renderSchemaHealth() {
  const health = world.schema_health;
  const issues = health?.issues || [];
  ui.inspector.innerHTML = `
    <p class="eyebrow">READ-ONLY DIAGNOSTICS</p>
    <h2>Structure health</h2>
    <p class="role">Snapshot at tick ${world.tick.toLocaleString()}</p>
    <div class="health-summary" data-status="${escapeHtml(health?.status || "unknown")}">
      <strong>${health?.status === "healthy" ? "No monitored issues" : `${issues.length.toLocaleString()} issue${issues.length === 1 ? "" : "s"}`}</strong>
      <span>${Number(health?.summary?.errors || 0).toLocaleString()} errors · ${Number(health?.summary?.warnings || 0).toLocaleString()} warnings</span>
    </div>
    <section class="detail-section"><h3>Checks</h3>${tags(health?.scope || [])}</section>
    <section class="detail-section"><h3>Findings</h3><div class="health-findings">${issues.map(item => {
      const target = [item.node_id, item.target_id].find(id => world.graph.nodes.some(node => node.id === id));
      const tag = target ? "button" : "div";
      const action = target ? ` type="button" data-health-node="${escapeHtml(target)}"` : "";
      return `<${tag} class="health-finding" data-severity="${escapeHtml(item.severity)}"${action}><span class="health-code">${escapeHtml(title(item.code))}</span><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(item.path)}</small></${tag}>`;
    }).join("") || '<p class="muted">The monitored structure is internally consistent.</p>'}</div></section>
    <p class="json-note">This bounded check does not claim the entire world is healthy. It validates only the listed public structures and never changes state.</p>`;
  ui.inspector.querySelectorAll("[data-health-node]").forEach(button => button.addEventListener("click", () => selectGraphNode(button.dataset.healthNode, true)));
}

function healthValue(value, suffix = "") {
  return value === null || value === undefined ? "Unknown" : `${Number(value).toLocaleString()}${suffix}`;
}

function healthRatio(value) {
  return value === null || value === undefined ? "Unknown" : `${(Number(value) * 100).toFixed(1)}%`;
}

function healthBytes(value) {
  return value === null || value === undefined ? "Unknown" : `${(Number(value) / (1024 ** 3)).toFixed(1)} GiB`;
}

function routeSegments(row) {
  return ["laya", "qwen", "luna", "deferred", "unobserved"].map(route =>
    Array.from({ length: Number(row[route] || 0) }, () => `<span class="${route}" title="${escapeHtml(title(route))}"></span>`).join("")
  ).join("");
}

function latencyLabel(history, route) {
  const latency = history.latency_seconds_by_route?.[route];
  return latency?.p50 === null || latency?.p50 === undefined
    ? "No sample"
    : `${latency.p50.toLocaleString()}s p50 · ${healthValue(latency.p95, "s")} p95`;
}

function engineMetric(label, value) {
  return `<div class="engine-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderModelHealth(snapshot) {
  modelHealthSnapshot = snapshot;
  ui.engineRoomCopy.disabled = !snapshot.model_brief;
  const current = snapshot.current || {};
  const qwen = current.qwen || {};
  const laya = current.laya || {};
  const luna = current.luna_overflow || {};
  const limits = current.limits || {};
  const history = snapshot.history || {};
  const routes = history.routes || {};
  const overallStatus = current.status || qwen.status || "unavailable";
  ui.engineRoomOpen.dataset.status = overallStatus;
  ui.engineRoomObserved.textContent = `Sampled ${new Date(snapshot.observed_at).toLocaleTimeString()}`;
  const reason = qwen.reason ? ` · ${pretty(qwen.reason)}` : "";
  const timeline = [...(history.timeline || [])].reverse();
  const reasons = Object.entries(history.decision_reasons || {}).slice(0, 5);
  const historyKnown = history.status !== "world_busy";
  const historyStale = history.status === "stale";
  const telemetryKnown = qwen.telemetry?.status === "measured";
  const evidenceMessages = [];
  if (!telemetryKnown) evidenceMessages.push("Live Qwen health and metrics are unavailable; current load is unknown.");
  if (current.state_evidence !== "measured") evidenceMessages.push("Capacity-state evidence is unavailable; lease and Luna budget values are unknown.");
  if (!historyKnown) evidenceMessages.push("A world turn is active. Recent route history was left unknown so this view could return immediately.");
  if (historyStale) evidenceMessages.push(`A world turn is active. Route history is the last lock-proven sample from ${new Date(history.measured_at).toLocaleTimeString()}.`);
  ui.engineRoomContent.innerHTML = `
    <div class="engine-room-status"><span class="health-dot" data-status="${escapeHtml(overallStatus)}" aria-hidden="true"></span><strong>${escapeHtml(overallStatus)}</strong><span>Laya ${escapeHtml(laya.status || "unknown")} · Qwen router ${escapeHtml(qwen.router_mode || "unknown")}${escapeHtml(reason)} · gate ${escapeHtml(current.gate || "unknown")}</span></div>
    ${evidenceMessages.length ? `<div class="engine-evidence" role="status"><strong>What is not currently proven</strong><ul>${evidenceMessages.map(message => `<li>${escapeHtml(message)}</li>`).join("")}</ul></div>` : '<div class="engine-evidence measured"><strong>Current telemetry and recent route history are available.</strong></div>'}
    <div class="route-strip">
      <section class="route-card" data-route="laya"><div class="route-card-heading"><h3>Laya</h3><span>System 1</span></div><dl>
        <div><dt>Current health</dt><dd>${escapeHtml(laya.status || "unknown")}</dd></div>
        <div><dt>Model</dt><dd>${escapeHtml(laya.model || "unknown")}</dd></div>
        <div><dt>Device</dt><dd>${escapeHtml(laya.device || "unknown")}</dd></div>
        <div><dt>Direct decisions</dt><dd>${escapeHtml(healthValue(history.hierarchical_policy?.kinds?.laya_action))}</dd></div>
        <div><dt>Qwen escalations</dt><dd>${escapeHtml(healthValue(history.hierarchical_policy?.qwen_escalations))}</dd></div>
        <div><dt>Failed escalations</dt><dd>${escapeHtml(healthValue(history.hierarchical_policy?.kinds?.qwen_escalation_failed))}</dd></div>
        <div><dt>Policy latency</dt><dd>${escapeHtml(history.hierarchical_policy?.latency_seconds?.p50 == null ? "No sample" : `${history.hierarchical_policy.latency_seconds.p50}s p50`)}</dd></div>
      </dl></section>
      <span class="route-arrow" aria-hidden="true">→</span>
      <section class="route-card" data-route="qwen"><div class="route-card-heading"><h3>Qwen</h3><span>Preferred</span></div><dl>
        <div><dt>Running requests</dt><dd>${escapeHtml(healthValue(qwen.running))} / ${escapeHtml(healthValue(limits.qwen_running_pressure))}</dd></div>
        <div><dt>Waiting requests</dt><dd>${escapeHtml(healthValue(qwen.waiting))}</dd></div>
        <div><dt>KV cache</dt><dd>${escapeHtml(healthRatio(qwen.kv_cache_ratio))} · ${escapeHtml(qwen.telemetry?.kv_cache || "unknown")}</dd></div>
        <div><dt>Memory available</dt><dd>${escapeHtml(healthBytes(qwen.memory_available_bytes))} · ${escapeHtml(qwen.telemetry?.memory || "unknown")}</dd></div>
        <div><dt>Router leases</dt><dd>${escapeHtml(healthValue(qwen.router_leases?.active))} / ${escapeHtml(healthValue(limits.qwen_router_leases))}</dd></div>
        <div><dt>Recent latency</dt><dd>${escapeHtml(latencyLabel(history, "local:qwen"))}</dd></div>
      </dl></section>
      <span class="route-arrow" aria-hidden="true">→</span>
      <section class="route-card" data-route="luna"><div class="route-card-heading"><h3>Luna overflow</h3><span>Capacity relief</span></div><dl>
        <div><dt>Recent routed turns</dt><dd>${escapeHtml(healthValue(routes["hermes:gpt-5.6-luna"]))}</dd></div>
        <div><dt>In flight</dt><dd>${escapeHtml(healthValue(luna.in_flight))} / ${escapeHtml(healthValue(limits.luna_in_flight))}</dd></div>
        <div><dt>Tokens available</dt><dd>${escapeHtml(healthValue(luna.tokens_available))} / ${escapeHtml(healthValue(limits.luna_bucket_capacity))}</dd></div>
        <div><dt>Token refill</dt><dd>${escapeHtml(healthValue(limits.luna_refill_per_minute))} / minute</dd></div>
        <div><dt>Recent latency</dt><dd>${escapeHtml(latencyLabel(history, "hermes:gpt-5.6-luna"))}</dd></div>
      </dl></section>
      <span class="route-arrow" aria-hidden="true">→</span>
      <section class="route-card" data-route="observe"><div class="route-card-heading"><h3>OBSERVE fallback</h3><span>Fail closed</span></div><dl>
        <div><dt>Fallback turns</dt><dd>${escapeHtml(healthValue(history.observe_fallbacks))} / ${escapeHtml(healthValue(history.turns))}</dd></div>
        <div><dt>Fallback ratio</dt><dd>${escapeHtml(healthRatio(history.observe_fallback_ratio))}</dd></div>
        <div><dt>Deferred routes</dt><dd>${escapeHtml(healthValue(routes.deferred))}</dd></div>
        <div><dt>Decision coverage</dt><dd>${escapeHtml(healthRatio(history.decision_coverage_ratio))}</dd></div>
      </dl></section>
    </div>
    <div class="engine-history">
      <section class="engine-panel"><h3>Recent route decisions</h3><p class="engine-panel-note">${escapeHtml(history.routing_note || "")} Window: ticks ${escapeHtml(healthValue(history.window?.tick_start))}–${escapeHtml(healthValue(history.window?.tick_end))}. Newest tick first.</p>
        <div class="route-timeline">${timeline.map(row => {
          const total = Number(row.laya || 0) + Number(row.qwen || 0) + Number(row.luna || 0) + Number(row.deferred || 0) + Number(row.unobserved || 0);
          return `<div class="route-tick"><span>Tick ${Number(row.tick).toLocaleString()}</span><div class="route-bar">${routeSegments(row)}</div><strong>${row.observe_fallbacks ? `${row.observe_fallbacks} OBS` : `${total} turn${total === 1 ? "" : "s"}`}</strong></div>`;
        }).join("") || `<p class="muted">${historyKnown ? "No inhabitant turns are present in the bounded window." : "Recent history is temporarily unknown while the world is writing a turn."}</p>`}</div>
        <div class="route-legend"><span class="laya">Laya</span><span class="qwen">Qwen</span><span class="luna">Luna</span><span class="deferred">Deferred</span><span class="unobserved">No decision evidence</span></div>
      </section>
      <section class="engine-panel"><h3>Window summary</h3><p class="engine-panel-note">Brief incidents remain visible here after current pressure clears.</p>
        <div class="engine-metrics">
          ${engineMetric("Laya routes", healthValue(routes["local:laya"]))}
          ${engineMetric("Qwen routes", healthValue(routes["local:qwen"]))}
          ${engineMetric("Luna routes", healthValue(routes["hermes:gpt-5.6-luna"]))}
          ${engineMetric("Pressure ticks", healthValue(history.pressure_ticks))}
          ${engineMetric("Evidence", current.state_evidence || "unknown")}
        </div>
        <ul class="engine-reasons">${reasons.map(([name, count]) => `<li><span>${escapeHtml(pretty(name))}</span><strong>${Number(count).toLocaleString()}</strong></li>`).join("") || '<li><span>No recorded capacity decisions</span><strong>—</strong></li>'}</ul>
      </section>
    </div>`;
}

async function refreshModelHealth({ preserveContent = false } = {}) {
  if (modelHealthRetryTimer !== null) {
    window.clearTimeout(modelHealthRetryTimer);
    modelHealthRetryTimer = null;
  }
  ui.engineRoomRefresh.disabled = true;
  if (!preserveContent || modelHealthSnapshot === null) {
    ui.engineRoomCopy.disabled = true;
    ui.engineRoomContent.innerHTML = '<p class="muted">Reading current model capacity and recent route decisions…</p>';
  }
  try {
    const snapshot = await getModelHealth();
    const historyStillBusy = preserveContent
      && modelHealthSnapshot !== null
      && snapshot.history?.status === "world_busy";
    if (!historyStillBusy) renderModelHealth(snapshot);
    if (snapshot.history?.status === "world_busy" && ui.engineRoom.open) {
      modelHealthRetryTimer = window.setTimeout(
        () => refreshModelHealth({ preserveContent: true }), 5000,
      );
    }
  } catch (error) {
    ui.engineRoomOpen.dataset.status = "unavailable";
    if (preserveContent && modelHealthSnapshot !== null) {
      ui.engineRoomObserved.textContent = `Refresh failed: ${error.message || String(error)}`;
    } else {
      ui.engineRoomContent.innerHTML = `<div class="lens-error"><strong>Model health unavailable</strong><p>${escapeHtml(error.message || String(error))}</p></div>`;
    }
  } finally {
    ui.engineRoomRefresh.disabled = false;
  }
}

async function copyInspectorText(value, button, successLabel) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = successLabel;
  } catch (error) {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => { button.textContent = original; }, 1400);
}

function applyGraphViewBox() {
  ui.graph.setAttribute("viewBox", `${graphViewBox.x} ${graphViewBox.y} ${graphViewBox.width} ${graphViewBox.height}`);
  const rect = ui.graph.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const unit = Math.max(graphViewBox.width / rect.width, graphViewBox.height / rect.height);
  // Panning cannot change label collisions; recompute only on zoom or new nodes.
  if (ui.graph.dataset.labelScale === String(unit)) return;
  ui.graph.dataset.labelScale = String(unit);
  const labels = [];
  // Keep place names and hit targets readable when the world grows or zooms out.
  ui.graphNodes.querySelectorAll('.graph-node[data-type="place"]').forEach(node => {
    for (const child of node.children) child.setAttribute("transform", `scale(${unit})`);
    const label = node.querySelector(".node-label");
    label.setAttribute("x", "0"); label.setAttribute("y", "-16");
    label.setAttribute("text-anchor", "middle");
    for (const offset of [-16, -33, 29, -50, 46, -67]) {
      label.setAttribute("y", String(offset));
      const bounds = label.getBoundingClientRect();
      if (!labels.some(other => bounds.left < other.right + 6 && bounds.right + 6 > other.left
        && bounds.top < other.bottom + 3 && bounds.bottom + 3 > other.top)) break;
    }
    labels.push(label.getBoundingClientRect());
  });
}

function resetGraphView({ fit = false } = {}) {
  const types = graphFiltersInitialized ? visibleGraphTypes : defaultGraphTypes;
  const points = (world?.graph?.nodes || []).filter(node => types.has(node.type))
    .map(node => graphPositions.get(node.id)).filter(Boolean);
  if (!points.length) return;
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const spanX = Math.max(700, Math.max(...points.map(point => point.x)) - left);
  const spanY = Math.max(450, Math.max(...points.map(point => point.y)) - top);
  // Leave room for screen-sized labels at the outermost places.
  graphViewBox = { x: left - spanX * .2, y: top - spanY * .15,
    width: spanX * 1.4, height: spanY * 1.3 };
  if (!fit) {
    // A closer default view separates screen-sized dots; Fit map shows all edges.
    graphViewBox.x += graphViewBox.width * .075;
    graphViewBox.y += graphViewBox.height * .075;
    graphViewBox.width *= .85;
    graphViewBox.height *= .85;
  }
  applyGraphViewBox();
}

function centerGraphNode(nodeId) {
  const position = graphPositions.get(nodeId);
  if (!position) return;
  graphViewBox.x = position.x - graphViewBox.width / 2;
  graphViewBox.y = position.y - graphViewBox.height / 2;
  applyGraphViewBox();
  ui.graphNodes.querySelectorAll(".graph-node").forEach(element => element.classList.toggle("match", element.dataset.id === nodeId));
  window.setTimeout(() => ui.graphNodes.querySelector(`[data-id="${CSS.escape(nodeId)}"]`)?.classList.remove("match"), 1800);
}

function activityTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function activityBadge(status) {
  return `<span class="activity-badge" data-status="${escapeHtml(status || "unknown")}">${escapeHtml(title(status || "unknown"))}</span>`;
}

function activityEmpty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }

function renderLogosActivity(snapshot) {
  const runs = snapshot.runs || [];
  ui.logosContent.innerHTML = `
    <div class="activity-summary">
      <div><span>Latest heartbeat</span><strong>${escapeHtml(snapshot.latest_heartbeat ?? "—")}</strong></div>
      <div><span>Recent records</span><strong>${runs.length.toLocaleString()}</strong></div>
      <p>${escapeHtml(snapshot.note || "")}</p>
    </div>
    <div class="activity-list">${runs.map(run => {
      const request = run.request_title || run.request || "No request selected";
      const model = run.model_invoked ? `${run.model || "model"}${run.reasoning ? ` · ${run.reasoning}` : ""}` : "No model call";
      return `<article class="activity-card" data-status="${escapeHtml(run.status)}">
        <div class="activity-card-heading"><div><span class="activity-id">HEARTBEAT ${Number(run.heartbeat).toLocaleString()}</span><h3>${escapeHtml(request)}</h3></div>${activityBadge(run.status)}</div>
        <dl class="activity-facts">
          <div><dt>Decision</dt><dd>${escapeHtml(pretty(run.decision || "unknown"))}</dd></div>
          <div><dt>Lane</dt><dd>${escapeHtml(pretty(run.lane || "none"))}</dd></div>
          <div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div>
          <div><dt>Delivery</dt><dd>${escapeHtml(pretty(run.delivery_status || "not recorded"))}</dd></div>
          <div><dt>Started</dt><dd>${escapeHtml(activityTime(run.started_at))}</dd></div>
          <div><dt>Completed</dt><dd>${escapeHtml(activityTime(run.completed_at))}</dd></div>
        </dl>
        ${run.influence_summary ? `<p class="activity-narrative"><strong>Sol influence</strong>${escapeHtml(run.influence_summary)}</p>` : ""}
        <div class="activity-meta">${run.source_finding_id ? `Finding ${escapeHtml(run.source_finding_id)} · ` : ""}${run.branch ? escapeHtml(run.branch) : "No candidate branch recorded"}${candidateUrl(run.pull_request) ? ` · <a href="${escapeHtml(candidateUrl(run.pull_request))}" target="_blank" rel="noreferrer">Open PR</a>` : ""}</div>
      </article>`;
    }).join("") || activityEmpty("No Logos heartbeat evidence is available yet.")}</div>`;
}

function candidateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch (_error) { return null; }
}

function researchCards(records, emptyMessage) {
  return records.map(item => `<article class="activity-card" data-status="${escapeHtml(item.status || "unknown")}">
    <div class="activity-card-heading"><div><span class="activity-id">${escapeHtml(item.id)}</span><h3>${escapeHtml(item.title || item.id)}</h3></div>${activityBadge(item.status)}</div>
    ${item.hypothesis ? `<p class="activity-narrative"><strong>Hypothesis</strong>${escapeHtml(item.hypothesis)}</p>` : ""}
    ${item.next_step ? `<p class="activity-narrative"><strong>Next step</strong>${escapeHtml(item.next_step)}</p>` : ""}
    <div class="activity-meta">Updated ${escapeHtml(activityTime(item.updated_at))}${item.models?.length ? ` · ${escapeHtml(item.models.map(model => model.resolved_model || model.requested_model || model.route).filter(Boolean).join(", "))}` : ""}</div>
  </article>`).join("") || activityEmpty(emptyMessage);
}

function renderLogosLabActivity(snapshot) {
  const active = snapshot.active || [], terminal = snapshot.terminal || [], candidates = snapshot.candidates || [], runs = snapshot.runs || [];
  ui.logosLabContent.innerHTML = `
    <div class="activity-summary lab-summary">
      <div><span>Active research</span><strong>${active.length.toLocaleString()}</strong></div>
      <div><span>Completed / falsified</span><strong>${terminal.length.toLocaleString()}</strong></div>
      <div><span>Review candidates</span><strong>${candidates.length.toLocaleString()}</strong></div>
      <p>${escapeHtml(snapshot.note || "")}</p>
    </div>
    <section class="activity-section"><h3>Active investigations</h3><div class="activity-list">${researchCards(active, "No investigation is currently active.")}</div></section>
    <section class="activity-section"><h3>Research outcomes</h3><div class="activity-list">${researchCards(terminal, "No durable research outcome has been recorded yet.")}</div></section>
    <section class="activity-section"><h3>Review-only candidates</h3><div class="candidate-list">${candidates.map(candidate => {
      const url = candidateUrl(candidate.url);
      return `<article class="candidate-card"><div><span>REVIEW ONLY</span><strong>${escapeHtml(candidate.branch)}</strong></div>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open PR</a>` : ""}<p>${escapeHtml(candidate.commit.slice(0, 12))} · auto-merge ${candidate.auto_merge === false ? "off" : "unknown"}</p><small>${escapeHtml((candidate.changed_paths || []).join(" · ") || "Changed paths unavailable")}</small></article>`;
    }).join("") || activityEmpty("No review-only candidate has been published.")}</div></section>
    <section class="activity-section"><h3>Recent coordinator runs</h3><div class="run-table">${runs.map(run => `<div class="run-row"><span>${activityBadge(run.status)}<strong>${escapeHtml(run.run_id)}</strong></span><span>${escapeHtml(run.summary || run.failure || run.outcome || "No summary recorded")}</span><time>${escapeHtml(activityTime(run.completed_at || run.started_at))}</time></div>`).join("") || activityEmpty("No coordinator run is recorded.")}</div></section>`;
}

async function refreshAutomationActivity(kind) {
  const content = kind === "lab" ? ui.logosLabContent : ui.logosContent;
  const button = kind === "lab" ? ui.logosLabRefresh : ui.logosRefresh;
  content.innerHTML = `<p class="muted">Reading ${kind === "lab" ? "Logos Lab" : "Logos"} activity…</p>`;
  button.disabled = true;
  try {
    const snapshot = await getAutomationActivity(kind);
    if (kind === "lab") { logosLabSnapshot = snapshot; renderLogosLabActivity(snapshot); }
    else { logosSnapshot = snapshot; renderLogosActivity(snapshot); }
    clearError();
  } catch (error) {
    content.innerHTML = `<div class="lens-error"><strong>Activity unavailable</strong><p>${escapeHtml(error.message || String(error))}</p></div>`;
  } finally { button.disabled = false; }
}

function setView(view) {
  const graphActive = view === "graph", logosActive = view === "logos", labActive = view === "lab";
  const chronicleActive = !graphActive && !logosActive && !labActive;
  ui.graphView.hidden = !graphActive; ui.chronicleView.hidden = !chronicleActive;
  ui.logosView.hidden = !logosActive; ui.logosLabView.hidden = !labActive;
  [[ui.chronicleTab, chronicleActive], [ui.graphTab, graphActive], [ui.logosTab, logosActive], [ui.logosLabTab, labActive]].forEach(([tab, active]) => {
    tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active));
  });
  if (graphActive) {
    applyGraphViewBox();
    if (graphInspectorMode === "health") renderSchemaHealth();
    else if (selectedGraphNode) selectGraphNode(selectedGraphNode);
    else ui.inspector.innerHTML = '<p class="muted">Choose a node to inspect its current projected fields, JSON source path and direct connections.</p>';
  } else if (logosActive) {
    ui.inspector.innerHTML = '<p class="muted">Logos is the authoritative source-engineering heartbeat. This tab shows bounded scheduler evidence, not raw model output.</p>';
    if (!logosSnapshot) refreshAutomationActivity("logos");
  } else if (labActive) {
    ui.inspector.innerHTML = '<p class="muted">Logos Lab is independent, review-only research. Its findings and candidates do not become authoritative until separately reviewed and delivered.</p>';
    if (!logosLabSnapshot) refreshAutomationActivity("lab");
  } else if (selectedInspector) renderInspector(selectedInspector.kind, selectedInspector.id);
}

async function loadEvents(first, last) {
  stopReplay();
  first = Math.max(0, Math.min(world.tick, Number(first) || 0));
  last = Math.max(first, Math.min(world.tick, Number(last) || first));
  ui.from.value = String(first); ui.to.value = String(last); ui.slider.value = String(first);
  ui.selected.textContent = first === last ? `Tick ${first.toLocaleString()}` : `Ticks ${first.toLocaleString()}–${last.toLocaleString()}`;
  ui.status.textContent = "Reading the world record…";
  const result = await getEvents(first, last);
  ui.feed.innerHTML = result.events.map(event => `
    <li class="event" data-sequence="${event.sequence}">
      <div class="event-tick">TICK ${event.tick.toLocaleString()}</div>
      <div><p class="event-summary">${escapeHtml(event.summary)}</p><div class="event-meta">${escapeHtml(title(event.type))} · ${escapeHtml(event.actor)} · #${event.sequence.toLocaleString()}</div>
      <details><summary>Event evidence</summary><pre>${escapeHtml(JSON.stringify({ event_id: event.event_id, payload: event.payload }, null, 2))}</pre></details></div>
    </li>`).join("");
  if (!result.events.length) ui.feed.innerHTML = `<li class="empty">No public world events are recorded at this tick or range.</li>`;
  ui.status.textContent = `${result.events.length.toLocaleString()} event${result.events.length === 1 ? "" : "s"}${result.truncated ? " · first 500 shown" : ""}`;
  clearError();
}

function stopReplay() {
  if (replayTimer) window.clearInterval(replayTimer);
  replayTimer = null;
  ui.replay.innerHTML = '<span aria-hidden="true">▶</span> Replay';
  document.querySelectorAll(".event").forEach(item => item.classList.remove("replay-active", "replay-pending"));
}
function replay() {
  if (replayTimer) { stopReplay(); return; }
  const events = [...document.querySelectorAll(".event[data-sequence]")];
  if (!events.length) return;
  let position = 0;
  events.forEach(item => item.classList.add("replay-pending"));
  ui.replay.textContent = "Pause";
  const step = () => {
    events.forEach((item, index) => {
      item.classList.toggle("replay-active", index === position);
      if (index <= position) item.classList.remove("replay-pending");
    });
    events[position].scrollIntoView({ behavior: "smooth", block: "center" });
    position += 1;
    if (position >= events.length) stopReplay();
  };
  step();
  if (position < events.length) replayTimer = window.setInterval(step, 900);
}

async function refreshWorld(initial = false) {
  if (worldRefreshInFlight) return;
  worldRefreshInFlight = true;
  try {
    const previousHead = world?.event_head?.event_id;
    world = await getWorld();
    if (ui.engineRoom.open) {
      worldRenderDeferred = true;
      return;
    }
    renderWorld();
    if (initial || (ui.follow.checked && previousHead !== world.event_head.event_id)) await loadEvents(world.tick, world.tick);
  } finally {
    worldRefreshInFlight = false;
  }
}

ui.slider.addEventListener("input", () => {
  ui.from.value = ui.to.value = ui.slider.value;
  ui.selected.textContent = `Tick ${Number(ui.slider.value).toLocaleString()}`;
});
ui.slider.addEventListener("change", () => loadEvents(ui.slider.value, ui.slider.value).catch(showError));
ui.show.addEventListener("click", () => loadEvents(ui.from.value, ui.to.value).catch(showError));
ui.latest.addEventListener("click", () => loadEvents(world.tick, world.tick).catch(showError));
ui.replay.addEventListener("click", replay);
ui.follow.addEventListener("change", () => { if (ui.follow.checked) loadEvents(world.tick, world.tick).catch(showError); });
ui.chronicleTab.addEventListener("click", () => setView("chronicle"));
ui.graphTab.addEventListener("click", () => setView("graph"));
ui.logosTab.addEventListener("click", () => setView("logos"));
ui.logosLabTab.addEventListener("click", () => setView("lab"));
ui.logosRefresh.addEventListener("click", () => refreshAutomationActivity("logos"));
ui.logosLabRefresh.addEventListener("click", () => refreshAutomationActivity("lab"));
ui.graphReset.addEventListener("click", () => resetGraphView());
ui.graphFit.addEventListener("click", () => resetGraphView({ fit: true }));
new ResizeObserver(() => applyGraphViewBox()).observe(ui.graphStage);
ui.graphHealth.addEventListener("click", () => { graphInspectorMode = "health"; renderSchemaHealth(); });
if (viewerConfig.mode === "static") {
  ui.engineRoomOpen.hidden = true;
  ui.logosTab.hidden = true;
  ui.logosLabTab.hidden = true;
}
ui.engineRoomOpen.addEventListener("click", () => {
  ui.engineRoom.showModal();
  refreshModelHealth();
});
ui.engineRoomClose.addEventListener("click", () => ui.engineRoom.close());
ui.engineRoomRefresh.addEventListener("click", refreshModelHealth);
ui.engineRoomCopy.addEventListener("click", () => {
  if (modelHealthSnapshot?.model_brief) copyInspectorText(modelHealthSnapshot.model_brief, ui.engineRoomCopy, "Copied");
});
ui.engineRoom.addEventListener("click", event => { if (event.target === ui.engineRoom) ui.engineRoom.close(); });
ui.engineRoom.addEventListener("close", () => {
  if (modelHealthRetryTimer !== null) window.clearTimeout(modelHealthRetryTimer);
  modelHealthRetryTimer = null;
  if (worldRenderDeferred) {
    worldRenderDeferred = false;
    renderWorld();
    if (ui.follow.checked) loadEvents(world.tick, world.tick).catch(showError);
  }
});
ui.inspectorExpand.addEventListener("click", () => {
  const expanded = !ui.inspectorPanel.classList.contains("fullscreen");
  ui.inspectorPanel.classList.toggle("fullscreen", expanded);
  document.body.classList.toggle("inspector-open", expanded);
  ui.inspectorExpand.textContent = expanded ? "Exit full screen" : "Full screen";
  ui.inspectorExpand.setAttribute("aria-pressed", String(expanded));
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && ui.inspectorPanel.classList.contains("fullscreen")) ui.inspectorExpand.click();
});
ui.graphSearch.addEventListener("input", () => {
  const query = ui.graphSearch.value.trim().toLocaleLowerCase();
  ui.graphNodes.querySelectorAll(".graph-node").forEach(element => element.classList.remove("match"));
  if (!query || !world?.graph) return;
  const match = world.graph.nodes.find(node => node.label.toLocaleLowerCase().includes(query) || node.ref.toLocaleLowerCase().includes(query));
  if (match) selectGraphNode(match.id, true);
});
ui.graph.addEventListener("click", event => {
  if (event.target === ui.graph) { selectedGraphNode = null; highlightGraphSelection(); }
});
ui.graph.addEventListener("wheel", event => {
  event.preventDefault();
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ui.graph.getScreenCTM().inverse());
  const worldX = point.x, worldY = point.y;
  const horizontal = (worldX - graphViewBox.x) / graphViewBox.width;
  const vertical = (worldY - graphViewBox.y) / graphViewBox.height;
  const factor = event.deltaY > 0 ? 1.14 : 0.86;
  const width = Math.max(420, Math.min(30000, graphViewBox.width * factor));
  const height = width * graphViewBox.height / graphViewBox.width;
  graphViewBox = { x: worldX - horizontal * width, y: worldY - vertical * height, width, height };
  applyGraphViewBox();
}, { passive: false });
ui.graph.addEventListener("pointerdown", event => {
  graphDrag = { x: event.clientX, y: event.clientY, viewX: graphViewBox.x, viewY: graphViewBox.y };
  ui.graph.setPointerCapture(event.pointerId);
  ui.graph.classList.add("dragging");
});
ui.graph.addEventListener("pointermove", event => {
  if (!graphDrag) return;
  const scale = ui.graph.getScreenCTM();
  graphViewBox.x = graphDrag.viewX - (event.clientX - graphDrag.x) / scale.a;
  graphViewBox.y = graphDrag.viewY - (event.clientY - graphDrag.y) / scale.d;
  applyGraphViewBox();
});
ui.graph.addEventListener("pointerup", event => {
  graphDrag = null;
  ui.graph.releasePointerCapture(event.pointerId);
  ui.graph.classList.remove("dragging");
});
ui.graph.addEventListener("pointercancel", () => { graphDrag = null; ui.graph.classList.remove("dragging"); });
ui.graphTooltip.addEventListener("mouseenter", cancelGraphTooltipHide);
ui.graphTooltip.addEventListener("mouseleave", scheduleGraphTooltipHide);
ui.graphTooltip.addEventListener("focusin", cancelGraphTooltipHide);
ui.graphTooltip.addEventListener("focusout", event => {
  if (!ui.graphTooltip.contains(event.relatedTarget)) scheduleGraphTooltipHide();
});
refreshWorld(true).catch(showError);
window.setInterval(() => refreshWorld(false).catch(showError), 3000);
