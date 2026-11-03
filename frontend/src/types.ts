// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
// Mirrors backend/flybrain/{experiment,runs,api}.py response shapes.

export type Engine = "numba-port" | "brian2-reference" | "synthetic";
export type Mode = "live" | "replay" | "synthetic";

export interface ExperimentConfig {
  engine: Engine;
  duration_ms: number;
  seed: number;
  n_trials: number;
  stimulus: { target: "sugar_grns"; rate_hz: number; onset_ms: number; offset_ms: number | null };
  silenced_ids: string[];
  rate_window_ms: [number, number] | null;
}

export interface NeuronLabel {
  index: number;
  id: string; // FlyWire root ID (string: exceeds 2^53) or SYN-n
  name: string | null;
  cell_type: string | null;
  synthetic: boolean;
  group?: string;
}

export interface RateStats {
  per_trial_counts: number[];
  per_trial_rate_hz: number[];
  mean_count: number;
  mean_rate_hz: number;
  sd_rate_hz: number;
  sem_rate_hz: number | null;
  n_trials: number;
}

export interface Psth {
  bin_ms: number;
  t_ms: number[];
  rate_hz: number[];
}

export interface OutputSummary {
  key: string;
  name: string;
  short: string;
  source: string;
  side_note: string;
  neuron: NeuronLabel;
  stats: RateStats;
  psth: Psth;
}

export interface RunSummary {
  run_id: string;
  kind: "baseline" | "intervention" | "run";
  mode: Mode;
  created: number;
  baseline_run_id: string | null;
  config: ExperimentConfig;
  schedule: { rate_hz: number; onset_ms: number; offset_ms: number; duration_ms: number; target_label: string; mechanism: string };
  rate_window_ms: [number, number];
  rate_definition: string;
  outputs: OutputSummary[];
  stimulated_population: { label: string; stats: RateStats; psth: Psth };
  top_responsive: (NeuronLabel & { mean_rate_hz: number; sd_rate_hz: number; baseline_rate_hz: number | null; silenced: boolean })[];
  silenced: NeuronLabel[];
  raster_rows: NeuronLabel[];
  network: { n_neurons: number; n_active_neurons: number; total_spikes_per_trial_mean: number };
  timing: { wall_s: number; simulated_s: number; simulated_s_per_trial: number; wall_per_simulated_s: number };
  backend: Record<string, unknown>;
  dt_ms: number;
  n_steps: number;
}

export interface Raster {
  trial: number;
  n_trials: number;
  rows: NeuronLabel[];
  spikes: [number, number][]; // [row, time_ms]
  duration_ms: number;
}

export interface OutputComparison {
  key: string;
  name: string;
  short: string;
  neuron: NeuronLabel;
  baseline_mean_rate_hz: number;
  intervention_mean_rate_hz: number;
  baseline_mean_count: number;
  intervention_mean_count: number;
  baseline_sd_hz: number;
  intervention_sd_hz: number;
  delta_rate_hz: number;
  delta_percent: number | null;
  paired_delta_sd_hz: number;
  paired_delta_sem_hz: number | null;
  per_trial_delta_hz: number[];
  per_trial_baseline_hz: number[];
  per_trial_intervention_hz: number[];
  n_trials: number;
  trials_decreased: number;
  trials_increased: number;
}

export interface Comparison {
  baseline_run_id: string;
  intervention_run_id: string;
  silenced: NeuronLabel[];
  rate_window_ms: [number, number];
  pairing: string;
  outputs: OutputComparison[];
  most_changed: (NeuronLabel & { baseline_rate_hz: number; intervention_rate_hz: number; delta_hz: number })[];
  interpretation: string;
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  created: number;
  started: number | null;
  finished: number | null;
  error: string | null;
  run_id: string | null;
  engine: Engine;
  queue_position?: number;
}

export interface NeuronGroup {
  key: string;
  label: string;
  ids: string[];
  source: string;
  paper_context: string;
}

export interface Status {
  upstream: { available: boolean; directory: string; commit: string | null; commit_matches: boolean; problems: string[]; files: Record<string, { present: boolean; sha256?: string; matches?: boolean; bytes?: number }> };
  engines: Record<Engine, { available: boolean; max_trials: number; max_duration_ms: number; label: string }>;
  bounds: { rate_hz: [number, number]; duration_ms: [number, number] };
  provenance: {
    model: { name: string; repository: string; commit_expected: string; commit_found: string | null; commit_date: string; licence: string; paper: string; paper_licence: string };
    dataset: { id: string; label: string; files: Record<string, { name: string; sha256: string }>; neuron_id_system: string };
  };
  params: Record<string, number | string> | null;
  feeding_output: string;
  outputs: { id: string; name: string; short: string; source: string; side_note: string }[];
  sugar_grns: { ids: string[]; source: string };
  benchmark: Benchmark | null;
  worker: { ready: boolean; numba_threads?: number; warmup_s?: number; warmup_error?: string | null };
  server: { python: string; cpu: string; os: string };
}

export interface Benchmark {
  measured_at: string;
  hardware: string;
  rows: { engine: string; duration_ms: number; trials: number; rate_hz: number; wall_s: number; wall_per_simulated_s: number; peak_memory_gb: number | null; note?: string }[];
  model_size: { neurons: number; connections: number; synapses: number };
}

export interface ReplayMeta {
  name: string;
  title: string;
  description: string;
  computed_at: string;
  engine: Engine;
}
