/**
 * Application-defined mapping from simulated MN9 activity to the cartoon's
 * proboscis pose. NOTHING here comes from the paper or the upstream model;
 * every constant is a presentation choice, displayed in the UI.
 *
 *   r(t)   trial-averaged MN9 firing rate in 5 ms bins (Hz)       [model output]
 *   s(t)   causal exponential smoothing, time constant TAU_MS:
 *            s[k] = s[k-1] + (r[k] - s[k-1]) * (1 - exp(-bin/TAU_MS)),  s[-1] = 0
 *   e(t)   extension fraction = clamp((s - R_THRESHOLD) / (R_SATURATION - R_THRESHOLD), 0, 1)
 *
 * The paper states the MN9-rate -> rostrum-lifting relation is unknown and only
 * assumes "increased MN9 firing rates correspond with increased rostrum
 * lifting probability". This monotonic mapping respects that assumption and
 * nothing more.
 */
export const MAPPING = {
  TAU_MS: 50,
  R_THRESHOLD: 5, // Hz: below this the proboscis is drawn fully retracted
  R_SATURATION: 100, // Hz: at/above this fully extended (contralateral MN9 reaches ~93 Hz at 200 Hz sugar input in this model)
} as const;

export function smooth(rate: number[], binMs: number, tauMs: number = MAPPING.TAU_MS): number[] {
  const a = 1 - Math.exp(-binMs / tauMs);
  const out: number[] = new Array(rate.length);
  let s = 0;
  for (let k = 0; k < rate.length; k++) {
    s = s + (rate[k] - s) * a;
    out[k] = s;
  }
  return out;
}

export function extension(smoothedHz: number, lo: number = MAPPING.R_THRESHOLD, hi: number = MAPPING.R_SATURATION): number {
  if (!Number.isFinite(smoothedHz)) return 0;
  return Math.min(1, Math.max(0, (smoothedHz - lo) / (hi - lo)));
}

/** Value of a binned series at simulated time tMs (bin containing t). */
export function sampleAt(series: number[], binMs: number, tMs: number): number {
  if (series.length === 0) return 0;
  const k = Math.min(series.length - 1, Math.max(0, Math.floor(tMs / binMs)));
  return series[k];
}

/**
 * Playback clock: maps wall-clock milliseconds to simulated milliseconds.
 * speed = simulated ms per wall-clock ms (0.25 means 1 s of simulated time is shown over 4 s).
 * Purely a display transform of already-computed results.
 */
export function simTimeAt(wallElapsedMs: number, speed: number, durationMs: number, loop: boolean): number {
  const t = wallElapsedMs * speed;
  if (!loop) return Math.min(t, durationMs);
  return durationMs > 0 ? t % durationMs : 0;
}
