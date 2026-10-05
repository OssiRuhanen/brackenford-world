"use strict";

// A schematic route map: only projected movement edges connect places.
// Coordinates are presentation state, never distances or movement authority.
function layoutWorldGraph(graph, previous = new Map()) {
  const positions = new Map();
  const places = graph.nodes.filter(node => node.type === "place").sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(places.map(node => [node.id, node]));
  const neighbors = new Map(places.map(node => [node.id, new Set()]));
  for (const edge of graph.edges) {
    if (edge.relation !== "route" || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    neighbors.get(edge.source).add(edge.target);
    neighbors.get(edge.target).add(edge.source);
  }
  for (const node of places) {
    if (previous.has(node.id)) positions.set(node.id, { ...previous.get(node.id) });
    else if (node.map?.anchor) positions.set(node.id, { x: node.map.anchor[0], y: node.map.anchor[1] });
  }
  const angles = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI };
  function placeNear(node, originId, direction) {
    const origin = positions.get(originId);
    const related = [...neighbors.get(node.id)].filter(id => positions.has(id));
    const baseAngle = angles[direction] ?? 0;
    let best = null;
    // Prefer short routes, with enough room for a place's residents and label.
    // Directional candidates stay within 30 degrees of the recorded bearing.
    for (const radius of [700, 1000, 1400, 1850]) {
      for (let index = 0; index < (direction ? 3 : 12); index += 1) {
        const angle = direction ? baseAngle + [0, -Math.PI / 6, Math.PI / 6][index] : index * Math.PI / 6;
        const point = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
        const clearance = Math.min(...[...positions.values()].map(other => Math.hypot(point.x - other.x, point.y - other.y)));
        const routeLength = related.reduce((sum, id) => sum + Math.hypot(point.x - positions.get(id).x, point.y - positions.get(id).y), 0);
        const score = Math.max(0, 640 - clearance) * 20 + routeLength + radius * .1;
        if (!best || score < best.score) best = { ...point, score };
      }
    }
    positions.set(node.id, { x: best.x, y: best.y });
  }
  const pending = new Set(places.filter(node => !positions.has(node.id)).map(node => node.id));
  while (pending.size) {
    let progressed = false;
    for (const id of pending) {
      const node = byId.get(id);
      const originId = `place:${node.map?.origin}`;
      const directed = Object.hasOwn(angles, node.map?.direction) && neighbors.get(id).has(originId);
      const origin = directed ? (positions.has(originId) ? originId : null)
        : [...neighbors.get(id)].sort().find(neighbor => positions.has(neighbor));
      if (!origin) continue;
      placeNear(node, origin, directed ? node.map.direction : null);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      // Disconnected components and malformed directional cycles remain visible.
      const id = pending.values().next().value;
      const right = Math.max(0, ...[...positions.values()].map(point => point.x));
      positions.set(id, { x: right + 1200, y: 900 });
      pending.delete(id);
    }
  }

  const children = new Map(places.map(node => [node.id, []]));
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.relation === "contains" && children.has(edge.source) && nodesById.has(edge.target)) {
      children.get(edge.source).push(nodesById.get(edge.target));
    }
  }
  for (const [placeId, items] of children) {
    const origin = positions.get(placeId);
    const columns = Math.min(3, Math.max(1, items.length));
    items.sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
      // Screen-sized entity markers need real breathing room around each place.
      const column = index % columns;
      positions.set(node.id, {
        x: origin.x + (column - (columns - 1) / 2) * 340,
        y: origin.y + 220 + Math.floor(index / columns) * 220,
      });
    });
  }
  const bottom = Math.max(0, ...[...positions.values()].map(point => point.y)) + 300;
  graph.nodes.filter(node => !positions.has(node.id)).sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
    positions.set(node.id, { x: 220 + (index % 8) * 300, y: bottom + Math.floor(index / 8) * 140 });
  });
  return positions;
}

function selectGraphViewNodes(graph, visibleTypes, fit = false) {
  const initialPlaces = new Set(graph.initial_place_ids || []);
  if (fit || !initialPlaces.size) return graph.nodes.filter(node => visibleTypes.has(node.type));
  const focusNodes = new Set(initialPlaces);
  for (const edge of graph.edges || []) {
    if (edge.relation === "contains" && initialPlaces.has(edge.source)) focusNodes.add(edge.target);
  }
  return graph.nodes.filter(node => visibleTypes.has(node.type) && focusNodes.has(node.id));
}

if (typeof module !== "undefined") module.exports = { layoutWorldGraph, selectGraphViewNodes };
