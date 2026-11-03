import * as THREE from "three";

/**
 * Procedural, jointed proboscis added under the head of the (fused, unrigged) fly mesh.
 * Three segments as in the fly: rostrum (base), haustellum (middle), labellum (two lobes).
 *
 * APP: the model gives one number, the MN9 rate, turned into an extension fraction e in [0, 1]
 * by lib/mapping.ts. How e is split across the three joints (rostrum first, then haustellum,
 * then labellum opening) is a presentation choice, not model output. The paper only says MN9
 * "controls rostrum lifting during proboscis extension".
 */

export interface ProboscisPose {
  rostrum: number; // rad about the head's left-right axis; + points back, - points forward
  haustellum: number; // rad relative to rostrum
  labellum: number; // rad relative to haustellum
  spread: number; // rad, each labellar lobe opens sideways
}

export const PROBOSCIS = {
  // joint angles at e = 0 (folded "Z" under the head) and e = 1 (extended down and forward)
  rostrum: [1.15, -0.3],
  haustellum: [-2.35, 0.18],
  labellum: [-0.7, 0.0],
  spread: [0.05, 0.55],
  // e sub-ranges over which each joint moves
  phase: { rostrum: [0, 0.6], haustellum: [0.15, 0.85], labellum: [0.55, 1] },
} as const;

const ramp = (e: number, a: number, b: number) => Math.min(1, Math.max(0, (e - a) / (b - a)));
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const lerp = (r: readonly [number, number], k: number) => r[0] + (r[1] - r[0]) * k;

export function proboscisPose(e: number): ProboscisPose {
  const x = Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : 0;
  const ph = PROBOSCIS.phase;
  const kr = smoothstep(ramp(x, ph.rostrum[0], ph.rostrum[1]));
  const kh = smoothstep(ramp(x, ph.haustellum[0], ph.haustellum[1]));
  const kl = smoothstep(ramp(x, ph.labellum[0], ph.labellum[1]));
  return {
    rostrum: lerp(PROBOSCIS.rostrum, kr),
    haustellum: lerp(PROBOSCIS.haustellum, kh),
    labellum: lerp(PROBOSCIS.labellum, kl),
    spread: lerp(PROBOSCIS.spread, kl),
  };
}

function segment(len: number, r0: number, r1: number, color: number, rough = 0.55): THREE.Mesh {
  // tapered tube along -Y from the joint with domed ends (overlaps the next joint slightly)
  const pts: THREE.Vector2[] = [];
  const n = 18;
  const dome = Math.min(r0, r1) * 0.9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -dome * 0.4 + (len + dome * 0.8) * t;
    let r = r0 + (r1 - r0) * Math.min(1, Math.max(0, (y - 0) / len));
    const a = Math.min(y + dome * 0.4, len + dome * 0.4 - y); // distance from either end
    if (a < dome) r *= Math.sqrt(Math.max(0, 1 - ((dome - a) / dome) ** 2));
    pts.push(new THREE.Vector2(Math.max(0.0004, r), -y));
  }
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export class Proboscis {
  readonly root = new THREE.Group();
  private rostrum = new THREE.Group();
  private haustellum = new THREE.Group();
  private labellum = new THREE.Group();
  private lobes: THREE.Group[] = [];
  readonly materials: THREE.MeshStandardMaterial[] = [];

  constructor(scale: number) {
    const L = scale;
    const rost = segment(0.42 * L, 0.11 * L, 0.085 * L, 0x4a4038, 0.7); // membranous
    const haus = segment(0.4 * L, 0.075 * L, 0.06 * L, 0x231d19, 0.45); // sclerotised
    this.rostrum.add(rost);
    this.haustellum.position.set(0, -0.4 * L, 0);
    this.haustellum.add(haus);
    this.rostrum.add(this.haustellum);
    this.labellum.position.set(0, -0.38 * L, 0);
    this.haustellum.add(this.labellum);
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const lobeGeo = new THREE.SphereGeometry(0.15 * L, 20, 14);
      lobeGeo.scale(0.75, 1.0, 1.25);
      lobeGeo.translate(0, -0.11 * L, 0);
      const lobe = new THREE.Mesh(lobeGeo, new THREE.MeshStandardMaterial({ color: 0x6e6252, roughness: 0.8 }));
      lobe.castShadow = true;
      lobe.position.x = side * 0.06 * L;
      g.add(lobe);
      g.userData.side = side;
      this.labellum.add(g);
      this.lobes.push(g);
    }
    this.root.add(this.rostrum);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) this.materials.push(o.material as THREE.MeshStandardMaterial);
    });
    this.setPose(proboscisPose(0));
  }

  setPose(p: ProboscisPose): void {
    this.rostrum.rotation.x = p.rostrum;
    this.haustellum.rotation.x = p.haustellum;
    this.labellum.rotation.x = p.labellum;
    for (const g of this.lobes) g.rotation.z = (g.userData.side as number) * p.spread;
  }

  /** World position of the labellum (for placing the sugar drop / contact cue). */
  tipWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return this.labellum.getWorldPosition(target);
  }
}
