import { clamp, wrap } from './geometry.js';

export function dragDelta(dx, dy, pointerType, width, height, fov) {
  // A full-width touch swipe turns 180 degrees at the default 75-degree FOV.
  const scale = pointerType === 'touch' ? 180 / Math.max(1, width) * fov / 75 : fov / Math.max(1, height);
  return { yaw: -dx * scale, pitch: dy * scale };
}

export function orientationPose({ alpha, beta, gamma }) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const a = alpha * rad, b = beta * rad, g = gamma * rad;
  // W3C Device Orientation, appendix A.1: Rz(alpha) Rx(beta) Ry(gamma) * [0, 0, -1].
  // https://www.w3.org/TR/orientation-event/#worked-example
  // The back of the screen defines the viewing ray in portrait AND landscape.
  // Screen roll is deliberately ignored so the panorama horizon stays level.
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const z = -Math.cos(b) * Math.cos(g);
  return {
    yaw: Math.hypot(x, y) < 0.05 ? null : Math.atan2(x, y) / rad,
    pitch: Math.asin(clamp(z, -1, 1)) / rad,
  };
}

export class MotionControls {
  constructor({ target, onMove, onState, paused = () => false }) {
    this.target = target;
    this.onMove = onMove;
    this.onState = onState;
    this.paused = paused;
    this.state = 'off';
    this.generation = 0;
    this.previous = null;
    this.timer = null;
    this.receive = (event) => {
      if (this.state !== 'waiting' && this.state !== 'on') return;
      const pose = orientationPose(event);
      if (!pose) { this.rebase(); return; }
      if (this.state === 'waiting') {
        this.target.clearTimeout(this.timer);
        this.setState('on', 'Motion is on. Turn your phone to look around; swipe to adjust.');
      }
      if (this.previous && !this.paused()) {
        this.onMove({
          yaw: pose.yaw === null || this.previous.yaw === null ? 0 : wrap(pose.yaw - this.previous.yaw),
          pitch: pose.pitch - this.previous.pitch,
        });
      }
      this.previous = pose;
    };
  }

  setState(state, message) { this.state = state; this.onState(state, message); }
  rebase() { this.previous = null; }

  disable(message = 'Motion is off. Swipe to look around.') {
    ++this.generation;
    this.target.removeEventListener('deviceorientation', this.receive);
    this.target.clearTimeout(this.timer);
    this.rebase();
    this.setState('off', message);
  }

  async enable() {
    if (this.state !== 'off') return;
    const orientation = this.target.DeviceOrientationEvent;
    if (!this.target.isSecureContext || !orientation) {
      this.setState('off', 'Motion is unavailable here. Open the secure tour link in Safari or Chrome, or swipe to look.');
      return;
    }
    const generation = ++this.generation;
    this.setState('requesting', 'Allow motion access when your phone asks.');
    try {
      // Called directly from the button gesture, before any unrelated await.
      const permission = typeof orientation.requestPermission === 'function' ? await orientation.requestPermission() : 'granted';
      if (generation !== this.generation) return;
      if (permission !== 'granted') {
        this.disable('Motion permission was not granted. You can still swipe to look around.');
        return;
      }
      this.rebase();
      this.setState('waiting', 'Hold your phone upright. Waiting for motion…');
      this.target.addEventListener('deviceorientation', this.receive);
      this.timer = this.target.setTimeout(() => {
        if (this.state === 'waiting') this.disable('No motion data received. Try opening the link in Safari or Chrome and allowing motion access. Swiping still works.');
      }, 8000);
    } catch {
      if (generation === this.generation) this.disable('Motion access is blocked in this browser. Allow motion in browser settings, or swipe to look.');
    }
  }
}
