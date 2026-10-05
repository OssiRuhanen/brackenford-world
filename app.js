"use strict";

const ui = {
  worldTick: document.querySelector("#world-tick"), eventHead: document.querySelector("#event-head"),
  worldFreshness: document.querySelector("#world-freshness"),
  worldClock: document.querySelector("#world-clock"), people: document.querySelector("#inhabitant-list"),
  places: document.querySelector("#place-list"), inspector: document.querySelector("#inspector-content"),
  inspectorPanel: document.querySelector("#inspector"), inspectorExpand: document.querySelector("#inspector-expand"),
  from: document.querySelector("#from-tick"), to: document.querySelector("#to-tick"),
  slider: document.querySelector("#tick-slider"), selected: document.querySelector("#selected-tick"),
  show: document.querySelector("#show-range"), latest: document.querySelector("#jump-live"),
  replay: document.querySelector("#replay"), follow: document.querySelector("#live-follow"),
  status: document.querySelector("#feed-status"), feed: document.querySelector("#event-feed"),
  eventFilter: document.querySelector("#event-filter"),
  storyTab: document.querySelector("#story-tab"), storyView: document.querySelector("#story-view"),
  storyFeed: document.querySelector("#story-feed"), storyStatus: document.querySelector("#story-status"),
  storyRefresh: document.querySelector("#story-refresh"), storyImportance: document.querySelector("#story-importance"),
  storyCategory: document.querySelector("#story-category"), storyPerson: document.querySelector("#story-person"),
  error: document.querySelector("#error-banner"),
  chronicleTab: document.querySelector("#chronicle-tab"), graphTab: document.querySelector("#graph-tab"),
  characterReplayTab: document.querySelector("#character-replay-tab"),
  characterReplayView: document.querySelector("#character-replay-view"),
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
  operationalHealthOpen: document.querySelector("#operational-health-open"), operationalHealth: document.querySelector("#operational-health"),
  operationalHealthClose: document.querySelector("#operational-health-close"), operationalHealthRefresh: document.querySelector("#operational-health-refresh"),
  operationalHealthCopy: document.querySelector("#operational-health-copy"),
  operationalHealthContent: document.querySelector("#operational-health-content"), operationalHealthObserved: document.querySelector("#operational-health-observed"),
  operationalHealthLabel: document.querySelector("#operational-health-label"),
};

let world = null;
let replayTimer = null;
let selectedInspector = null;
let selectedGraphNode = null;
let graphInspectorTab = "overview";
let graphInspectorMode = "node";
const characterLensCache = new Map();
const characterDirectionCache = new Map();
const characterStoryCache = new Map();
let staticCharacterStoriesPromise = null;
const jsonExpansionState = new Map();
const jsonScrollState = new Map();
const disclosureState = new Map();
let graphPositions = new Map();
let graphViewBox = { x: 0, y: 0, width: 1400, height: 900 };
let graphDrag = null;
let graphFiltersInitialized = false;
let graphTooltipHideTimer = null;
let renderedGraphIdentity = null;
let modelHealthSnapshot = null;
let operationalHealthSnapshot = null;
let modelHealthRetryTimer = null;
let worldRefreshInFlight = false;
let worldRenderDeferred = false;
let worldRefreshTimer = null;
let renderedWorldIdentity = null;
let operationalHealthInFlight = false;
let operationalHealthRetryAfter = 0;
const OPERATIONAL_HEALTH_REFRESH_MS = 30000;
let logosSnapshot = null;
let logosLabSnapshot = null;
let storySnapshot = null;
let eventSnapshot = null;
let eventRequestGeneration = 0;
let storyPreviousSeen = 0;
let storyRequestGeneration = 0;
let liveSnapshotBase = null;
const STORY_SEEN_KEY = "brackenford-world-story-sequence";
const visibleGraphTypes = new Set();
const defaultGraphTypes = new Set(["place", "inhabitant", "npc"]);
const viewerConfig = window.BRACKENFORD_VIEWER || { mode: "api" };
const liveApiBase = typeof viewerConfig.liveApiBase === "string" ? viewerConfig.liveApiBase.replace(/\/+$/, "") : null;
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

function resetProjectionCaches() {
  storyRequestGeneration += 1;
  if (storySnapshot || ui.storyRefresh.disabled) {
    ui.storyStatus.textContent = "The world publication changed. Refresh to read its story.";
  }
  ui.storyRefresh.disabled = false;
  staticCharacterStoriesPromise = null;
  characterStoryCache.clear();
  logosSnapshot = null;
  logosLabSnapshot = null;
  storySnapshot = null;
  eventSnapshot = null;
}

async function getWorld() {
  if (viewerConfig.mode !== "static") return getJson("/api/world");
  if (liveApiBase) {
    try {
      const manifest = await getJson(`${liveApiBase}/api/v1/latest.json`);
      if (manifest.schema !== "brackenford-public-snapshot/v1" || !/^[a-f0-9]{64}$/.test(manifest.snapshot_id || "")) {
        throw new Error("Live projection returned an invalid manifest.");
      }
      const candidateBase = `${liveApiBase}/api/v1/snapshots/${manifest.snapshot_id}/`;
      const candidateWorld = await getJson(new URL("data/world.json", candidateBase).href);
      if (liveSnapshotBase !== candidateBase) resetProjectionCaches();
      liveSnapshotBase = candidateBase;
      return candidateWorld;
    } catch (error) {
      console.warn("Live projection unavailable; using the bundled snapshot.", error);
      if (liveSnapshotBase) resetProjectionCaches();
      liveSnapshotBase = null;
    }
  }
  return getJson("data/world.json");
}

function projectionPath(path) {
  return liveSnapshotBase ? new URL(path, liveSnapshotBase).href : path;
}

async function getEvents(first, last) {
  if (viewerConfig.mode !== "static") {
    return getJson(`/api/events?from_tick=${first}&to_tick=${last}&limit=500`);
  }
  const relevant = (world.event_chunks || []).filter(chunk => chunk.last_tick >= first && chunk.first_tick <= last);
  const events = [];
  let truncated = false;
  for (const chunk of relevant) {
    const body = await getJson(projectionPath(`data/events/${chunk.file}`));
    for (const event of body.events) {
      if (event.tick >= first && event.tick <= last) events.push(event);
      if (events.length > 500) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { from_tick: first, to_tick: last, events: events.slice(0, 500), truncated, limit: 500 };
}

async function getWorldStory() {
  if (viewerConfig.mode !== "static") return getJson("/api/world-story?limit=160");
  const fallback = world.world_story_fallback;
  try {
    return await getJson(projectionPath(world.world_story_file || "data/world-story.json"));
  } catch (error) {
    if (fallback) return fallback;
    throw error;
  }
}

async function getCharacterLens(identity) {
  if (viewerConfig.mode === "static" || !world.character_lens_available) {
    throw new Error("Character lens is available only from an explicitly enabled local viewer.");
  }
  return getJson(`/api/character?identity=${encodeURIComponent(identity)}`);
}
async function getCharacterStory(identity) {
  if (viewerConfig.mode !== "static") {
    return getJson(`/api/character-story?identity=${encodeURIComponent(identity)}&limit=80`);
  }
  if (!staticCharacterStoriesPromise) {
    staticCharacterStoriesPromise = getJson(projectionPath(world.character_story_file || "data/character-stories.json"));
  }
  const request = staticCharacterStoriesPromise;
  let stories;
  try {
    stories = await request;
  } catch (error) {
    // Share an in-flight read, but let a failed publication be retried. A late
    // failure from a replaced snapshot must not clear its newer request.
    if (staticCharacterStoriesPromise === request) staticCharacterStoriesPromise = null;
    throw error;
  }
  return stories[identity] || {
    identity, through_tick: world.tick, events: [], total_events: 0, truncated: false, limit: 80,
    privacy: "Public authoritative events only.",
  };
}
async function getCharacterDirection(identity) {
  if (viewerConfig.mode === "static" || !world.character_direction_available) {
    throw new Error("Character direction is available only from the loopback local viewer.");
  }
  return getJson(`/api/character-direction?identity=${encodeURIComponent(identity)}`);
}
async function getModelHealth() {
  if (viewerConfig.mode === "static" || world?.model_health_available === false) throw new Error("Engine room is available only from a loopback local viewer.");
  return getJson("/api/model-health");
}
async function getOperationalHealth() {
  if (viewerConfig.mode === "static" || world?.operational_health_available === false) throw new Error("Operational health is available only from a loopback local viewer.");
  return getJson("/api/operational-health");
}
async function getAutomationActivity(kind) {
  if (viewerConfig.mode === "static") {
    const file = kind === "lab" ? world.logos_lab_activity_file : world.logos_activity_file;
    if (!file) throw new Error("A public automation snapshot is not available in this publication.");
    return getJson(projectionPath(file));
  }
  return getJson(kind === "lab" ? "/api/logos-lab-activity" : "/api/logos-activity");
}
function showError(error) { ui.error.textContent = error.message || String(error); ui.error.hidden = false; }
function clearError() { ui.error.hidden = true; }
function showWorldError(error) {
  ui.worldFreshness.dataset.status = "waiting";
  ui.worldFreshness.querySelector("strong").textContent = world ? "Last proven" : "Waiting";
  showError(error);
}
function navButton(kind, id, name, meta) {
  return `<button type="button" data-kind="${kind}" data-id="${escapeHtml(id)}"><span class="nav-title">${escapeHtml(name)}</span><span class="nav-meta">${escapeHtml(meta || "")}</span></button>`;
}

function worldIdentity(value) {
  return `${value?.world_id || "unknown"}:${value?.tick ?? "unknown"}:${value?.event_head?.event_id || "none"}:${value?.event_head?.sequence ?? 0}`;
}

function renderWorldFreshness() {
  const evidence = world?.projection_evidence || {};
  const published = viewerConfig.mode === "static" && !evidence.status;
  const status = published ? "measured" : (evidence.status || "unknown");
  ui.worldFreshness.dataset.status = status;
  const label = published ? "Published" : status === "measured" ? "Live" : status === "stale" ? "Last proven" : title(status);
  ui.worldFreshness.querySelector("strong").textContent = label;
  ui.worldFreshness.title = evidence.observed_at
    ? `${label} snapshot sampled ${new Date(evidence.observed_at).toLocaleTimeString()}`
    : `${label} snapshot`;
}

function renderWorld() {
  characterReplayer.updateWorld(world, viewerConfig.mode);
  ui.worldTick.textContent = world.tick.toLocaleString();
  ui.eventHead.textContent = world.event_head.event_id ? `#${world.event_head.sequence.toLocaleString()} · ${world.event_head.event_id.slice(0, 8)}` : "No events";
  const clock = world.clock || {};
  ui.worldClock.textContent = clock.phase ? `Day ${clock.day} · ${title(clock.phase)}` : `Tick ${world.tick}`;
  ui.people.innerHTML = world.inhabitants.map(person => navButton("person", person.id, person.name, placeName(person.current_place))).join("");
  ui.places.innerHTML = world.places.map(place => navButton("place", place.id, place.name, `${place.inhabitants.length} here`)).join("");
  ui.slider.max = String(world.tick);
  ui.from.max = ui.to.max = String(world.tick);
  ui.engineRoomOpen.hidden = !world.model_health_available;
  ui.operationalHealthOpen.hidden = !world.operational_health_available;
  ui.logosTab.hidden = !world.logos_activity_available;
  ui.logosLabTab.hidden = !world.logos_lab_activity_available;
  document.querySelectorAll(".directory button").forEach(button => button.addEventListener("click", inspect));
  if (!ui.graphView.hidden) {
    renderGraph();
    renderSelectedGraphInspector();
  } else if (!ui.chronicleView.hidden && selectedInspector) {
    renderInspector(selectedInspector.kind, selectedInspector.id);
  }
  renderedWorldIdentity = worldIdentity(world);
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
    if (!person) { selectedInspector = null; showMissingSelection(); return; }
    const skills = Object.entries(person.skills || {}).sort((a, b) => (b[1].level || 0) - (a[1].level || 0));
    ui.inspector.innerHTML = `
      <h2>${escapeHtml(person.name)}</h2><p class="role">${escapeHtml(person.species ? `${title(person.species)} · ${person.role}` : person.role)}</p>
      <div class="fact-grid"><div class="fact"><span>Location</span><strong>${escapeHtml(placeName(person.current_place))}</strong></div><div class="fact"><span>Work role</span><strong>${escapeHtml(title(person.work_role || person.role))}</strong></div></div>
      <section class="detail-section"><button type="button" class="primary" data-open-journey>Open Journey</button></section>
      <section class="detail-section"><h3>Inventory</h3>${inventory(person.inventory)}</section>
      <section class="detail-section"><h3>Skills</h3>${list(skills, ([name, value]) => `${escapeHtml(title(name))} <strong>level ${escapeHtml(value.level ?? 0)}</strong>`)}</section>
      <section class="detail-section"><h3>Attributes</h3>${tags(Object.entries(person.attributes || {}).map(([name, value]) => `${pretty(name)} ${value}`))}</section>
      <section class="detail-section"><h3>Affordances</h3>${tags(person.affordances)}</section>`;
  } else {
    const place = world.places.find(item => item.id === id);
    if (!place) { selectedInspector = null; showMissingSelection(); return; }
    const residents = place.inhabitants.map(personId => world.inhabitants.find(item => item.id === personId)).filter(Boolean);
    ui.inspector.innerHTML = `
      <h2>${escapeHtml(place.name)}</h2><p class="role">${escapeHtml(place.description || place.name)}</p>
      <section class="detail-section"><h3>Inhabitants</h3>${list(residents, person => `<strong>${escapeHtml(person.name)}</strong><br>${escapeHtml(person.role || "")}`)}</section>
      <section class="detail-section"><h3>Other residents</h3>${list(place.npcs, npc => `<strong>${escapeHtml(npc.name || title(npc.id))}</strong><br>${escapeHtml(npc.role || "")}`)}</section>
      <section class="detail-section"><h3>Resources</h3>${list(place.resources, node => `<strong>${escapeHtml(title(node.material || node.id))}</strong> · ${Number(node.quantity || 0).toLocaleString()} available<br>${escapeHtml(title(node.kind))}`)}</section>
      <section class="detail-section"><h3>Buildings</h3>${list(place.buildings, building => `<strong>${escapeHtml(building.name || title(building.id))}</strong>`)}</section>
      <section class="detail-section"><h3>Active situations</h3>${list(place.situations, situation => `<strong>${escapeHtml(title(situation.template || situation.id))}</strong><br>${escapeHtml(title(situation.status))}`)}</section>`;
  }
  ui.inspector.querySelector("[data-open-journey]")?.addEventListener("click", () => {
    graphInspectorTab = "journey";
    setView("graph");
    selectGraphNode(`inhabitant:${id}`);
  });
}

function showMissingSelection() {
  ui.inspector.innerHTML = '<p class="muted">This selection is no longer present in the current snapshot. Choose another item.</p>';
}

function renderSelectedGraphInspector() {
  const hadSelection = Boolean(selectedGraphNode);
  const node = world.graph?.nodes.find(item => item.id === selectedGraphNode);
  if (hadSelection && !node) {
    selectedGraphNode = null; graphInspectorTab = "overview";
    highlightGraphSelection();
  }
  if (graphInspectorMode === "health") { renderSchemaHealth(); return; }
  if (node) { renderGraphInspector(node); return; }
  if (hadSelection) showMissingSelection();
  else {
    ui.inspector.innerHTML = '<p class="muted">Choose a node to inspect its current projected fields, JSON source path and direct connections.</p>';
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

function graphIdentity(graph) {
  return JSON.stringify({
    nodes: graph.nodes.map(node => [node.id, node.type, node.label, node.map]),
    edges: graph.edges.map(edge => [edge.id, edge.source, edge.target, edge.relation]),
  });
}

function moveGraphFocus(current, key) {
  const nodes = [...ui.graphNodes.querySelectorAll(".graph-node")].filter(node => !node.hidden);
  if (!nodes.length) return;
  const index = Math.max(0, nodes.indexOf(current));
  const target = key === "Home" ? nodes[0]
    : key === "End" ? nodes[nodes.length - 1]
    : nodes[(index + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) + nodes.length) % nodes.length];
  nodes.forEach(node => node.setAttribute("tabindex", node === target ? "0" : "-1"));
  target.focus();
}

function renderGraph() {
  const graph = world?.graph;
  if (!graph) return;
  const identity = graphIdentity(graph);
  if (identity === renderedGraphIdentity) {
    renderGraphHealthStatus();
    applyGraphVisibility();
    applyGraphViewBox();
    return;
  }
  const firstLayout = graphPositions.size === 0;
  graphPositions = layoutWorldGraph(graph, graphPositions);
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
      transform: `translate(${position.x} ${position.y})`, class: "graph-node", tabindex: "-1",
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
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault(); moveGraphFocus(group, event.key);
      }
    });
    ui.graphNodes.append(group);
  });
  renderedGraphIdentity = identity;
  applyGraphVisibility();
  if (firstLayout) resetGraphView();
  else applyGraphViewBox();
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
  const focusable = [...ui.graphNodes.querySelectorAll(".graph-node")].filter(element => !element.hidden);
  const activeNode = ui.graphNodes.contains(document.activeElement) ? document.activeElement : null;
  const focusTarget = focusable.find(element => element.dataset.id === selectedGraphNode)
    || focusable.find(element => element === activeNode) || focusable[0];
  focusable.forEach(element => element.setAttribute("tabindex", element === focusTarget ? "0" : "-1"));
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
  if (!node) {
    if (selectedGraphNode === nodeId) renderSelectedGraphInspector();
    return;
  }
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
  const journeyAvailable = node.type === "inhabitant";
  const modelViewAvailable = node.type === "inhabitant" && world.character_lens_available;
  if (graphInspectorTab === "journey" && !journeyAvailable) graphInspectorTab = "overview";
  if (graphInspectorTab === "model" && !modelViewAvailable) graphInspectorTab = "overview";
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
      ${journeyAvailable ? `<button type="button" role="tab" data-inspector-tab="journey" aria-selected="${selected("journey")}" class="${selected("journey") ? "active" : ""}">Journey</button>` : ""}
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
    ${journeyAvailable ? `<div role="tabpanel" class="inspector-panel" data-inspector-panel="journey" ${selected("journey") ? "" : "hidden"}>${characterJourneyMarkup(node)}</div>` : ""}
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
  bindCharacterDirectionActions(node);
  bindCharacterStoryActions(node);
  if (selected("journey") && !characterStoryCache.has(node.ref)) loadCharacterStory(node);
  if (selected("journey") && world.character_direction_available) loadCharacterDirection(node);
  if (selected("model") && modelViewAvailable && !characterLensCache.has(node.ref)) loadCharacterLens(node);
}

function characterGoalLabel(goal) {
  const objective = goal?.objective || {};
  if (objective.kind === "PRACTICE_SKILL") return `Practise ${title(objective.skill_id)}`;
  if (objective.kind === "REACH_SKILL_LEVEL") return `Reach ${title(objective.skill_id)} level ${objective.target_level}`;
  if (objective.kind === "CONTRIBUTE_BUILDING") return `Help complete ${title(objective.building_id)}`;
  if (objective.kind === "REPAIR_BRIDGE") return `Repair ${title(objective.work_id || "the bridge")}`;
  if (objective.kind === "ADOPT_SETTLEMENT_PRIORITY") return `Support ${title(objective.settlement_id)} priority ${objective.source_goal_id}`;
  return title(objective.kind || "Recorded personal goal");
}

function characterDirectionItems(goal) {
  const context = goal?.planning_context;
  if (!context || goal.effective_status !== "active") return [];
  const rows = [];
  for (const option of context.practice_options || []) {
    const grounding = option.grounding || {};
    const subject = option.work_id || option.node_id || option.action_type || "practice option";
    const location = option.location ? ` at ${placeName(option.location)}` : "";
    rows.push(`${title(subject)}${location} · ${pretty(grounding.status || "unverified")}`);
  }
  if (context.skill_id) rows.push(`Build ${title(context.skill_id)} through accepted skill-bearing actions.`);
  for (const material of context.materials || []) {
    if (Number(material.missing_quantity || 0) > 0) rows.push(`Obtain ${material.missing_quantity} ${pretty(material.item_id)}.`);
  }
  const route = context.repair_route || context.building_route;
  if (route?.next_move) rows.push(`Travel next to ${placeName(route.next_move)} toward ${placeName(route.location)}.`);
  else if (route?.reachable_now === false) rows.push(`${placeName(route.location)} is not currently reachable.`);
  if (context.settlement_id) rows.push(`Contribute independently to the recorded ${title(context.settlement_id)} priority.`);
  if (context.requirements_met === true && context.can_execute_now === true) rows.push("The completion action is executable now.");
  return rows.slice(0, 5);
}

function characterPrivateJourneyMarkup(node) {
  if (!world.character_direction_available) {
    return '<div class="timeline-note"><strong>Inner direction is local</strong><span>Self-authored goals and current grounded direction are available only in the loopback viewer. Public history remains available below.</span></div>';
  }
  const entry = characterDirectionCache.get(node.ref);
  if (!entry || entry.revision !== worldIdentity(world) || entry.status === "loading") {
    return '<div class="lens-loading"><span class="lens-spinner" aria-hidden="true"></span><p>Reading the character\'s current goal and direction…</p></div>';
  }
  if (entry.status === "error") {
    return `<div class="lens-error"><strong>Private direction unavailable</strong><p>${escapeHtml(entry.message)}</p><button type="button" data-refresh-direction>Try again</button></div>`;
  }
  const directionView = entry.data;
  const goal = directionView.personal_goal;
  const ambition = directionView.ambition;
  const direction = characterDirectionItems(goal);
  const progress = goal?.progress;
  const activeCommitments = directionView.active_commitments || [];
  const coordinationIntentions = (directionView.public_coordination?.memberships || []).flatMap(record => {
    const participant = record.participants?.[node.ref];
    const commitment = participant?.commitment;
    const rows = record.status === "open" && record.goal ? [`Participating in: ${record.goal}`] : [];
    if (commitment?.status === "active" && commitment.text) rows.push(`Committed: ${commitment.text}`);
    return rows;
  });
  const commitments = [
    ...activeCommitments.map(item => item.request?.title || item.request?.description || item.request?.opportunity_id || "Recorded commitment"),
    ...coordinationIntentions,
  ];
  const wants = [
    ambition ? `<blockquote class="ambition-seed">${escapeHtml(ambition)}</blockquote>` : "",
    goal ? `<div class="journey-goal"><strong>${escapeHtml(characterGoalLabel(goal))}</strong><span>${escapeHtml(title(goal.effective_status || goal.status || "unknown"))}${progress && Number.isFinite(progress.current) && Number.isFinite(progress.target) ? ` · ${Number(progress.current).toLocaleString()} / ${Number(progress.target).toLocaleString()}` : ""}</span></div>` : "",
  ].join("");
  return `
    <div class="lens-warning"><strong>Local character direction</strong><span>Goals guide attention but grant no action or guaranteed outcome. Memories, beliefs and model reasoning are not included.</span></div>
    <div class="section-heading"><p class="json-note">Direction snapshot at tick ${escapeHtml(directionView.tick ?? "unknown")}${directionView.tick !== world.tick ? " · different from the displayed world tick" : ""}</p><button type="button" class="text-action" data-refresh-direction>Refresh direction</button></div>
    <section class="journey-section"><h3>What they want</h3>${wants || '<p class="muted">No active self-authored goal or reviewed broad ambition is recorded.</p>'}</section>
    <section class="journey-section"><h3>Current direction</h3>${direction.length ? `<ul class="detail-list">${direction.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p class="muted">No currently grounded next step is recorded. This does not mean the character has no interests.</p>'}</section>
    ${commitments.length ? `<section class="journey-section"><h3>Public commitments</h3><ul class="detail-list">${commitments.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}`;
}

function characterJourneyMarkup(node) {
  const entry = characterStoryCache.get(node.ref);
  const privateMarkup = characterPrivateJourneyMarkup(node);
  if (!entry || entry.status === "loading") {
    return `${privateMarkup}<div class="lens-loading"><span class="lens-spinner" aria-hidden="true"></span><p>Reading public character milestones…</p></div>`;
  }
  if (entry.status === "error") {
    return `${privateMarkup}<div class="lens-error"><strong>Public story unavailable</strong><p>${escapeHtml(entry.message)}</p><button type="button" data-refresh-story>Try again</button></div>`;
  }
  const story = entry.data;
  const categories = {};
  for (const event of story.events || []) categories[event.category] = (categories[event.category] || 0) + 1;
  const rows = [...(story.events || [])].reverse().map(event => `
    <li class="strategy-event recorded">
      <div class="strategy-event-heading"><span>Tick ${Number(event.tick).toLocaleString()}</span><span>${escapeHtml(event.category)} · ${escapeHtml(event.participation)}</span></div>
      <p>${escapeHtml(readableEventSummary(event))}</p>
      <details data-disclosure="event:${escapeHtml(event.event_id)}" ${disclosureOpen(node.id, 'event:' + event.event_id) ? "open" : ""}><summary>${escapeHtml(title(event.type))} · evidence</summary><pre>${escapeHtml(JSON.stringify({ event_id:event.event_id, actor:event.actor, detail:event.detail }, null, 2))}</pre></details>
    </li>`).join("");
  return `${privateMarkup}
    <section class="journey-section"><div class="section-heading"><h3>What they have done</h3><button type="button" class="text-action" data-refresh-story>Refresh</button></div>
      <p class="json-note">Public validated milestones through tick ${Number(story.through_tick || 0).toLocaleString()}. Routine noise and private cognition are omitted.</p>
      <div class="timeline-categories">${Object.entries(categories).sort().map(([category, count]) => `<span>${escapeHtml(category)} <strong>${Number(count).toLocaleString()}</strong></span>`).join("") || '<span>No milestones yet</span>'}</div>
      ${story.truncated ? `<p class="json-note">Showing the newest ${Number(story.limit).toLocaleString()} of ${Number(story.total_events).toLocaleString()} milestones.</p>` : ""}
      <ol class="strategy-timeline">${rows || '<li class="timeline-empty"><p>No public character milestones are recorded yet.</p></li>'}</ol>
    </section>`;
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
    <details class="prompt-block" data-disclosure="identity" ${disclosureOpen(node.id, "identity") ? "open" : ""}><summary>Identity context</summary><pre>${escapeHtml(lens.identity_context)}</pre></details>
    <details class="prompt-block" data-disclosure="contract" ${disclosureOpen(node.id, "contract") ? "open" : ""}><summary>Dynamic action contract</summary><pre>${escapeHtml(lens.action_contract)}</pre></details>
    <details class="prompt-block" data-disclosure="direct" ${disclosureOpen(node.id, "direct") ? "open" : ""}><summary>Direct model input</summary><div class="prompt-actions"><button type="button" class="text-action" data-copy-lens="direct-system">Copy system</button><button type="button" class="text-action" data-copy-lens="direct-user">Copy user JSON</button></div><h4>System</h4><pre>${escapeHtml(lens.direct_model_input.system)}</pre><h4>User</h4><pre>${escapeHtml(lens.direct_model_input.user)}</pre></details>
    <details class="prompt-block" data-disclosure="openchara" ${disclosureOpen(node.id, "openchara") ? "open" : ""}><summary>OpenChara latest user message</summary><div class="prompt-actions"><button type="button" class="text-action" data-copy-lens="openchara-user">Copy message</button></div><p>${escapeHtml(lens.openchara_model_input.system_note)}</p><pre>${escapeHtml(lens.openchara_model_input.user)}</pre></details>`;
}

function jsonTreeStateKey(node, surface) {
  const stateKey = `${node.id}:${surface}`;
  if (!jsonExpansionState.has(stateKey)) jsonExpansionState.set(stateKey, new Set(["$"]));
  return stateKey;
}

function disclosureScope(scope) {
  return JSON.stringify([world?.world_id, scope]);
}

function disclosureOpen(scope, disclosure) {
  return disclosureState.get(disclosureScope(scope))?.has(disclosure) || false;
}

function bindDisclosures(root, scope) {
  const stateKey = disclosureScope(scope);
  root.querySelectorAll("details[data-disclosure]").forEach(details => {
    details.addEventListener("toggle", () => {
      if (!details.isConnected) return;
      const expanded = disclosureState.get(stateKey) || new Set();
      if (details.open) expanded.add(details.dataset.disclosure);
      else expanded.delete(details.dataset.disclosure);
      disclosureState.set(stateKey, expanded);
    });
    details.querySelectorAll("pre").forEach((pre, index) => {
      const scrollKey = JSON.stringify([stateKey, details.dataset.disclosure, index]);
      pre.scrollTop = jsonScrollState.get(scrollKey) || 0;
      pre.addEventListener("scroll", () => {
        if (pre.isConnected) jsonScrollState.set(scrollKey, pre.scrollTop);
      }, { passive: true });
    });
  });
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
  bindDisclosures(ui.inspector, node.id);
}

async function loadCharacterLens(node, force = false) {
  const existing = characterLensCache.get(node.ref);
  if (!force && existing) return;
  characterLensCache.set(node.ref, { status: "loading" });
  if (!ui.graphView.hidden && selectedGraphNode === node.id && ["journey", "model"].includes(graphInspectorTab)) renderSelectedGraphInspector();
  try {
    const data = await getCharacterLens(node.ref);
    characterLensCache.set(node.ref, { status: "ready", data });
  } catch (error) {
    characterLensCache.set(node.ref, { status: "error", message: error.message || String(error) });
  }
  if (!ui.graphView.hidden && selectedGraphNode === node.id && ["journey", "model"].includes(graphInspectorTab)) renderSelectedGraphInspector();
}

async function loadCharacterDirection(node, force = false) {
  const revision = worldIdentity(world);
  const existing = characterDirectionCache.get(node.ref);
  if (existing?.revision === revision && (!force || existing.status === "loading")) return;
  const request = { status: "loading", revision };
  characterDirectionCache.set(node.ref, request);
  if (!ui.graphView.hidden && selectedGraphNode === node.id && graphInspectorTab === "journey") renderSelectedGraphInspector();
  try {
    const data = await getCharacterDirection(node.ref);
    if (characterDirectionCache.get(node.ref) !== request || worldIdentity(world) !== revision) return;
    characterDirectionCache.set(node.ref, { status: "ready", revision, data });
  } catch (error) {
    if (characterDirectionCache.get(node.ref) !== request || worldIdentity(world) !== revision) return;
    characterDirectionCache.set(node.ref, { status: "error", revision, message: error.message || String(error) });
  }
  if (!ui.graphView.hidden && selectedGraphNode === node.id && graphInspectorTab === "journey") renderSelectedGraphInspector();
}

async function loadCharacterStory(node, force = false) {
  const existing = characterStoryCache.get(node.ref);
  if (!force && existing) return;
  characterStoryCache.set(node.ref, { status: "loading" });
  if (!ui.graphView.hidden && selectedGraphNode === node.id && graphInspectorTab === "journey") renderSelectedGraphInspector();
  try {
    const data = await getCharacterStory(node.ref);
    characterStoryCache.set(node.ref, { status: "ready", data });
  } catch (error) {
    characterStoryCache.set(node.ref, { status: "error", message: error.message || String(error) });
  }
  if (!ui.graphView.hidden && selectedGraphNode === node.id && graphInspectorTab === "journey") renderSelectedGraphInspector();
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

function bindCharacterStoryActions(node) {
  ui.inspector.querySelectorAll("[data-refresh-story]").forEach(button => button.addEventListener("click", () => loadCharacterStory(node, true)));
}

function bindCharacterDirectionActions(node) {
  ui.inspector.querySelectorAll("[data-refresh-direction]").forEach(button => button.addEventListener("click", () => loadCharacterDirection(node, true)));
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

const incidentLifecycle = ["detected", "owned", "repairing", "awaiting activation", "recovered", "blocked", "human-review"];
const incidentLifecycleMap = {
  discovered: "detected", actionable: "detected", owned: "owned",
  investigating: "repairing", repair_pending: "repairing",
  promoted: "awaiting activation", verifying: "awaiting activation", awaiting_activation: "awaiting activation",
  recovered: "recovered", blocked: "blocked", human_review: "human-review",
};
function lifecycleLabel(value) {
  const key = String(value || "unknown").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return incidentLifecycleMap[key] || (incidentLifecycle.includes(key) ? key : "unknown");
}
function operationalSignal(signal) {
  const statusLifecycle = { attention: "detected", broken: "detected", repairing: "repairing", healthy: "recovered" };
  const lifecycle = lifecycleLabel(signal.lifecycle || signal.incident_status || statusLifecycle[signal.status] || signal.status);
  return {
    lifecycle: signal.evidence_known === false ? "unknown" : lifecycle,
    component: signal.responsible_component || signal.component || signal.owner || "Unknown component",
    nextAction: signal.permitted_next_action || signal.next_action || signal.repair || "Unknown next action",
  };
}

function renderOperationalHealth(snapshot) {
  operationalHealthSnapshot = snapshot;
  ui.operationalHealthCopy.disabled = !snapshot.operational_brief;
  const status = snapshot.status || "unknown";
  const repair = snapshot.repair || {};
  const window = snapshot.window || {};
  ui.operationalHealthOpen.dataset.status = status;
  ui.operationalHealthLabel.textContent = snapshot.headline || title(status);
  ui.operationalHealthObserved.textContent = snapshot.observed_at
    ? `Sampled ${new Date(snapshot.observed_at).toLocaleTimeString()}` : "Observation time unknown";
  ui.operationalHealthOpen.title = ui.operationalHealthObserved.textContent;
  const signals = (snapshot.signals || []).map(signal => ({ ...signal, ...operationalSignal(signal) }));
  const overall = status === "healthy" && signals.some(signal => signal.lifecycle === "unknown") ? "unknown" : status;
  const attentionHeading = signals.length
    ? `${signals.length.toLocaleString()} signal${signals.length === 1 ? "" : "s"} determine this status`
    : "No monitored signal needs attention";
  ui.operationalHealthContent.innerHTML = `
    <div class="operational-overview">
      <section class="operational-card" data-status="${escapeHtml(overall)}"><span>Overall</span><strong>${escapeHtml(overall === "unknown" ? "Unknown evidence" : (snapshot.headline || title(status)))}</strong><p>Ticks ${escapeHtml(healthValue(window.tick_start))}–${escapeHtml(healthValue(window.tick_end))} · state/history ${escapeHtml(pretty(window.state_event_alignment || "unknown"))}</p></section>
      <section class="operational-card" data-status="${escapeHtml(repair.status === "active" ? "repairing" : repair.status === "blocked" ? "broken" : "healthy")}"><span>Self-healing</span><strong>${escapeHtml(title(repair.status || "unknown"))}</strong><p>${escapeHtml(repair.detail || "Repair state is unavailable.")} Repairs may change reviewed source only through disposable validation and protected delivery; they never rewrite live world state directly.</p></section>
    </div>
    <section class="operational-explanation" data-status="${escapeHtml(overall)}">
      <span>${status === "healthy" ? "Why this is healthy" : "Why this needs attention"}</span>
      <strong>${escapeHtml(attentionHeading)}</strong>
      <p>${status === "attention" ? "Yellow means these bounded findings should be reviewed; it does not by itself mean the world state is corrupt." : "The overall status is determined by the findings listed below."}</p>
    </section>
    <div class="operational-signals">${signals.map((signal, index) => `<article class="operational-signal" data-status="${escapeHtml(signal.lifecycle)}" data-severity="${escapeHtml(signal.status || "unknown")}"><div class="operational-signal-heading"><span>${index + 1}</span><h3>${escapeHtml(signal.title || "Operational signal")}</h3></div><p>${escapeHtml(signal.detail || "Evidence detail is unknown.")}</p><dl><div><dt>State</dt><dd>${escapeHtml(signal.lifecycle)}</dd></div><div><dt>Responsible component</dt><dd>${escapeHtml(signal.component)}</dd></div><div><dt>Permitted next action</dt><dd>${escapeHtml(signal.nextAction)}</dd></div></dl></article>`).join("") || '<article class="operational-card" data-status="healthy"><strong>No findings</strong><p>No monitored operational signal currently needs attention.</p></article>'}</div>`;
}

async function refreshOperationalHealth({ force = false } = {}) {
  if (operationalHealthInFlight || (!force && Date.now() < operationalHealthRetryAfter)) return;
  operationalHealthInFlight = true;
  ui.operationalHealthRefresh.disabled = true;
  ui.operationalHealthOpen.dataset.status = "unknown";
  ui.operationalHealthLabel.textContent = "Checking health…";
  try {
    renderOperationalHealth(await getOperationalHealth());
  } catch (error) {
    operationalHealthSnapshot = null;
    ui.operationalHealthCopy.disabled = true;
    ui.operationalHealthOpen.dataset.status = "unknown";
    ui.operationalHealthLabel.textContent = "Health unknown";
    if (ui.operationalHealth.open) {
      ui.operationalHealthContent.innerHTML = `<div class="lens-error"><strong>Operational health unavailable</strong><p>${escapeHtml(error.message || String(error))}</p></div>`;
    }
  } finally {
    operationalHealthRetryAfter = Date.now() + OPERATIONAL_HEALTH_REFRESH_MS;
    operationalHealthInFlight = false;
    ui.operationalHealthRefresh.disabled = false;
  }
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
  const capacityStatus = current.status || qwen.status || "unavailable";
  const historyIncomplete = ["world_busy", "stale"].includes(history.status);
  const overallStatus = capacityStatus === "healthy" && historyIncomplete ? "partial" : capacityStatus;
  ui.engineRoomOpen.dataset.status = overallStatus;
  ui.engineRoomObserved.textContent = `Sampled ${new Date(snapshot.observed_at).toLocaleTimeString()}`;
  const reason = qwen.reason ? ` · ${pretty(qwen.reason)}` : "";
  const timeline = [...(history.timeline || [])].reverse();
  const reasons = Object.entries(history.decision_reasons || {}).slice(0, 5);
  const lunaRouteValues = [routes["hermes:gpt-6-luna"], routes["hermes:gpt-5.6-luna"]];
  const lunaRouteCount = lunaRouteValues.some(value => value !== null && value !== undefined)
    ? lunaRouteValues.reduce((total, value) => total + Number(value || 0), 0)
    : null;
  const lunaLatencyRoute = history.latency_seconds_by_route?.["hermes:gpt-6-luna"]
    ? "hermes:gpt-6-luna"
    : "hermes:gpt-5.6-luna";
  const historyKnown = history.status !== "world_busy";
  const historyStale = history.status === "stale";
  const telemetryKnown = ["measured", "partial"].includes(qwen.telemetry?.status);
  const evidenceMessages = [];
  if (!telemetryKnown) evidenceMessages.push("Live Qwen health and metrics are unavailable; current load is unknown.");
  if (qwen.telemetry?.status === "partial") evidenceMessages.push("Qwen health, slots and host memory are measured; queue depth and KV occupancy are unavailable on this backend.");
  if (current.state_evidence !== "measured") evidenceMessages.push("Capacity-state evidence is unavailable; lease and Luna budget values are unknown.");
  if (!historyKnown) evidenceMessages.push("A world turn is active. Recent route history was left unknown so this view could return immediately.");
  if (historyStale) evidenceMessages.push(`A world turn is active. Route history is the last lock-proven sample from ${new Date(history.measured_at).toLocaleTimeString()}.`);
  ui.engineRoomContent.innerHTML = `
    <div class="engine-room-status"><span class="health-dot" data-status="${escapeHtml(overallStatus)}" aria-hidden="true"></span><strong>${escapeHtml(overallStatus)}</strong><span>Capacity ${escapeHtml(capacityStatus)} · history ${escapeHtml(pretty(history.status || "unknown"))} · Laya ${escapeHtml(laya.status || "unknown")} · Qwen router ${escapeHtml(qwen.router_mode || "unknown")}${escapeHtml(reason)} · gate ${escapeHtml(current.gate || "unknown")}</span></div>
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
        <div><dt>Running requests</dt><dd>${escapeHtml(healthValue(qwen.running))} / ${escapeHtml(healthValue(limits.qwen_observed_concurrency ?? limits.qwen_running_pressure))}</dd></div>
        <div><dt>Waiting requests</dt><dd>${escapeHtml(healthValue(qwen.waiting))}</dd></div>
        <div><dt>KV cache</dt><dd>${escapeHtml(healthRatio(qwen.kv_cache_ratio))} · ${escapeHtml(qwen.telemetry?.kv_cache || "unknown")}</dd></div>
        <div><dt>Memory available</dt><dd>${escapeHtml(healthBytes(qwen.memory_available_bytes))} · ${escapeHtml(qwen.telemetry?.memory || "unknown")}</dd></div>
        <div><dt>Router leases</dt><dd>${escapeHtml(healthValue(qwen.router_leases?.active))} / ${escapeHtml(healthValue(limits.qwen_router_leases))}</dd></div>
        <div><dt>Recent latency</dt><dd>${escapeHtml(latencyLabel(history, "local:qwen"))}</dd></div>
      </dl></section>
      <span class="route-arrow" aria-hidden="true">→</span>
      <section class="route-card" data-route="luna"><div class="route-card-heading"><h3>Luna overflow</h3><span>Capacity relief</span></div><dl>
        <div><dt>Recent routed turns</dt><dd>${escapeHtml(healthValue(lunaRouteCount))}</dd></div>
        <div><dt>In flight</dt><dd>${escapeHtml(healthValue(luna.in_flight))} / ${escapeHtml(healthValue(limits.luna_in_flight))}</dd></div>
        <div><dt>Tokens available</dt><dd>${escapeHtml(healthValue(luna.tokens_available))} / ${escapeHtml(healthValue(limits.luna_bucket_capacity))}</dd></div>
        <div><dt>Token refill</dt><dd>${escapeHtml(healthValue(limits.luna_refill_per_minute))} / minute</dd></div>
        <div><dt>Recent latency</dt><dd>${escapeHtml(latencyLabel(history, lunaLatencyRoute))}</dd></div>
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
          ${engineMetric("Luna routes", healthValue(lunaRouteCount))}
          ${engineMetric("Pressure ticks", healthValue(history.pressure_ticks))}
          ${engineMetric("Capacity evidence", current.state_evidence || "unknown")}
          ${engineMetric("Route history", history.status || "unknown")}
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
    if (snapshot.history?.refresh_pending && ui.engineRoom.open) {
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
  // Keep every marker and label screen-sized even when the frontier is much
  // larger than the opening village-and-Necropolis view.
  ui.graphNodes.querySelectorAll(".graph-node").forEach(node => {
    for (const child of node.children) child.setAttribute("transform", `scale(${unit})`);
  });
  ui.graphNodes.querySelectorAll('.graph-node[data-type="place"]').forEach(node => {
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
  const graph = world?.graph || {};
  const points = selectGraphViewNodes(graph, types, fit)
    .map(node => graphPositions.get(node.id)).filter(Boolean);
  if (!points.length) return;
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const spanX = Math.max(700, Math.max(...points.map(point => point.x)) - left);
  const spanY = Math.max(450, Math.max(...points.map(point => point.y)) - top);
  // Leave room for screen-sized labels at the outermost places.
  graphViewBox = { x: left - spanX * .12, y: top - spanY * .12,
    width: spanX * 1.24, height: spanY * 1.24 };
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

function storySeenSequence() {
  try { return Number(window.localStorage.getItem(STORY_SEEN_KEY)) || 0; }
  catch (_error) { return 0; }
}

function rememberStorySequence(sequence) {
  try { window.localStorage.setItem(STORY_SEEN_KEY, String(sequence || 0)); }
  catch (_error) { /* Browser storage is optional presentation state. */ }
}

function storyPersonName(identity) {
  return world?.inhabitants.find(person => person.id === identity)?.name || title(identity);
}

function readableEventSummary(event) {
  if (event?.type !== "SPEAK") return event?.summary || "";
  const payload = event.payload || event.detail || {};
  const target = payload.target ? ` to ${storyPersonName(payload.target)}` : "";
  return `${storyPersonName(event.actor)} said${target}: “${payload.text || ""}”`;
}

function renderStory() {
  if (!storySnapshot) return;
  const importance = ui.storyImportance.value, category = ui.storyCategory.value, person = ui.storyPerson.value;
  const events = [...(storySnapshot.events || [])].reverse().filter(event =>
    (importance === "all" || event.importance === importance)
    && (category === "all" || event.category === category)
    && (person === "all" || (event.participants || []).includes(person))
  );
  ui.storyFeed.innerHTML = events.map(event => `
    <li class="story-entry" data-category="${escapeHtml(event.category)}" data-importance="${escapeHtml(event.importance)}">
      <div class="story-entry-heading"><span>Tick ${Number(event.tick).toLocaleString()}</span><span>${escapeHtml(title(event.category))}</span></div>
      <p>${escapeHtml(readableEventSummary(event))}</p>
      <div class="story-entry-meta">${escapeHtml((event.participants || []).map(storyPersonName).join(" · ") || storyPersonName(event.actor))} · ${escapeHtml(title(event.type))}</div>
      <details data-disclosure="event:${escapeHtml(event.event_id)}" ${disclosureOpen("world-story", 'event:' + event.event_id) ? "open" : ""}><summary>Authoritative evidence</summary><pre>${escapeHtml(JSON.stringify({ event_id:event.event_id, sequence:event.sequence, payload:event.detail }, null, 2))}</pre></details>
    </li>`).join("") || `<li class="empty">No milestones match these filters.</li>`;
  bindDisclosures(ui.storyFeed, "world-story");
  const previous = storyPreviousSeen;
  const unseen = previous ? (storySnapshot.events || []).filter(event => event.sequence > previous).length : null;
  const oldestLoaded = storySnapshot.events?.[0]?.sequence;
  const clippedSince = unseen !== null && storySnapshot.truncated && oldestLoaded > previous;
  const newText = unseen === null ? " · first visit on this browser" : ` · ${clippedSince ? "at least " : ""}${unseen.toLocaleString()} new since the last visit`;
  ui.storyStatus.textContent = `${events.length.toLocaleString()} shown · ${Number(storySnapshot.total_events || 0).toLocaleString()} milestones recorded${newText}${storySnapshot.truncated ? ` · newest ${storySnapshot.limit} loaded` : ""}`;
}

async function refreshStory() {
  const generation = ++storyRequestGeneration;
  const worldId = world.world_id, publication = liveSnapshotBase;
  const current = () => generation === storyRequestGeneration
    && worldId === world.world_id && publication === liveSnapshotBase;
  const previousSeen = storySeenSequence();
  ui.storyRefresh.disabled = true;
  ui.storyStatus.textContent = "Reading the world story…";
  try {
    const snapshot = await getWorldStory();
    if (!current()) return;
    storyPreviousSeen = previousSeen;
    storySnapshot = snapshot;
    const selected = ui.storyPerson.value;
    const names = new Map(world.inhabitants.map(person => [person.id, person.name]));
    const participants = [...new Set((storySnapshot.events || []).flatMap(event => event.participants || []))]
      .sort((a, b) => String(names.get(a) || title(a)).localeCompare(String(names.get(b) || title(b))));
    ui.storyPerson.innerHTML = `<option value="all">Everyone</option>${participants.map(identity => `<option value="${escapeHtml(identity)}">${escapeHtml(names.get(identity) || title(identity))}</option>`).join("")}`;
    if ([...ui.storyPerson.options].some(option => option.value === selected)) ui.storyPerson.value = selected;
    renderStory();
    rememberStorySequence(storySnapshot.through_sequence);
    clearError();
  } catch (error) {
    if (!current()) return;
    ui.storyStatus.textContent = "The world story is unavailable. Try refreshing.";
    ui.storyFeed.innerHTML = `<li class="lens-error"><strong>Story unavailable</strong><p>${escapeHtml(error.message || String(error))}</p></li>`;
  } finally {
    if (generation === storyRequestGeneration) {
      ui.storyRefresh.disabled = false;
      if (!current()) ui.storyStatus.textContent = "The world publication changed. Refresh to read its story.";
    }
  }
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

function requestNumber(identity) { return Number(String(identity || "").replace(/\D/g, "")) || 0; }

function newestRequestFirst(left, right) {
  const heartbeat = Number(right.latest_run?.heartbeat || -1) - Number(left.latest_run?.heartbeat || -1);
  return heartbeat || requestNumber(right.id) - requestNumber(left.id);
}

function logosRequestCard(request) {
  const run = request.latest_run;
  const url = candidateUrl(run?.pull_request);
  return `<article class="request-card" data-status="${escapeHtml(request.status)}">
    <div class="request-card-heading"><span>${escapeHtml(request.id)} · ${escapeHtml(pretty(request.type))}</span>${activityBadge(request.status)}</div>
    <h4>${escapeHtml(request.title)}</h4>
    <div class="request-card-meta">${escapeHtml(title(request.priority))} priority · ${escapeHtml(title(request.lane))}${request.depends_on && request.depends_on !== "none" ? ` · depends on ${escapeHtml(request.depends_on)}` : ""}</div>
    ${run ? `<div class="request-run"><strong>Latest evidenced heartbeat ${Number(run.heartbeat).toLocaleString()}</strong><span>${escapeHtml(activityTime(run.completed_at))} · ${escapeHtml(title(run.status))} · delivery ${escapeHtml(pretty(run.delivery_status || "not recorded"))}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open PR</a>` : ""}</div>` : `<div class="request-run"><span>No matching heartbeat in the bounded evidence window.</span></div>`}
  </article>`;
}

function renderLogosActivity(snapshot) {
  const runs = snapshot.runs || [];
  const publicStatic = snapshot.visibility === "public-static";
  const requests = [...(snapshot.requests || [])].sort(newestRequestFirst);
  const sections = [
    ["In progress", requests.filter(request => ["accepted", "in_progress"].includes(request.status))],
    ["Queued next", requests.filter(request => request.status === "queued")],
    ["Blocked", requests.filter(request => request.status === "blocked")],
    ["Recently completed", requests.filter(request => request.status === "completed").slice(0, 12)],
  ];
  const counts = snapshot.request_counts || {};
  ui.logosContent.innerHTML = `
    <div class="activity-summary logos-summary">
      <div><span>Latest heartbeat</span><strong>${escapeHtml(snapshot.latest_heartbeat ?? "—")}</strong></div>
      <div><span>In progress</span><strong>${Number((counts.accepted || 0) + (counts.in_progress || 0)).toLocaleString()}</strong></div>
      <div><span>Queued</span><strong>${Number(counts.queued || 0).toLocaleString()}</strong></div>
      <div><span>Blocked</span><strong>${Number(counts.blocked || 0).toLocaleString()}</strong></div>
      <p>Request status is reviewed source intent. A recent heartbeat below is separate execution evidence; neither alone proves merge or activation.</p>
    </div>
    <div class="request-board">${sections.map(([heading, items]) => `<section class="request-column"><h3>${escapeHtml(heading)} <span>${items.length.toLocaleString()}</span></h3><div>${items.map(logosRequestCard).join("") || activityEmpty(`No ${heading.toLowerCase()} requests.`)}</div></section>`).join("")}</div>
    <section class="activity-section"><h3>Recent heartbeat evidence</h3><div class="activity-list">${runs.map(run => {
      const request = run.request_title || run.request || "No request selected";
      const model = run.model_invoked ? `${run.model || "model"}${run.reasoning ? ` · ${run.reasoning}` : ""}` : "No model call";
      return `<article class="activity-card" data-status="${escapeHtml(run.status)}">
        <div class="activity-card-heading"><div><span class="activity-id">HEARTBEAT ${Number(run.heartbeat).toLocaleString()}</span><h3>${escapeHtml(request)}</h3></div>${activityBadge(run.status)}</div>
        <dl class="activity-facts">
          <div><dt>Decision</dt><dd>${escapeHtml(pretty(run.decision || "unknown"))}</dd></div>
          <div><dt>Lane</dt><dd>${escapeHtml(pretty(run.lane || "none"))}</dd></div>
          ${publicStatic ? "" : `<div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div>`}
          <div><dt>Delivery</dt><dd>${escapeHtml(pretty(run.delivery_status || "not recorded"))}</dd></div>
          <div><dt>Started</dt><dd>${escapeHtml(activityTime(run.started_at))}</dd></div>
          <div><dt>Completed</dt><dd>${escapeHtml(activityTime(run.completed_at))}</dd></div>
        </dl>
        ${publicStatic ? "" : `${run.influence_summary ? `<p class="activity-narrative"><strong>Sol influence</strong>${escapeHtml(run.influence_summary)}</p>` : ""}${run.failure ? `<p class="activity-narrative"><strong>Failure</strong>${escapeHtml(run.failure)}</p>` : ""}<div class="activity-meta">${run.source_finding_id ? `Finding ${escapeHtml(run.source_finding_id)} · ` : ""}${run.branch ? escapeHtml(run.branch) : "No candidate branch recorded"}${candidateUrl(run.pull_request) ? ` · <a href="${escapeHtml(candidateUrl(run.pull_request))}" target="_blank" rel="noreferrer">Open PR</a>` : ""}</div>`}
      </article>`;
    }).join("") || activityEmpty("No Logos heartbeat evidence is available yet.")}</div></section>`;
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
  const current = active.filter(item => item.status !== "blocked");
  const blocked = active.filter(item => item.status === "blocked");
  ui.logosLabContent.innerHTML = `
    <div class="activity-summary lab-summary">
      <div><span>Current research</span><strong>${current.length.toLocaleString()}</strong></div>
      <div><span>Blocked</span><strong>${blocked.length.toLocaleString()}</strong></div>
      <div><span>Completed / falsified</span><strong>${terminal.length.toLocaleString()}</strong></div>
      <div><span>Review candidates</span><strong>${candidates.length.toLocaleString()}</strong></div>
      <p>${escapeHtml(snapshot.note || "")}</p>
    </div>
    <section class="activity-section"><h3>Recent coordinator runs</h3><div class="run-table">${runs.map(run => `<div class="run-row"><span>${activityBadge(run.status)}<strong>${escapeHtml(run.run_id)}</strong></span><span>${escapeHtml(run.summary || run.failure || run.outcome || "No summary recorded")}</span><time>${escapeHtml(activityTime(run.completed_at || run.started_at))}</time></div>`).join("") || activityEmpty("No coordinator run is recorded.")}</div></section>
    <section class="activity-section"><h3>Current investigations</h3><div class="activity-list">${researchCards(current, "No investigation is currently actionable.")}</div></section>
    <section class="activity-section"><h3>Blocked investigations</h3><div class="activity-list">${researchCards(blocked, "No investigation is currently blocked.")}</div></section>
    <section class="activity-section"><h3>Research outcomes</h3><div class="activity-list">${researchCards(terminal, "No durable research outcome has been recorded yet.")}</div></section>
    <section class="activity-section"><h3>Review-only candidates</h3><div class="candidate-list">${candidates.map(candidate => {
      const url = candidateUrl(candidate.url);
      return `<article class="candidate-card"><div><span>REVIEW ONLY</span><strong>${escapeHtml(candidate.branch)}</strong></div>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open PR</a>` : ""}<p>${escapeHtml(candidate.commit.slice(0, 12))} · auto-merge ${candidate.auto_merge === false ? "off" : "unknown"}</p><small>${escapeHtml((candidate.changed_paths || []).join(" · ") || "Changed paths unavailable")}</small></article>`;
    }).join("") || activityEmpty("No review-only candidate has been published.")}</div></section>
    `;
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
  const storyActive = view === "story", chronicleActive = view === "chronicle";
  const characterReplayActive = view === "character-replay";
  ui.characterReplayView.hidden = !characterReplayActive;
  characterReplayer.setActive(characterReplayActive);
  if (characterReplayActive) stopReplay();
  ui.storyView.hidden = !storyActive; ui.graphView.hidden = !graphActive; ui.chronicleView.hidden = !chronicleActive;
  ui.logosView.hidden = !logosActive; ui.logosLabView.hidden = !labActive;
  [[ui.storyTab, storyActive], [ui.chronicleTab, chronicleActive], [ui.graphTab, graphActive], [ui.characterReplayTab, characterReplayActive], [ui.logosTab, logosActive], [ui.logosLabTab, labActive]].forEach(([tab, active]) => {
    tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("tabindex", active ? "0" : "-1");
  });
  if (graphActive) {
    renderGraph();
    applyGraphViewBox();
    if (graphInspectorMode === "health") renderSchemaHealth();
    else if (selectedGraphNode) selectGraphNode(selectedGraphNode);
    else renderSelectedGraphInspector();
  } else if (logosActive) {
    ui.inspector.innerHTML = '<p class="muted">Logos is the authoritative source-engineering heartbeat. This tab shows bounded scheduler evidence, not raw model output.</p>';
    if (!logosSnapshot) refreshAutomationActivity("logos");
  } else if (labActive) {
    ui.inspector.innerHTML = '<p class="muted">Logos Lab is independent, review-only research. Its findings and candidates do not become authoritative until separately reviewed and delivered.</p>';
    if (!logosLabSnapshot) refreshAutomationActivity("lab");
  } else if (storyActive) {
    ui.inspector.innerHTML = '<p class="muted">World story contains deterministic public milestones. Routine lifecycle records and private intent are omitted; expand an entry to inspect its authoritative evidence.</p>';
    if (!storySnapshot) refreshStory();
  } else if (selectedInspector) renderInspector(selectedInspector.kind, selectedInspector.id);
}

async function loadEvents(first, last) {
  const generation = ++eventRequestGeneration;
  const worldId = world.world_id;
  stopReplay();
  first = Math.max(0, Math.min(world.tick, Number(first) || 0));
  last = Math.max(first, Math.min(world.tick, Number(last) || first));
  ui.from.value = String(first); ui.to.value = String(last); ui.slider.value = String(first);
  ui.selected.textContent = first === last ? `Tick ${first.toLocaleString()}` : `Ticks ${first.toLocaleString()}–${last.toLocaleString()}`;
  ui.status.textContent = "Reading the world record…";
  eventSnapshot = null;
  ui.feed.innerHTML = '<li class="empty">Loading the selected tick range…</li>';
  ui.replay.disabled = true;
  try {
    const snapshot = await getEvents(first, last);
    if (generation !== eventRequestGeneration || worldId !== world.world_id) return;
    eventSnapshot = snapshot;
    renderEventSnapshot();
    clearError();
  } catch (error) {
    if (generation !== eventRequestGeneration || worldId !== world.world_id) return;
    ui.status.textContent = "The selected tick range is unavailable.";
    ui.feed.innerHTML = '<li class="empty">Could not load this tick range. Try again.</li>';
    throw error;
  }
}

function eventGroup(event) {
  if (["TICK_STARTED", "WORK_OPPORTUNITY_ADVERTISED", "WAKE_REQUESTED", "WAKE_SUPPRESSED", "ACTION_REJECTED"].includes(event.type)) return "technical";
  if (event.actor === "world" || event.type.startsWith("SITUATION_") || event.type.startsWith("WORLD_")) return "world";
  return "characters";
}

function renderEventSnapshot() {
  stopReplay();
  if (!eventSnapshot) return;
  const selected = ui.eventFilter.value;
  const events = eventSnapshot.events.filter(event => selected === "all" || eventGroup(event) === selected);
  ui.replay.disabled = events.length === 0;
  ui.feed.innerHTML = events.map(event => `
    <li class="event" data-sequence="${event.sequence}">
      <div class="event-tick">TICK ${event.tick.toLocaleString()}</div>
      <div><p class="event-summary">${escapeHtml(readableEventSummary(event))}</p><div class="event-meta">${escapeHtml(title(event.type))} · ${escapeHtml(storyPersonName(event.actor))} · #${event.sequence.toLocaleString()}</div>
      <details><summary>Event evidence</summary><pre>${escapeHtml(JSON.stringify({ event_id: event.event_id, payload: event.payload }, null, 2))}</pre></details></div>
    </li>`).join("");
  if (!events.length) ui.feed.innerHTML = `<li class="empty">No public world events match this tick range and filter.</li>`;
  ui.status.textContent = `${events.length.toLocaleString()} of ${eventSnapshot.events.length.toLocaleString()} event${eventSnapshot.events.length === 1 ? "" : "s"} shown${eventSnapshot.truncated ? " · first 500 loaded" : ""}`;
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
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    events[position].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
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
    const candidate = await getWorld();
    world = candidate;
    renderWorldFreshness();
    if (ui.engineRoom.open) {
      worldRenderDeferred = true;
      return;
    }
    if (renderedWorldIdentity !== worldIdentity(world)) renderWorld();
    clearError();
    if (initial) {
      Promise.all([loadEvents(world.tick, world.tick), refreshStory()]).catch(showError);
    } else if (ui.follow.checked && previousHead !== world.event_head.event_id) {
      Promise.all([loadEvents(world.tick, world.tick), refreshStory()]).catch(showError);
    }
  } finally {
    worldRefreshInFlight = false;
    // Recordings can arrive while the last lock-proven world snapshot is
    // unchanged. Refresh their independent read-only index on this cadence too.
    characterReplayer.refresh();
    // Health can change while the world tick stays still or its read fails.
    // Reuse this cadence, with a separate bounded interval and in-flight guard.
    if (!document.hidden && viewerConfig.mode !== "static" && world?.operational_health_available) refreshOperationalHealth();
  }
}

const characterReplayer = CharacterReplay.mount(ui.characterReplayView, getJson);

ui.slider.addEventListener("input", () => {
  ui.from.value = ui.to.value = ui.slider.value;
  ui.selected.textContent = `Tick ${Number(ui.slider.value).toLocaleString()}`;
});
ui.slider.addEventListener("change", () => loadEvents(ui.slider.value, ui.slider.value).catch(showError));
ui.show.addEventListener("click", () => loadEvents(ui.from.value, ui.to.value).catch(showError));
ui.latest.addEventListener("click", () => loadEvents(world.tick, world.tick).catch(showError));
ui.replay.addEventListener("click", replay);
ui.follow.addEventListener("change", () => { if (ui.follow.checked) loadEvents(world.tick, world.tick).catch(showError); });
ui.storyTab.addEventListener("click", () => setView("story"));
ui.chronicleTab.addEventListener("click", () => setView("chronicle"));
ui.graphTab.addEventListener("click", () => setView("graph"));
ui.characterReplayTab.addEventListener("click", () => setView("character-replay"));
ui.logosTab.addEventListener("click", () => setView("logos"));
ui.logosLabTab.addEventListener("click", () => setView("lab"));
const surfaceTabs = [ui.storyTab, ui.chronicleTab, ui.graphTab, ui.characterReplayTab, ui.logosTab, ui.logosLabTab];
document.querySelector(".surface-tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const available = surfaceTabs.filter(tab => !tab.hidden);
  const index = Math.max(0, available.indexOf(document.activeElement));
  const target = event.key === "Home" ? available[0]
    : event.key === "End" ? available[available.length - 1]
    : available[(index + (event.key === "ArrowLeft" ? -1 : 1) + available.length) % available.length];
  event.preventDefault();
  target.focus(); target.click();
});
ui.logosRefresh.addEventListener("click", () => refreshAutomationActivity("logos"));
ui.logosLabRefresh.addEventListener("click", () => refreshAutomationActivity("lab"));
ui.storyRefresh.addEventListener("click", () => refreshStory().catch(showError));
ui.storyImportance.addEventListener("change", renderStory);
ui.storyCategory.addEventListener("change", () => {
  if (["movement", "work"].includes(ui.storyCategory.value)) ui.storyImportance.value = "all";
  renderStory();
});
ui.storyPerson.addEventListener("change", renderStory);
ui.eventFilter.addEventListener("change", renderEventSnapshot);
ui.graphReset.addEventListener("click", () => resetGraphView());
ui.graphFit.addEventListener("click", () => resetGraphView({ fit: true }));
new ResizeObserver(() => applyGraphViewBox()).observe(ui.graphStage);
ui.graphHealth.addEventListener("click", () => { graphInspectorMode = "health"; renderSchemaHealth(); });
if (viewerConfig.mode === "static") {
  ui.operationalHealthOpen.hidden = true;
  ui.engineRoomOpen.hidden = true;
}
ui.operationalHealthOpen.addEventListener("click", () => {
  ui.operationalHealth.showModal();
  refreshOperationalHealth({ force: true });
});
ui.operationalHealthClose.addEventListener("click", () => ui.operationalHealth.close());
ui.operationalHealthCopy.addEventListener("click", () => {
  if (operationalHealthSnapshot?.operational_brief) copyInspectorText(operationalHealthSnapshot.operational_brief, ui.operationalHealthCopy, "Copied");
});
ui.operationalHealthRefresh.addEventListener("click", () => refreshOperationalHealth({ force: true }));
ui.operationalHealth.addEventListener("click", event => { if (event.target === ui.operationalHealth) ui.operationalHealth.close(); });
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
    if (ui.follow.checked) Promise.all([loadEvents(world.tick, world.tick), refreshStory()]).catch(showError);
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
function scheduleWorldRefresh(delay = 3000) {
  if (worldRefreshTimer !== null) window.clearTimeout(worldRefreshTimer);
  worldRefreshTimer = null;
  if (document.hidden) return;
  worldRefreshTimer = window.setTimeout(async () => {
    try { await refreshWorld(false); }
    catch (error) { showWorldError(error); }
    finally { scheduleWorldRefresh(); }
  }, delay);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (worldRefreshTimer !== null) window.clearTimeout(worldRefreshTimer);
    worldRefreshTimer = null;
  } else {
    scheduleWorldRefresh(0);
  }
});

refreshWorld(true).then(
  () => scheduleWorldRefresh(),
  error => { showWorldError(error); scheduleWorldRefresh(500); },
);
