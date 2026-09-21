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
    for (const radius of [430, 620, 860, 1150]) {
      for (let index = 0; index < (direction ? 3 : 12); index += 1) {
        const angle = direction ? baseAngle + [0, -Math.PI / 6, Math.PI / 6][index] : index * Math.PI / 6;
        const point = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
        const clearance = Math.min(...[...positions.values()].map(other => Math.hypot(point.x - other.x, point.y - other.y)));
        const routeLength = related.reduce((sum, id) => sum + Math.hypot(point.x - positions.get(id).x, point.y - positions.get(id).y), 0);
        const score = Math.max(0, 380 - clearance) * 20 + routeLength + radius * .1;
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
      positions.set(id, { x: right + 720, y: 700 });
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
    items.sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
      // A compact roster below each place keeps route lines and names legible.
      positions.set(node.id, { x: origin.x + (index % 2) * 135, y: origin.y + 38 + Math.floor(index / 2) * 26 });
    });
  }
  const bottom = Math.max(0, ...[...positions.values()].map(point => point.y)) + 170;
  graph.nodes.filter(node => !positions.has(node.id)).sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
    positions.set(node.id, { x: 160 + (index % 8) * 180, y: bottom + Math.floor(index / 8) * 65 });
  });
  return positions;
}

if (typeof module !== "undefined") module.exports = { layoutWorldGraph };
