// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { loadAtlas, type AtlasMeta, type BrainActivity, type BrainAtlas } from "../lib/brainData";
import { extension, sampleAt, smooth } from "../lib/mapping";
import type { ArenaEpisode } from "../three/arenaWorld";

/** Static files written by scripts/export_site_data.py into site/public/data. */
const base = `${import.meta.env.BASE_URL}data/`;

export interface SiteRun {
  label: string;
  kind: "baseline" | "intervention";
  mode: "replay";
  config: { duration_ms: number; seed: number; n_trials: number; stimulus: { rate_hz: number }; silenced_ids: string[] };
  schedule: { rate_hz: number; onset_ms: number; offset_ms: number; duration_ms: number; target_label: string };
  silenced: { id: string; name: string | null; cell_type: string | null }[] | null;
  mn9: {
    name: string;
    stats: { mean_rate_hz: number; sd_rate_hz: number; n_trials: number };
    psth: { bin_ms: number; t_ms: number[]; rate_hz: number[] };
  };
  activity: BrainActivity;
  timing: { wall_s: number; simulated_s: number };
}

export interface OutputComparison {
  key: string;
  name: string;
  baseline_mean_rate_hz: number;
  intervention_mean_rate_hz: number;
  delta_rate_hz: number;
  delta_percent: number;
  per_trial_baseline_hz: number[];
  per_trial_intervention_hz: number[];
  trials_decreased: number;
  trials_increased: number;
  n_trials: number;
}

export interface SiteComparison {
  silenced: { id: string; name: string | null; cell_type: string | null }[];
  outputs: OutputComparison[];
  interpretation: string;
}

export interface Manifest {
  generated: string;
  project_commit: string | null;
  what: string;
  model: { citation: string; repository: string; commit: string; licence: string };
  dataset: { id: string; label: string };
  positions: { repository: string; tag: string; commit: string; citation: string; licence: string; n_with_position: number; n_neurons: number };
  replay: { name: string; title: string; description: string; computed_at: string; engine: string };
  arena: { files: string[]; label: string };
  fly_model: { source_file: string; output_bytes: number; tool: string; note: string };
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export const siteData = {
  manifest: () => json<Manifest>("manifest.json"),
  run: (kind: "baseline" | "intervention") => json<SiteRun>(`runs/${kind}.json`),
  comparison: () => json<SiteComparison>("comparison.json"),
  arena: (name: string) => json<ArenaEpisode>(`arena/${name}.json`),
  atlas: (): Promise<BrainAtlas> =>
    loadAtlas(
      "static",
      () => json<AtlasMeta>("atlas.json"),
      async () => {
        const r = await fetch(base + "atlas.bin");
        if (!r.ok) throw new Error(`atlas.bin: ${r.status}`);
        return r.arrayBuffer();
      },
    ),
};

/** MN9-driven quantities at simulated time tMs, using the app's documented mapping (lib/mapping.ts). */
export function mn9At(run: SiteRun, tMs: number) {
  const ps = run.mn9.psth;
  const sm = smoothCache(run);
  const s = sampleAt(sm, ps.bin_ms, tMs);
  return { raw: sampleAt(ps.rate_hz, ps.bin_ms, tMs), smoothed: s, extension: extension(s) };
}

const cache = new WeakMap<SiteRun, number[]>();
function smoothCache(run: SiteRun): number[] {
  let s = cache.get(run);
  if (!s) {
    s = smooth(run.mn9.psth.rate_hz, run.mn9.psth.bin_ms);
    cache.set(run, s);
  }
  return s;
}

export function smoothedSeries(run: SiteRun): number[] {
  return smoothCache(run);
}
