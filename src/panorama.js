import * as THREE from 'three';
import { radians } from './geometry.js';

export class PanoramaRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.uniforms = {
      imageA: { value: null }, imageB: { value: null }, blend: { value: 0 },
      yaw: { value: 0 }, pitch: { value: 0 }, fov: { value: 1 }, aspect: { value: 1 },
      offsetA: { value: 0 }, offsetB: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 screen; void main() { screen = uv * 2.0 - 1.0; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D imageA, imageB;
        uniform float blend, yaw, pitch, fov, aspect, offsetA, offsetB;
        varying vec2 screen;
        const float PI = 3.141592653589793;
        vec2 panoUV(vec3 ray, float offset) {
          return vec2(fract(0.5 + (atan(ray.y, ray.x) - offset) / (2.0 * PI)), 0.5 + asin(clamp(ray.z, -1.0, 1.0)) / PI);
        }
        void main() {
          vec3 forward = vec3(cos(pitch)*cos(yaw), cos(pitch)*sin(yaw), sin(pitch));
          vec3 right = vec3(-sin(yaw), cos(yaw), 0.0);
          vec3 up = vec3(-sin(pitch)*cos(yaw), -sin(pitch)*sin(yaw), cos(pitch));
          vec3 ray = normalize(forward + tan(fov*0.5)*(screen.x*aspect*right + screen.y*up));
          gl_FragColor = mix(texture2D(imageA, panoUV(ray, offsetA)), texture2D(imageB, panoUV(ray, offsetB)), blend);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.camera = new THREE.Camera();
    this.cache = new Map();
    this.pinned = new Set();
    this.limit = 8;
  }

  async load(url) {
    if (this.cache.has(url)) {
      const entry = this.cache.get(url);
      this.cache.delete(url); this.cache.set(url, entry);
      return entry.promise;
    }
    const entry = { texture: null, promise: null };
    entry.promise = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Panorama request failed (${response.status}).`);
      const blob = await response.blob();
      const image = new Image();
      const objectURL = URL.createObjectURL(blob);
      try {
        image.src = objectURL;
        await image.decode();
        if (Math.abs(image.width / image.height - 2) > 0.02) throw new Error('Expected a 2:1 equirectangular panorama.');
        const texture = new THREE.Texture(image);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        entry.texture = texture;
        this.evict();
        return texture;
      } finally { URL.revokeObjectURL(objectURL); }
    })().catch((error) => { this.cache.delete(url); throw error; });
    this.cache.set(url, entry);
    return entry.promise;
  }

  pin(urls) { this.pinned = new Set(urls); this.evict(); }
  evict() {
    for (const [url, entry] of this.cache) {
      if (this.cache.size <= this.limit) break;
      if (!this.pinned.has(url) && entry.texture) {
        entry.texture.dispose(); this.cache.delete(url);
      }
    }
  }
  setImages(a, b = a) { this.uniforms.imageA.value = a; this.uniforms.imageB.value = b; }
  render(view, blend = 0, offsetA = 0, offsetB = offsetA) {
    this.uniforms.yaw.value = radians(view.yaw);
    this.uniforms.pitch.value = radians(view.pitch);
    this.uniforms.fov.value = radians(view.fov);
    this.uniforms.blend.value = blend;
    this.uniforms.offsetA.value = radians(offsetA);
    this.uniforms.offsetB.value = radians(offsetB);
    this.renderer.render(this.scene, this.camera);
  }
  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.uniforms.aspect.value = width / Math.max(height, 1);
  }
}
