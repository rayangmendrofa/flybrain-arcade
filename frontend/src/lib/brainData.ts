/**
 * Brain-view data (no three.js here, so the main bundle stays small).
 * Positions: FlyWire v630 anchors matched by exact root ID; visualisation only.
 */

/** Neuron positions (FlyWire v630, matched by exact root ID). Visualisation only. */
export interface BrainAtlas {
  n: number;
  /** display-space xyz per neuron (fly faces +z, +y up, fly's right = -x), NaN = no position */
  pos: Float32Array;
  cls: Uint8Array;
  classNames: string[];
  meta: AtlasMeta;
  /** extent of the display-space cloud, micrometres */
  sizeUm: [number, number, number];
}

export interface AtlasMeta {
  n_neurons: number;
  n_with_position: number;
  n_without_position: number;
  lo_um: number[];
  hi_um: number[];
  class_names: string[];
  source: { repository: string; tag: string; commit: string; file: string; citation: string; licence: string };
  [k: string]: unknown;
}

/** One trial's spikes sorted by time (all neurons). MODEL output. */
export interface BrainActivity {
  run_id?: string;
  trial: number;
  duration_ms: number;
  n_spikes: number;
  neuron: number[] | Int32Array;
  t_ms: number[] | Float32Array;
  roles: { sugar_grns: number[]; mn9: number[]; silenced: number[] };
  schedule: { onset_ms: number; offset_ms: number; rate_hz: number };
}

const MISSING = 65535;

/**
 * FAFB axes (+x fly's right, +y ventral, +z posterior; µm) -> display axes used by the fly
 * model (+z anterior, +y dorsal, fly's right at -x). Centred on the cloud's bounding box.
 */
export function decodeAtlas(buf: ArrayBuffer, meta: AtlasMeta): BrainAtlas {
  const n = meta.n_neurons;
  const q = new Uint16Array(buf, 0, n * 3);
  const cls = new Uint8Array(buf, n * 6, n);
  const lo = meta.lo_um, hi = meta.hi_um;
  const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = q[i * 3 + a];
      pos[i * 3 + a] = v === MISSING ? NaN : -(lo[a] + (v / (MISSING - 1)) * (hi[a] - lo[a]) - c[a]);
    }
  }
  return { n, pos, cls, classNames: meta.class_names, meta, sizeUm: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

export function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Number of spikes in (tMs - windowMs, tMs]. */
export function spikesInWindow(a: BrainActivity, tMs: number, windowMs: number): number {
  return lowerBound(a.t_ms, tMs + 1e-6) - lowerBound(a.t_ms, tMs - windowMs + 1e-6);
}

let atlasCache: { key: string; p: Promise<BrainAtlas> } | null = null;

/** Load (once) and decode the atlas from any source: the live API or the static site's files. */
export function loadAtlas(key: string, meta: () => Promise<AtlasMeta>, bin: () => Promise<ArrayBuffer>): Promise<BrainAtlas> {
  if (atlasCache?.key !== key) {
    const p = Promise.all([meta(), bin()]).then(([m, b]) => decodeAtlas(b, m));
    p.catch(() => { if (atlasCache?.p === p) atlasCache = null; });
    atlasCache = { key, p };
  }
  return atlasCache.p;
}
