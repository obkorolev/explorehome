import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { shortestRoute, validateTour } from '../src/geometry.js';

const tour = validateTour(JSON.parse(readFileSync(new URL('../public/tour.json', import.meta.url))));

test('all seven captures are reachable in both directions and have local assets', () => {
  assert.deepEqual(Object.keys(tour.nodes), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  for (const [id, node] of Object.entries(tour.nodes)) {
    assert.ok(existsSync(new URL(`../public/${node.image}`, import.meta.url)));
    for (const destination of Object.keys(tour.nodes)) assert.ok(shortestRoute(tour.nodes, id, destination));
    for (const edge of node.neighbors) assert.ok(tour.nodes[edge.target].neighbors.some(reverse => reverse.target === id));
  }
});

test('apartment routes use the corridor and bedroom doorway', () => {
  assert.deepEqual(shortestRoute(tour.nodes, 'P2', 'P7'), ['P1', 'P4', 'P6', 'P7']);
  assert.deepEqual(shortestRoute(tour.nodes, 'P5', 'P7'), ['P4', 'P6', 'P7']);
  assert.deepEqual(shortestRoute(tour.nodes, 'P7', 'P3'), ['P6', 'P4', 'P1', 'P3']);
  for (const id of ['P4', 'P5', 'P6', 'P7']) {
    for (const edge of tour.nodes[id].neighbors) assert.ok(edge.hotspot && edge.hotspot.pitch < 0);
  }
});

test('the user-corrected living-room anchors are preserved', () => {
  assert.deepEqual(tour.nodes.P1.neighbors.find(e => e.target === 'P2').hotspot, { yaw: -167.07, pitch: -31.98 });
  assert.deepEqual(tour.nodes.P1.neighbors.find(e => e.target === 'P3').hotspot, { yaw: -96.88, pitch: -34.13 });
});
