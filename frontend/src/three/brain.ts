import * as THREE from "three";
import { lowerBound, type BrainActivity, type BrainAtlas } from "../lib/brainData";

export type { BrainActivity, BrainAtlas } from "../lib/brainData";

// role codes in the shader
export const ROLE = { none: 0, sugar: 1, mn9: 2, silenced: 3 } as const;
export const ROLE_COLORS = { spike: "#ffd25a", sugar: "#7dd3fc", mn9: "#ff5fa2", silenced: "#94a3b8" } as const;

const vert = /* glsl */ `
  attribute float aLast;
  attribute float aRole;
  attribute float aBase;
  uniform float uTime;
  uniform float uDecay;
  uniform float uSize;
  uniform float uScale;
  varying float vI;
  varying float vRole;
  varying float vBase;
  void main() {
    float dt = uTime - aLast;
    vI = dt >= 0.0 ? exp(-dt / uDecay) : 0.0;
    vRole = aRole;
    vBase = aBase;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = uSize * (1.0 + 1.6 * vI) * (aRole > 1.5 ? 2.4 : aRole > 0.5 ? 1.4 : 1.0);
    gl_PointSize = s * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform vec3 cSpike;
  uniform vec3 cSugar;
  uniform vec3 cMn9;
  uniform vec3 cSil;
  uniform float uRest;
  uniform float uOpacity;
  varying float vI;
  varying float vRole;
  varying float vBase;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float soft = 1.0 - r * 4.0;
    vec3 rest = mix(vec3(0.3, 0.38, 0.85), vec3(0.5, 0.48, 0.95), vBase);
    vec3 hot = cSpike;
    float restA = uRest;
    if (vRole > 2.5) { rest = cSil; hot = cSil; restA = 0.55; }
    else if (vRole > 1.5) { rest = cMn9; hot = vec3(1.0, 0.75, 0.9); restA = 0.6; }
    else if (vRole > 0.5) { rest = cSugar; hot = cSugar * 1.15; restA = 0.35; }
    vec3 col = mix(rest, hot, vI);
    float a = (restA + (1.0 - restA) * vI) * soft * uOpacity;
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * Point cloud of all positioned neurons. A neuron flashes when the simulation says it spiked
 * and fades with time constant `decayMs` (APP display choice).
 */
export class BrainCloud {
  readonly points: THREE.Points;
  private last: Float32Array;
  private lastAttr: THREE.BufferAttribute;
  private roleAttr: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private idxOf: Int32Array; // neuron index -> point index (-1 = no position)
  private act: { n: Int32Array; t: Float32Array } | null = null;
  private ptr = 0;
  private tNow = -1;
  decayMs = 12;

  constructor(readonly atlas: BrainAtlas, scale: number) {
    const keep: number[] = [];
    for (let i = 0; i < atlas.n; i++) if (!Number.isNaN(atlas.pos[i * 3])) keep.push(i);
    const m = keep.length;
    const pos = new Float32Array(m * 3);
    const base = new Float32Array(m);
    this.idxOf = new Int32Array(atlas.n).fill(-1);
    const optic = atlas.classNames.indexOf("optic");
    keep.forEach((i, k) => {
      this.idxOf[i] = k;
      pos[k * 3] = atlas.pos[i * 3] * scale;
      pos[k * 3 + 1] = atlas.pos[i * 3 + 1] * scale;
      pos[k * 3 + 2] = atlas.pos[i * 3 + 2] * scale;
      base[k] = atlas.cls[i] === optic ? 0 : 1;
    });
    this.last = new Float32Array(m).fill(-1e9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.lastAttr = new THREE.BufferAttribute(this.last, 1);
    this.lastAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aLast", this.lastAttr);
    this.roleAttr = new THREE.BufferAttribute(new Float32Array(m), 1);
    geo.setAttribute("aRole", this.roleAttr);
    geo.setAttribute("aBase", new THREE.BufferAttribute(base, 1));
    const col = (h: string) => new THREE.Color(h);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDecay: { value: this.decayMs },
        uSize: { value: 1.0 },
        uScale: { value: 300 },
        uRest: { value: 0.11 },
        uOpacity: { value: 1 },
        cSpike: { value: col(ROLE_COLORS.spike) },
        cSugar: { value: col(ROLE_COLORS.sugar) },
        cMn9: { value: col(ROLE_COLORS.mn9) },
        cSil: { value: col(ROLE_COLORS.silenced) },
      },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get pointCount(): number {
    return this.last.length;
  }

  setViewport(heightPx: number, fovDeg: number, pointWorldSize: number): void {
    // gl_PointSize = uSize * uScale / depth; choose uScale so a point is pointWorldSize wide
    this.mat.uniforms.uScale.value = (heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360))) * pointWorldSize;
  }

  setOpacity(a: number): void {
    this.mat.uniforms.uOpacity.value = a;
    this.points.visible = a > 0.001;
  }

  setActivity(a: BrainActivity | null): void {
    const roles = new Float32Array(this.last.length);
    if (a) {
      this.act = { n: Int32Array.from(a.neuron), t: Float32Array.from(a.t_ms) };
      const mark = (ids: number[], code: number) => ids.forEach((i) => this.idxOf[i] >= 0 && (roles[this.idxOf[i]] = code));
      mark(a.roles.sugar_grns, ROLE.sugar);
      mark(a.roles.mn9, ROLE.mn9);
      mark(a.roles.silenced, ROLE.silenced);
    } else this.act = null;
    (this.roleAttr.array as Float32Array).set(roles);
    this.roleAttr.needsUpdate = true;
    this.tNow = -1;
    this.setTime(0, true);
  }

  /** Advance the flash state to simulated time tMs (handles scrubbing backwards). */
  setTime(tMs: number, force = false): void {
    this.mat.uniforms.uTime.value = tMs;
    this.mat.uniforms.uDecay.value = this.decayMs;
    if (!this.act) return;
    const { n, t } = this.act;
    if (force || tMs < this.tNow) {
      this.last.fill(-1e9);
      // only the recent past matters (flashes fade within ~10 decay constants)
      const from = tMs - 10 * this.decayMs;
      this.ptr = lowerBound(t, from);
    }
    while (this.ptr < t.length && t[this.ptr] <= tMs) {
      const k = this.idxOf[n[this.ptr]];
      if (k >= 0) this.last[k] = t[this.ptr];
      this.ptr++;
    }
    this.tNow = tMs;
    this.lastAttr.needsUpdate = true;
  }

  /** neurons that spiked within (tMs - windowMs, tMs] */
  activeCount(tMs: number, windowMs: number): number {
    if (!this.act) return 0;
    const { t } = this.act;
    return lowerBound(t, tMs + 1e-6) - lowerBound(t, tMs - windowMs + 1e-6);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
