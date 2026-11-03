// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import * as THREE from "three";

/** Arena episode as exported by scripts/export_site_data.py / the arena API (HYBRID DEMONSTRATION). */
export interface ArenaEpisode {
  name?: string;
  label: string;
  config: { layout: string; seed: number; decoder: string; silenced_ids: string[]; walk_speed_mm_s: number; duration_s: number };
  arena: {
    width_mm: number;
    height_mm: number;
    patches: { x: number; y: number; r: number; amount: number }[];
    obstacles: { x: number; y: number; w: number; h: number }[];
    start: number[];
  };
  record: {
    t_s: number[];
    x: number[];
    y: number[];
    heading: number[];
    speed: number[];
    feeding: boolean[];
    extension: number[];
    out_rate_hz: number[];
    out_smoothed_hz: number[];
    patch: number[];
    concentration: number[];
    amounts: number[][];
  };
  control_dt_s: number;
  summary: { time_feeding_s: number; time_on_patch_s: number; path_length_mm: number; mean_out_rate_on_patch_hz: number | null };
  timing: { wall_s: number; simulated_s: number };
}

/**
 * APP: scale used only for drawing. The 3D fly's body (head to abdomen tip) is ~0.86 model units;
 * it is drawn as a 2.5 mm Drosophila-sized body so the arena's millimetres and walking speed keep
 * their proportions.
 */
export const BODY_UNITS = 0.86;
export const BODY_MM = 2.5;
export const UNITS_PER_MM = BODY_UNITS / BODY_MM;

export interface ArenaPose {
  t: number;
  x: number; // world units
  z: number;
  yaw: number; // rotation.y for the fly root
  speedBl: number; // body lengths per second
  extension: number;
  feeding: boolean;
  outRate: number;
  outSmoothed: number;
  patch: number;
  amounts: number[];
  k: number; // record index
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

export function toWorld(ep: ArenaEpisode, xmm: number, ymm: number): [number, number] {
  return [(xmm - ep.arena.width_mm / 2) * UNITS_PER_MM, (ymm - ep.arena.height_mm / 2) * UNITS_PER_MM];
}

/** Body pose at simulated time t (s), interpolated between 50 ms control windows. */
export function arenaPose(ep: ArenaEpisode, t: number): ArenaPose {
  const r = ep.record;
  const dt = ep.control_dt_s;
  const n = r.t_s.length;
  // record k describes the state at the end of window k, i.e. t = (k + 1) * dt; t = 0 is the start position
  const f = Math.min(n, Math.max(0, t / dt));
  const k1 = Math.min(n - 1, Math.floor(f));
  const k0 = k1 - 1;
  const a = f - Math.floor(f);
  const sx = k0 >= 0 ? r.x[k0] : ep.arena.start[0];
  const sy = k0 >= 0 ? r.y[k0] : ep.arena.start[1];
  const sh = k0 >= 0 ? r.heading[k0] : ep.arena.start[2];
  const x = sx + (r.x[k1] - sx) * a;
  const y = sy + (r.y[k1] - sy) * a;
  const h = lerpAngle(sh, r.heading[k1], a);
  const [wx, wz] = toWorld(ep, x, y);
  // heading h points along (cos h, sin h) in arena (x, y) = world (x, z); the fly model faces +z
  return {
    t,
    x: wx,
    z: wz,
    yaw: Math.atan2(Math.cos(h), Math.sin(h)),
    speedBl: r.speed[k1] / BODY_MM,
    extension: r.extension[k1],
    feeding: r.feeding[k1],
    outRate: r.out_rate_hz[k1],
    outSmoothed: r.out_smoothed_hz[k1],
    patch: r.patch[k1],
    amounts: r.amounts[k1],
    k: k1,
  };
}

/** Floor, food patches and obstacles of an arena episode. */
export class ArenaWorld {
  readonly group = new THREE.Group();
  private patchMats: THREE.MeshStandardMaterial[] = [];
  private trail: THREE.Line;
  private trailPts: Float32Array;

  constructor(readonly ep: ArenaEpisode) {
    const W = ep.arena.width_mm * UNITS_PER_MM;
    const H = ep.arena.height_mm * UNITS_PER_MM;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c3566, roughness: 0.92 }));
    floor.receiveShadow = true;
    floor.position.y = 0.0005;
    this.group.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, H), Math.round(Math.max(ep.arena.width_mm, ep.arena.height_mm) / 10), 0x5560a0, 0x3a4378);
    grid.position.y = 0.002;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.group.add(grid);
    // walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4170, roughness: 0.8 });
    const wallH = 1.2;
    for (const [w, d, x, z] of [
      [W, 0.15, 0, -H / 2],
      [W, 0.15, 0, H / 2],
      [0.15, H, -W / 2, 0],
      [0.15, H, W / 2, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    for (const p of ep.arena.patches) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.15, transparent: true, opacity: 0.55, emissive: 0x2a7fd0, emissiveIntensity: 0.25 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * UNITS_PER_MM, 64).rotateX(-Math.PI / 2), mat);
      const [x, z] = toWorld(ep, p.x, p.y);
      disc.position.set(x, 0.006, z);
      this.patchMats.push(mat);
      this.group.add(disc);
    }
    for (const o of ep.arena.obstacles) {
      const h = 1.6;
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.w * UNITS_PER_MM, h, o.h * UNITS_PER_MM), new THREE.MeshStandardMaterial({ color: 0x6b5a8e, roughness: 0.7 }));
      const [x, z] = toWorld(ep, o.x + o.w / 2, o.y + o.h / 2);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    const n = ep.record.t_s.length + 1;
    this.trailPts = new Float32Array(n * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPts, 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.7 }));
    this.trail.position.y = 0.01;
    this.group.add(this.trail);
    const [sx, sz] = toWorld(ep, ep.arena.start[0], ep.arena.start[1]);
    this.trailPts.set([sx, 0, sz], 0);
    ep.record.x.forEach((x, k) => {
      const [wx, wz] = toWorld(ep, x, ep.record.y[k]);
      this.trailPts.set([wx, 0, wz], (k + 1) * 3);
    });
    tg.getAttribute("position").needsUpdate = true;
  }

  update(p: ArenaPose): void {
    this.patchMats.forEach((m, i) => {
      const amt = p.amounts[i] ?? 0;
      m.opacity = 0.15 + 0.55 * amt;
      m.emissiveIntensity = p.patch === i ? 0.5 : 0.25;
    });
    this.trail.geometry.setDrawRange(0, p.k + 2);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
