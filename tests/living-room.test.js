import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shortestRoute, validateTour, projectOffset } from '../src/geometry.js';

const tour = validateTour(JSON.parse(readFileSync(new URL('../public/tour.json', import.meta.url), 'utf8')));

test('opposite sides of the dining table route through the kitchen-side capture', () => {
  assert.deepEqual(shortestRoute(tour.nodes, 'P2', 'P3'), ['P1', 'P3']);
  assert.deepEqual(shortestRoute(tour.nodes, 'P3', 'P2'), ['P1', 'P2']);
});

test('sketched walking paths avoid the dining table and match route headings', () => {
  const table = tour.floorplan.furniture.find(item => item.label === 'Table');
  for (const node of Object.values(tour.nodes)) {
    for (const edge of node.neighbors) {
      const points = [node.position, ...(edge.path || []), tour.nodes[edge.target].position];
      // Sampling at intervals of at most 0.01 schematic units catches any
      // meaningful crossing in these straight, well-separated path segments.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01);
        for (let k = 0; k <= steps; k++) {
          const x = a[0] + (b[0] - a[0]) * k / steps;
          const y = a[1] + (b[1] - a[1]) * k / steps;
          assert.ok(!(x > table.x && x < table.x + table.width && y > table.y && y < table.y + table.height));
        }
      }
      const target = edge.path?.[0] || tour.nodes[edge.target].position;
      const projected = projectOffset([target[0] - node.position[0], target[1] - node.position[1], 0], edge.yaw, 0, 75, 1000, 600);
      assert.ok(Math.abs(projected.x - 500) < 1e-9);
    }
  }
});
