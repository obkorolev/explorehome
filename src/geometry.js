export const radians = (degrees) => degrees * Math.PI / 180;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const wrap = (degrees) => ((degrees + 180) % 360 + 360) % 360 - 180;

// World coordinates: X/Y horizontal, Z up; yaw 0 = +X, yaw 90 = +Y.
export function projectOffset([dx, dy, dz], yaw, pitch, fov, width, height) {
  const y = radians(yaw), p = radians(pitch);
  const forward = Math.cos(p) * (dx * Math.cos(y) + dy * Math.sin(y)) + dz * Math.sin(p);
  if (forward <= 0.001) return null;
  const right = -dx * Math.sin(y) + dy * Math.cos(y);
  const up = -Math.sin(p) * (dx * Math.cos(y) + dy * Math.sin(y)) + dz * Math.cos(p);
  const scale = height / (2 * Math.tan(radians(fov) / 2));
  return { x: width / 2 + right / forward * scale, y: height / 2 - up / forward * scale, depth: forward };
}

// A hotspot is a fixed direction in its source panorama, before yaw alignment.
// Schematic map bends do not determine where a photographed floor spot appears.
export function markerOffset(edge, source, target, cameraHeight, yawOffset = 0) {
  if (edge.hotspot) {
    const yaw = radians(edge.hotspot.yaw + yawOffset), pitch = radians(edge.hotspot.pitch);
    return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  }
  return [target.position[0] - source.position[0], target.position[1] - source.position[1], target.position[2] - source.position[2] - cameraHeight];
}

export function projectMarker(offset, yaw, pitch, fov, width, height) {
  const point = projectOffset(offset, yaw, pitch, fov, width, height);
  // Off-screen anchors disappear instead of sliding along a viewport edge.
  return point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height ? point : null;
}

export function shortestRoute(nodes, from, to) {
  if (!nodes[from] || !nodes[to]) return null;
  const queue = [from], parents = new Map([[from, null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor];
    if (source === to) {
      const result = [];
      for (let step = to; step !== from; step = parents.get(step)) result.unshift(step);
      return result;
    }
    for (const { target } of nodes[source].neighbors) {
      if (!parents.has(target)) { parents.set(target, source); queue.push(target); }
    }
  }
  return null;
}

export function validateTour(tour) {
  if (tour?.version !== 1 || !tour.nodes || !tour.nodes[tour.startNode]) throw new Error('Invalid tour.json: missing version, nodes or start node.');
  for (const [id, node] of Object.entries(tour.nodes)) {
    if (!Array.isArray(node.position) || node.position.length !== 3 || !node.position.every(Number.isFinite)) throw new Error(`Invalid position for ${id}.`);
    if (typeof node.image !== 'string' || !node.image || !Array.isArray(node.neighbors)) throw new Error(`Invalid image or neighbors for ${id}.`);
    for (const edge of node.neighbors) {
      if (!tour.nodes[edge.target] || edge.target === id || !Number.isFinite(edge.yaw) || !Number.isFinite(edge.distance) || edge.distance <= 0) throw new Error(`Invalid edge at ${id}.`);
      if (edge.hotspot != null && (!Number.isFinite(edge.hotspot.yaw) || !Number.isFinite(edge.hotspot.pitch) || Math.abs(edge.hotspot.pitch) > 90)) throw new Error(`Invalid hotspot at ${id}.`);
    }
  }
  return tour;
}
