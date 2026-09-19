// Coordinates follow the reference photo: X right, Y down; units are schematic.
export function drawFloorplan(svg, plan, create) {
  const [left, top, right, bottom] = plan.bounds;
  svg.setAttribute('viewBox', '0 0 240 440');
  const scale = Math.min(208 / (right - left), 416 / (bottom - top));
  const project = ([x, y]) => [120 + (x - (left + right) / 2) * scale, 220 + (y - (top + bottom) / 2) * scale];
  const points = (vertices) => vertices.map(p => project(p).join(',')).join(' ');
  create('polygon', { points: points(plan.outline), class: 'plan-room' }, svg);
  if (plan.shower) {
    create('polygon', { points: points(plan.shower.outline), class: 'plan-shower' }, svg);
    create('polyline', { points: points(plan.shower.divider), class: 'plan-shower-divider' }, svg);
  }
  for (const wall of plan.walls || []) create('polyline', { points: points(wall), class: 'plan-wall' }, svg);
  for (const item of plan.labels || []) {
    const [x, y] = project(item.position);
    const label = create('text', { x, y, class: 'plan-label' }, svg);
    label.textContent = item.text;
  }
  for (const item of plan.furniture) {
    const [x, y] = project([item.x, item.y]);
    create('rect', { x, y, width: item.width * scale, height: item.height * scale, rx: 3, class: 'plan-furniture' }, svg);
    if (item.label) {
      const label = create('text', { x: x + item.width * scale / 2, y: y + item.height * scale / 2, class: 'plan-label' }, svg);
      label.textContent = item.label;
    }
  }
  for (const window of plan.windows) create('polyline', { points: points(window), class: 'plan-window' }, svg);
  for (const item of plan.fixtures || []) {
    const [x, y] = project(item.position), w = item.width * scale, h = item.height * scale;
    const group = create('g', { class: 'plan-fixture', transform: `translate(${x},${y}) rotate(${item.rotation || 0})`, 'data-fixture': item.type }, svg);
    const title = create('title', {}, group); title.textContent = item.type;
    if (item.type === 'Toilet') {
      create('rect', { x: -w / 2, y: -h / 2, width: w, height: h * .3, rx: 1 }, group);
      create('ellipse', { cx: 0, cy: h * .13, rx: w * .4, ry: h * .37 }, group);
    } else {
      create('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: item.type === 'Sink' ? 4 : 1 }, group);
      create('ellipse', { cx: 0, cy: 0, rx: w * .32, ry: h * .32 }, group);
    }
  }
  for (const door of plan.doors || []) {
    const group = create('g', { class: 'plan-door', 'data-door': door.id }, svg);
    // Mask a wall at the doorway, then draw the leaf and its indicative swing.
    create('polyline', { points: points([door.hinge, door.closed]), class: 'plan-door-opening' }, group);
    create('polyline', { points: points([door.hinge, door.open]), class: 'plan-door-leaf' }, group);
    const a = project(door.closed), b = project(door.open);
    const radius = Math.hypot(door.closed[0] - door.hinge[0], door.closed[1] - door.hinge[1]) * scale;
    create('path', { d: `M${a.join(',')} A${radius},${radius} 0 0 ${door.sweep || 0} ${b.join(',')}`, class: 'plan-door-swing' }, group);
  }
  return { project, points };
}
