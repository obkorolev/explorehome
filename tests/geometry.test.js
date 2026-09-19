import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOffset, shortestRoute, validateTour, wrap } from '../src/geometry.js';

test('world heading projects in the same convention as the panorama shader', () => {
  for (const [offset, yaw] of [[[1, 0, 0], 0], [[0, 1, 0], 90], [[-1, 0, 0], 180], [[0, -1, 0], -90]]) {
    const projected = projectOffset(offset, yaw, 0, 80, 1000, 600);
    assert.ok(Math.abs(projected.x - 500) < 1e-9);
    assert.ok(Math.abs(projected.y - 300) < 1e-9);
  }
  assert.equal(projectOffset([-1, 0, 0], 0, 0, 80, 1000, 600), null);
  assert.ok(projectOffset([1, 0, -1], 0, 0, 80, 1000, 600).y > 300);
  assert.equal(wrap(359), -1);
});

test('minimap route follows edges and rejects unreachable nodes', () => {
  const nodes = { a: { neighbors: [{ target: 'b' }] }, b: { neighbors: [{ target: 'a' }, { target: 'c' }] }, c: { neighbors: [{ target: 'b' }] }, d: { neighbors: [] } };
  assert.deepEqual(shortestRoute(nodes, 'a', 'c'), ['b', 'c']);
  assert.deepEqual(shortestRoute(nodes, 'a', 'a'), []);
  assert.equal(shortestRoute(nodes, 'a', 'd'), null);
  assert.equal(shortestRoute(nodes, 'a', 'missing'), null);
});

test('bad metadata fails before rendering', () => {
  assert.throws(() => validateTour({ version: 1, nodes: {}, startNode: 'a' }));
  assert.throws(() => validateTour({ version: 1, startNode: 'a', nodes: { a: { position: [NaN, 0, 0], image: 'x', neighbors: [] } } }));
});
