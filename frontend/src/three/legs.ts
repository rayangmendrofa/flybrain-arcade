import * as THREE from "three";
import type { LegId } from "./gait";

/**
 * The supplied fly mesh is one fused, unrigged surface. To let the legs step (APP animation in the
 * arena) without a skeleton, the lower part of each leg is found automatically and bent in the
 * vertex shader: every vertex below CUT_Y that is connected (below CUT_Y) to a foot touching the
 * ground belongs to that leg, and is displaced by the leg's foot offset times a weight that rises
 * from 0 at CUT_Y to 1 at the ground. Upper legs and the body never move.
 */
export const CUT_Y = 0.15;
const FOOT_Y = 0.08; // a leg's lowest point must be below this (after levelling all are < 0.035)
const FULL_SPAN = 0.015; // weight reaches 1 this far above the leg's lowest point

export interface LegRig {
  /** six offsets in mesh-local space, written by setFootOffsets */
  uniforms: { uLegOff: { value: THREE.Vector3[] }; uLegTint: { value: number }; uTintColor: { value: THREE.Color } };
  legOrder: LegId[];
  /** per leg: how far its foot is above the floor; the rig always pulls it down by this much */
  plant: number[];
  /** body-frame -> mesh-local linear map */
  toLocal: THREE.Matrix3;
  found: number;
}

/** positions of `mesh` expressed in the frame of `body` (the aligned fly frame) */
function bodyFramePositions(mesh: THREE.Mesh, body: THREE.Object3D): { p: Float32Array; m: THREE.Matrix4 } {
  body.updateMatrixWorld(true);
  const m = new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(mesh.matrixWorld);
  const attr = mesh.geometry.getAttribute("position");
  const p = new Float32Array(attr.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(m);
    p[i * 3] = v.x;
    p[i * 3 + 1] = v.y;
    p[i * 3 + 2] = v.z;
  }
  return { p, m };
}

export function rigLegs(mesh: THREE.Mesh, body: THREE.Object3D, materials: THREE.Material[]): LegRig {
  const geo = mesh.geometry;
  const { p, m } = bodyFramePositions(mesh, body);
  const n = p.length / 3;
  const idx = geo.getIndex();
  // union-find over triangles lying entirely below the cut
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const below = (i: number) => p[i * 3 + 1] < CUT_Y;
  const tri = idx ? idx.array : null;
  const nt = tri ? tri.length / 3 : n / 3;
  for (let t = 0; t < nt; t++) {
    const a = tri ? tri[t * 3] : t * 3, b = tri ? tri[t * 3 + 1] : t * 3 + 1, c = tri ? tri[t * 3 + 2] : t * 3 + 2;
    if (!(below(a) && below(b) && below(c))) continue;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  // components that reach the ground are legs
  const stats = new Map<number, { count: number; minY: number; sx: number; sz: number }>();
  for (let i = 0; i < n; i++) {
    if (!below(i)) continue;
    const r = find(i);
    const s = stats.get(r) ?? { count: 0, minY: Infinity, sx: 0, sz: 0 };
    s.count++;
    s.minY = Math.min(s.minY, p[i * 3 + 1]);
    s.sx += p[i * 3];
    s.sz += p[i * 3 + 2];
    stats.set(r, s);
  }
  const legsFound = [...stats.entries()]
    .filter(([, s]) => s.minY < FOOT_Y && s.count > 40)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([root, s]) => ({ root, x: s.sx / s.count, z: s.sz / s.count, minY: s.minY }));
  // name them: fly's left is +x in this frame; front/middle/hind by z
  const order: LegId[] = [];
  const plant: number[] = [];
  const minYOf = new Map<number, number>();
  const legOf = new Map<number, number>();
  for (const side of ["L", "R"] as const) {
    const these = legsFound.filter((l) => (side === "L" ? l.x > 0 : l.x <= 0)).sort((a, b) => b.z - a.z);
    these.forEach((l, k) => {
      legOf.set(l.root, order.length);
      minYOf.set(l.root, l.minY);
      order.push(`${side}${Math.min(3, k + 1)}` as LegId);
      plant.push(Math.max(0, l.minY));
    });
  }
  const aLeg = new Float32Array(n).fill(-1);
  const aW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!below(i)) continue;
    const r = find(i);
    const k = legOf.get(r);
    if (k === undefined) continue;
    aLeg[i] = k;
    const full = (minYOf.get(r) ?? 0) + FULL_SPAN;
    const t = Math.min(1, Math.max(0, (CUT_Y - p[i * 3 + 1]) / (CUT_Y - full)));
    aW[i] = t * t * (3 - 2 * t);
  }
  geo.setAttribute("aLeg", new THREE.BufferAttribute(aLeg, 1));
  geo.setAttribute("aLegW", new THREE.BufferAttribute(aW, 1));

  const uniforms = {
    uLegOff: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    uLegTint: { value: 0 },
    uTintColor: { value: new THREE.Color("#f472b6") },
  };
  for (const mat of materials) patchMaterial(mat, uniforms);
  const toLocal = new THREE.Matrix3().setFromMatrix4(m).invert();
  const rig: LegRig = { uniforms, legOrder: order, plant, toLocal, found: order.length };
  setFootOffsets(rig, {} as Record<LegId, { dz: number; dy: number }>);
  return rig;
}

function patchMaterial(mat: THREE.Material, u: LegRig["uniforms"]): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aLeg;
attribute float aLegW;
uniform vec3 uLegOff[6];
varying float vIsLeg;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vIsLeg = 0.0;
if (aLeg > -0.5) {
  transformed += uLegOff[int(aLeg + 0.5)] * aLegW;
  vIsLeg = 1.0;
}`,
      );
    if (shader.fragmentShader.includes("#include <color_fragment>")) {
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uLegTint;\nuniform vec3 uTintColor;\nvarying float vIsLeg;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTintColor, vIsLeg * uLegTint);");
    } else {
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vIsLeg;");
    }
  };
  mat.needsUpdate = true;
}

/** offsets[k] are body-frame (dz forward, dy up) displacements for leg legOrder[k] */
export function setFootOffsets(rig: LegRig, offsets: Record<LegId, { dz: number; dy: number }>): void {
  const v = new THREE.Vector3();
  rig.legOrder.forEach((leg, k) => {
    const o = offsets[leg];
    v.set(0, (o?.dy ?? 0) - rig.plant[k], o?.dz ?? 0).applyMatrix3(rig.toLocal);
    rig.uniforms.uLegOff.value[k].copy(v);
  });
}
