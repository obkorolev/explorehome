import test from 'node:test';
import assert from 'node:assert/strict';
import { dragDelta, orientationPose, MotionControls } from '../src/controls.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const pose = (alpha, beta = 90, gamma = 0) => ({ alpha, beta, gamma });

function fixture(permission) {
  const listeners = new Map(), timers = new Map(), moves = [], states = [];
  let nextTimer = 0, paused = false;
  const target = {
    isSecureContext: true,
    DeviceOrientationEvent: permission ? { requestPermission: permission } : {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  };
  const control = new MotionControls({ target, onMove: (move) => moves.push(move), onState: (state, message) => states.push({ state, message }), paused: () => paused });
  return { control, target, moves, states, listeners, timers,
    emit: (event) => listeners.get('deviceorientation')?.(event),
    pause: (value) => { paused = value; },
  };
}

test('touch swipe spans half a turn in portrait and landscape; desktop sensitivity is unchanged', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) {
    near(dragDelta(width, 0, 'touch', width, height, 75).yaw, -180);
    near(dragDelta(width / 2, 0, 'touch', width, height, 75).yaw, -90);
    near(dragDelta(width, 0, 'touch', width, height, 40).yaw, -96);
  }
  near(dragDelta(100, 50, 'mouse', 1440, 900, 75).yaw, -100 * 75 / 900);
  near(dragDelta(100, 50, 'mouse', 1440, 900, 75).pitch, 50 * 75 / 900);
});

test('sensor ray follows right turns and upward tilts, independent of portrait or landscape roll', () => {
  near(orientationPose(pose(0)).yaw, 0);
  near(orientationPose(pose(330)).yaw, 30);
  near(orientationPose(pose(0, 120)).pitch, 30);
  near(orientationPose(pose(0, 60)).pitch, -30);
  // Same forward direction with the handset rolled 90 degrees into landscape.
  const portrait = orientationPose(pose(0));
  const landscape = orientationPose(pose(90, 0, -90));
  near(landscape.yaw, portrait.yaw);
  near(landscape.pitch, portrait.pitch);
  near(orientationPose(pose(60, 0, -90)).yaw, 30);
  assert.equal(orientationPose(pose(null)), null);
  assert.equal(orientationPose(pose(NaN)), null);
  assert.equal(orientationPose(pose(0, 0)).yaw, null);
});

test('motion permission is requested synchronously; first reading preserves the view and wraparound stays smooth', async () => {
  let requests = 0;
  const f = fixture(() => { ++requests; return Promise.resolve('granted'); });
  const enabling = f.control.enable();
  assert.equal(requests, 1);
  await enabling;
  f.emit(pose(359));
  assert.equal(f.moves.length, 0);
  assert.equal(f.control.state, 'on');
  f.emit(pose(1));
  near(f.moves[0].yaw, -2);
  f.emit(pose(1, 110));
  near(f.moves[1].pitch, 20);
  assert.equal(f.timers.size, 0);
});

test('swiping, screen rotation and resume can rebase without undoing the manual view', async () => {
  const f = fixture();
  await f.control.enable();
  f.emit(pose(0));
  f.pause(true);
  f.emit(pose(90));
  assert.equal(f.moves.length, 0);
  f.pause(false); f.control.rebase();
  f.emit(pose(100));
  assert.equal(f.moves.length, 0);
  f.emit(pose(105));
  near(f.moves[0].yaw, -5);
  f.control.rebase(); f.emit(pose(200));
  assert.equal(f.moves.length, 1);
});

test('flat-phone heading and missing sensor values cannot jump the heading or inject NaN', async () => {
  const f = fixture();
  await f.control.enable();
  f.emit(pose(0)); f.emit(pose(170, 0)); f.emit(pose(180));
  assert.ok(f.moves.every((move) => move.yaw === 0 && Number.isFinite(move.pitch)));
  f.emit(pose(null)); f.emit(pose(10));
  assert.equal(f.moves.length, 2);
});

test('denied or rejected permission leaves motion off with no listeners', async () => {
  for (const permission of [() => Promise.resolve('denied'), () => Promise.reject(new Error('blocked'))]) {
    const f = fixture(permission);
    await f.control.enable();
    assert.equal(f.control.state, 'off');
    assert.equal(f.listeners.size, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('no sensor data times out, and disabling removes the event listener', async () => {
  const f = fixture();
  await f.control.enable();
  f.emit(pose(null));
  [...f.timers.values()][0]();
  assert.equal(f.control.state, 'off');
  assert.equal(f.listeners.size, 0);
  await f.control.enable(); f.emit(pose(0));
  f.control.disable(); f.emit(pose(90));
  assert.equal(f.moves.length, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('canceling while permission is pending cannot turn motion back on', async () => {
  let resolve;
  const f = fixture(() => new Promise((done) => { resolve = done; }));
  const enabling = f.control.enable();
  f.control.disable(); resolve('granted'); await enabling;
  assert.equal(f.control.state, 'off');
  assert.equal(f.listeners.size, 0);
});

test('unsupported or insecure browsers keep swipe controls available', async () => {
  for (const override of [{ isSecureContext: false }, { DeviceOrientationEvent: undefined }]) {
    const f = fixture(); Object.assign(f.target, override);
    await f.control.enable();
    assert.equal(f.control.state, 'off');
    assert.match(f.states.at(-1).message, /swipe/);
    assert.equal(f.listeners.size, 0);
  }
});
