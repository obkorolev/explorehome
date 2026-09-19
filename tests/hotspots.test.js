import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markerOffset, projectMarker, radians, validateTour, wrap } from '../src/geometry.js';

const tour = JSON.parse(readFileSync(new URL('../public/tour.json', import.meta.url)));
const source = tour.nodes.P1;

// Independently reproduce the shader's screen-ray calculation and texture lookup.
function sampledPanoramaPoint(point, view, offset) {
  const y = radians(view.yaw), p = radians(view.pitch);
  const sx = (point.x * 2 - view.width) / view.height * Math.tan(radians(view.fov) / 2);
  const sy = (view.height - point.y * 2) / view.height * Math.tan(radians(view.fov) / 2);
  const ray = [Math.cos(p) * Math.cos(y) - sx * Math.sin(y) - sy * Math.sin(p) * Math.cos(y),
    Math.cos(p) * Math.sin(y) + sx * Math.cos(y) - sy * Math.sin(p) * Math.sin(y),
    Math.sin(p) + sy * Math.cos(p)];
  return { yaw: wrap(Math.atan2(ray[1], ray[0]) * 180 / Math.PI - offset),
    pitch: Math.asin(ray[2] / Math.hypot(...ray)) * 180 / Math.PI };
}

test('P2 and P3 remain on their panorama pixels through rotation, zoom, resize and alignment', () => {
  for (const edge of source.neighbors) for (const alignment of [50, 80]) {
    for (const [turn, pitch, fov, width, height] of [[0, -20, 75, 1280, 720], [15, -40, 45, 1280, 720], [-12, -30, 90, 390, 844]]) {
      const view = { yaw: edge.hotspot.yaw + alignment + turn, pitch, fov, width, height };
      const offset = markerOffset(edge, source, tour.nodes[edge.target], 1.4, alignment);
      const point = projectMarker(offset, view.yaw, pitch, fov, width, height);
      assert.ok(point, 'anchor is visible in this test view');
      const sampled = sampledPanoramaPoint(point, view, alignment);
      assert.ok(Math.abs(wrap(sampled.yaw - edge.hotspot.yaw)) < 1e-9);
      assert.ok(Math.abs(sampled.pitch - edge.hotspot.pitch) < 1e-9);
    }
  }
});

test('floor anchors leave the viewport instead of clamping to its bottom or sides', () => {
  const edge = source.neighbors[0];
  const yaw = edge.hotspot.yaw + source.yawOffset;
  const offset = markerOffset(edge, source, tour.nodes[edge.target], 1.4, source.yawOffset);
  assert.equal(projectMarker(offset, yaw, 40, 75, 1280, 720), null);
  assert.equal(projectMarker(offset, yaw + 180, -20, 75, 1280, 720), null);
  assert.equal(projectMarker(offset, yaw + 80, -20, 40, 390, 844), null);
  const nearBottom = projectMarker(offset, yaw, 0, 75, 1280, 720);
  assert.ok(nearBottom.y > 720 - 155 && nearBottom.y < 720, 'visible floor point is not shifted to the old bottom limit');
});

test('uncalibrated markers target the destination rather than a schematic route bend', () => {
  assert.deepEqual(markerOffset({ path: [[99, 99]] }, { position: [0, 0, 0] }, { position: [2, 3, 0] }, 1.4), [2, 3, -1.4]);
});

test('invalid hotspot data is rejected', () => {
  for (const hotspot of [{ yaw: NaN, pitch: -30 }, { yaw: 0, pitch: -100 }, { yaw: 0 }]) {
    const bad = structuredClone(tour);
    bad.nodes.P1.neighbors[0].hotspot = hotspot;
    assert.throws(() => validateTour(bad), /Invalid hotspot/);
  }
});
