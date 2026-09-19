import './style.css';
import { PanoramaRenderer } from './panorama.js';
import { clamp, wrap, markerOffset, projectMarker, shortestRoute, validateTour } from './geometry.js';
import { drawFloorplan } from './floorplan.js';
import { dragDelta, MotionControls } from './controls.js';

const $ = (id) => document.getElementById(id);
const canvas = $('viewport');
const svgNS = 'http://www.w3.org/2000/svg';
const view = { yaw: 90, pitch: -16, fov: 80 };
let tour, pano, current, currentTexture, transition = null, moving = false, routing = false;
let routeToken = 0, preloadToken = 0, globalOffset = 0, dirty = true;
let retryAction = () => location.reload();
let markers = [], mapDots = new Map(), mapPositions = new Map(), heading;
let width = innerWidth, height = innerHeight;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const visited = new Set();

function status(message = '') { $('status').textContent = message; $('status').hidden = !message; }
function error(message, retry) { $('error-message').textContent = message; $('error').hidden = false; retryAction = retry; status(); }
$('retry').onclick = () => { $('error').hidden = true; retryAction(); };
function invalidate() { dirty = true; }
function nodeOffset(id) { return globalOffset + (tour.nodes[id].yawOffset || 0); }
function floorOffset(edge) {
  const node = tour.nodes[current];
  return markerOffset(edge, node, tour.nodes[edge.target], node.cameraHeight ?? tour.defaults?.cameraHeight ?? 1.6, nodeOffset(current));
}
function markerYaw(edge) {
  const [x, y] = floorOffset(edge);
  return Math.atan2(y, x) * 180 / Math.PI;
}
function distanceLabel(distance) {
  return tour.coordinates?.units === 'schematic' ? 'approximate placement' : `${distance.toFixed(2)} metres`;
}

function svgElement(tag, attributes, parent) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent.append(element); return element;
}

function buildMap() {
  const svg = $('minimap'); svg.replaceChildren();
  mapDots.clear(); mapPositions.clear();
  const entries = Object.entries(tour.nodes);
  $('viewpoint-select').replaceChildren(...entries.map(([id, node]) => new Option(`${id} · ${node.label}`, id)));
  $('viewpoint-select').onchange = (event) => navigate(event.target.value);
  const floor = tour.floorplan ? drawFloorplan(svg, tour.floorplan, svgElement) : null;
  const xs = entries.map(([, n]) => n.position[0]), ys = entries.map(([, n]) => n.position[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(188 / Math.max(maxX - minX, 0.5), 202 / Math.max(maxY - minY, 0.5));
  for (const [id, node] of entries) {
    mapPositions.set(id, floor ? floor.project(node.position) : [120 + (node.position[0] - (minX + maxX) / 2) * scale, 130 - (node.position[1] - (minY + maxY) / 2) * scale]);
  }
  heading = svgElement('path', { d: 'M0 0L26 -15Q33 0 26 15Z', class: 'map-heading' }, svg);
  for (const [id] of entries) {
    const [cx, cy] = mapPositions.get(id);
    const group = svgElement('g', { role: 'button', tabindex: 0, 'aria-label': `Walk to viewpoint ${id}`, class: 'map-node', 'data-node': id }, svg);
    svgElement('circle', { cx, cy, r: 13, class: 'map-hit' }, group);
    svgElement('circle', { cx, cy, r: 3, class: 'map-dot' }, group);
    const label = svgElement('text', { x: cx + 8, y: cy - 6, class: 'map-label' }, group); label.textContent = id;
    group.onclick = () => navigate(id);
    group.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(id); } };
    mapDots.set(id, group);
  }
  $('view-count').textContent = `${entries.length} views`;
}

function updateNode() {
  visited.add(current);
  const node = tour.nodes[current];
  $('position-label').textContent = `${current} · ${node.label || 'Living room'}`;
  $('position-label').dataset.node = current;
  $('viewpoint-select').value = current;
  $('markers').replaceChildren(); markers = [];
  for (const edge of node.neighbors) {
    const button = document.createElement('button'); button.className = 'floor-marker';
    button.dataset.target = edge.target;
    button.setAttribute('aria-label', `Move to viewpoint ${edge.target}, ${distanceLabel(edge.distance)}`);
    button.title = tour.nodes[edge.target].label;
    const ring = document.createElement('span'); ring.className = 'ring';
    const label = document.createElement('span'); label.className = 'marker-label'; label.textContent = edge.target;
    button.append(ring, label); button.onclick = () => navigate(edge.target);
    $('markers').append(button); markers.push({ button, edge });
  }
  for (const [id, dot] of mapDots) {
    dot.classList.toggle('current', id === current);
    dot.classList.toggle('visited', visited.has(id));
    dot.setAttribute('aria-current', id === current ? 'location' : 'false');
  }
  $('debug-neighbors').replaceChildren();
  for (const edge of node.neighbors) {
    const button = document.createElement('button');
    button.textContent = `→ ${edge.target}   ${edge.yaw.toFixed(1)}°   ${distanceLabel(edge.distance)}`;
    button.onclick = () => navigate(edge.target); $('debug-neighbors').append(button);
  }
  invalidate();
}

async function preload() {
  const token = ++preloadToken;
  const urls = tour.nodes[current].neighbors.map((edge) => tour.nodes[edge.target].image);
  pano.pin([tour.nodes[current].image, ...urls]);
  // Sequential warmup avoids competing parallel image decodes on modest devices.
  for (const url of urls) {
    if (token !== preloadToken) return;
    try { await pano.load(url); } catch { /* A click retries a failed neighbor. */ }
  }
}

async function step(target) {
  if (moving || target === current) return;
  if (!tour.nodes[current].neighbors.some((e) => e.target === target)) throw new Error('Viewpoints must be connected.');
  moving = true; ++preloadToken;
  $('app').classList.add('moving');
  const previous = current;
  pano.pin([tour.nodes[previous].image, tour.nodes[target].image]);
  status('Moving through the space…');
  try {
    const destination = await pano.load(tour.nodes[target].image);
    pano.setImages(currentTexture, destination);
    await new Promise((resolve) => {
      transition = { start: performance.now(), duration: reducedMotion.matches ? 0 : 480, resolve, target, from: previous };
      invalidate();
    });
    current = target; currentTexture = destination;
    pano.setImages(destination); updateNode(); status();
  } catch (reason) {
    pano.setImages(currentTexture); invalidate();
    throw reason;
  } finally {
    moving = false; $('app').classList.remove('moving');
    preload(); invalidate();
  }
}

async function navigate(target) {
  if (!tour || routing || moving || current === target) return;
  const route = shortestRoute(tour.nodes, current, target);
  if (!route) return error('There is no connected route to this viewpoint.', () => navigate(target));
  $('error').hidden = true;
  const token = ++routeToken; routing = true;
  try {
    for (const next of route) { if (token !== routeToken) break; await step(next); }
  } catch (reason) { error(`${reason.message} Your previous view is still available.`, () => navigate(target)); }
  finally { routing = false; $('viewpoint-select').value = current; }
}

function drawOverlays(renderFov) {
  const node = tour.nodes[current];
  for (const { button, edge } of markers) {
    const point = projectMarker(floorOffset(edge), view.yaw, view.pitch, renderFov, width, height);
    button.hidden = !point;
    if (point) {
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
    }
  }
  const [x, y] = mapPositions.get(current);
  heading.setAttribute('transform', `translate(${x},${y}) rotate(${tour.floorplan ? view.yaw : -view.yaw})`);
  if (!$('debug').hidden) {
    const unit = tour.coordinates?.units === 'schematic' ? '(schematic)' : 'm';
    $('debug-values').textContent = `Node ${current}\nXYZ  ${node.position.map(v => v.toFixed(3)).join(', ')} ${unit}\nYaw  ${wrap(view.yaw).toFixed(1)}°   Pitch ${view.pitch.toFixed(1)}°\nFOV  ${renderFov.toFixed(1)}°\nTextures  ${pano.cache.size} / ${pano.limit}`;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!pano || !currentTexture || (!dirty && !transition)) return;
  let blend = 0, fov = view.fov, offsetA = nodeOffset(current), offsetB = offsetA;
  if (transition) {
    const t = transition.duration ? clamp((now - transition.start) / transition.duration, 0, 1) : 1;
    blend = t * t * (3 - 2 * t);
    fov -= Math.sin(t * Math.PI) * 4;
    offsetA = nodeOffset(transition.from); offsetB = nodeOffset(transition.target);
    if (t >= 1) { const resolve = transition.resolve; transition = null; resolve(); }
  }
  pano.render({ ...view, fov }, blend, offsetA, offsetB);
  drawOverlays(fov); dirty = false;
}
requestAnimationFrame(frame);

function resize() { width = innerWidth; height = innerHeight; pano?.resize(width, height); invalidate(); }
addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); error('The graphics context was interrupted. Reload to restore the tour.', () => location.reload()); });

const pointers = new Map();
let motionNoticeTimer;
const motion = new MotionControls({
  target: window,
  paused: () => pointers.size > 0 || document.hidden,
  onMove: (delta) => {
    view.yaw = wrap(view.yaw + delta.yaw);
    view.pitch = clamp(view.pitch + delta.pitch, -85, 85);
    invalidate();
  },
  onState: (state, message) => {
    const active = state !== 'off';
    $('motion-toggle').setAttribute('aria-pressed', String(active));
    $('motion-toggle').setAttribute('aria-label', active ? 'Disable motion controls' : 'Enable motion controls');
    $('motion-toggle').textContent = state === 'on' ? 'Motion on' : active ? 'Motion…' : 'Motion off';
    $('motion-status').textContent = message;
    $('motion-status').hidden = !message;
    clearTimeout(motionNoticeTimer);
    motionNoticeTimer = setTimeout(() => { $('motion-status').hidden = true; }, 7000);
  },
});
$('motion-toggle').onclick = () => {
  if (motion.state === 'off') motion.enable(); else motion.disable();
};
document.addEventListener('visibilitychange', () => motion.rebase());
screen.orientation?.addEventListener('change', () => motion.rebase());
addEventListener('orientationchange', () => motion.rebase());
let pinchDistance = 0;
canvas.onpointerdown = (event) => {
  motion.rebase();
  canvas.focus(); canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
  canvas.classList.add('dragging'); $('hint').classList.add('dismissed');
};
canvas.onpointermove = (event) => {
  const previous = pointers.get(event.pointerId); if (!previous) return;
  const next = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, next);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) view.fov = clamp(view.fov * pinchDistance / Math.max(1, distance), 40, 100);
    pinchDistance = distance;
  } else {
    const delta = dragDelta(next.x - previous.x, next.y - previous.y, event.pointerType, width, height, view.fov);
    view.yaw = wrap(view.yaw + delta.yaw);
    view.pitch = clamp(view.pitch + delta.pitch, -85, 85);
  }
  invalidate();
};
function release(event) { pointers.delete(event.pointerId); if (!pointers.size) canvas.classList.remove('dragging'); pinchDistance = 0; motion.rebase(); }
canvas.onpointerup = release; canvas.onpointercancel = release; canvas.onlostpointercapture = release;
canvas.addEventListener('wheel', (event) => { event.preventDefault(); view.fov = clamp(view.fov + event.deltaY * 0.035, 40, 100); invalidate(); }, { passive: false });

function resetView() { motion.rebase(); Object.assign(view, { yaw: tour?.defaults?.yaw ?? 0, pitch: tour?.defaults?.pitch ?? -16, fov: tour?.defaults?.fov ?? 80 }); invalidate(); }
$('reset-view').onclick = resetView;
$('turn-left').onclick = () => { view.yaw = wrap(view.yaw - 25); invalidate(); };
$('turn-right').onclick = () => { view.yaw = wrap(view.yaw + 25); invalidate(); };
$('zoom-in').onclick = () => { view.fov = clamp(view.fov - 8, 40, 100); invalidate(); };
$('zoom-out').onclick = () => { view.fov = clamp(view.fov + 8, 40, 100); invalidate(); };
function toggleDebug() {
  $('debug').hidden = !$('debug').hidden;
  $('debug-toggle').setAttribute('aria-pressed', String(!$('debug').hidden));
  $('app').classList.toggle('debugging', !$('debug').hidden); invalidate();
}
$('debug-toggle').onclick = toggleDebug;
$('help-toggle').onclick = () => { $('help').hidden = !$('help').hidden; };
$('map-toggle').onclick = () => {
  $('map-body').hidden = !$('map-body').hidden;
  $('map-toggle').setAttribute('aria-expanded', String(!$('map-body').hidden));
  $('map-chevron').textContent = $('map-body').hidden ? '+' : '−';
};
$('map-enlarge').onclick = () => {
  const expanded = document.querySelector('.map-panel').classList.toggle('enlarged');
  $('map-enlarge').setAttribute('aria-pressed', String(expanded));
  $('map-enlarge').setAttribute('aria-label', expanded ? 'Reduce floor plan' : 'Enlarge floor plan');
  if (expanded) { $('map-body').hidden = false; $('map-toggle').setAttribute('aria-expanded', 'true'); $('map-chevron').textContent = '−'; }
};
$('yaw-offset').oninput = (event) => { globalOffset = Number(event.target.value); $('offset-value').textContent = `${globalOffset}°`; invalidate(); };
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('app').requestFullscreen(); }
  catch { error('Fullscreen is unavailable in this browser window.', () => { $('error').hidden = true; }); }
};
document.addEventListener('fullscreenchange', () => { $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); resize(); });
addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
  let handled = true;
  switch (event.key.toLowerCase()) {
    case 'arrowleft': view.yaw = wrap(view.yaw - 5); break;
    case 'arrowright': view.yaw = wrap(view.yaw + 5); break;
    case 'arrowup': view.pitch = clamp(view.pitch + 5, -85, 85); break;
    case 'arrowdown': view.pitch = clamp(view.pitch - 5, -85, 85); break;
    case '+': case '=': view.fov = clamp(view.fov - 5, 40, 100); break;
    case '-': view.fov = clamp(view.fov + 5, 40, 100); break;
    case 'd': toggleDebug(); break;
    case 'escape': ++routeToken; $('help').hidden = true; $('debug').hidden = true; $('app').classList.remove('debugging'); $('debug-toggle').setAttribute('aria-pressed', 'false'); break;
    case 'w': {
      if (!tour || !current) break;
      const nearest = [...tour.nodes[current].neighbors].sort((a, b) => Math.abs(wrap(markerYaw(a) - view.yaw)) - Math.abs(wrap(markerYaw(b) - view.yaw)))[0];
      if (nearest && Math.abs(wrap(markerYaw(nearest) - view.yaw)) < 70) navigate(nearest.target);
      break;
    }
    default: handled = false;
  }
  if (handled) { event.preventDefault(); invalidate(); }
});

async function initialize() {
  try {
    const url = new URL(new URLSearchParams(location.search).get('tour') || './tour.json', location.href);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Tour request failed (${response.status}). Run the data preparation scripts first.`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The tour file is missing or is not JSON. Check the tour URL or run the data preparation scripts.');
    tour = validateTour(await response.json());
    for (const node of Object.values(tour.nodes)) node.image = new URL(node.image, response.url || url.href).href;
    $('tour-title').textContent = tour.title || 'The space';
    $('tour-subtitle').textContent = tour.subtitle || '360° interior tour';
    document.title = `${tour.title || 'The space'} | 360 tour`;
    if (tour.attribution) { $('attribution').textContent = tour.attribution.text; if (/^https?:\/\//.test(tour.attribution.url)) $('attribution').href = tour.attribution.url; }
    globalOffset = tour.defaults?.yawOffset || 0;
    $('yaw-offset').value = globalOffset; $('offset-value').textContent = `${globalOffset}°`;
    resetView(); buildMap();
    pano = new PanoramaRenderer(canvas); resize();
    current = tour.startNode;
    pano.pin([tour.nodes[current].image]);
    currentTexture = await pano.load(tour.nodes[current].image);
    pano.setImages(currentTexture); updateNode(); preload(); status();
    $('app').classList.add('ready'); invalidate();
  } catch (reason) { error(reason.message || 'This browser could not initialize WebGL.', () => location.reload()); }
}
initialize();
