# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Spike counts, firing rates and baseline-vs-intervention comparisons.

Rate definition (matches upstream ``utils.get_rate`` when the window is the
whole trial): rate_k = (spikes of the neuron in window during trial k) /
window length in seconds; reported mean and SD are across trials, with SD
computed as ``numpy.std`` (ddof=0) like upstream, plus the SEM (ddof=1).
"""

from __future__ import annotations

import math

import numpy as np


def window_steps(window_ms: tuple[float, float], dt: float) -> tuple[int, int]:
    a = int(round(window_ms[0] / 1000 / dt))
    b = int(round(window_ms[1] / 1000 / dt))
    return a, b


def counts_in_window(spike_neuron: list[np.ndarray], spike_step: list[np.ndarray], n: int,
                     step_range: tuple[int, int]) -> np.ndarray:
    """(n_trials, n) spike counts with step in [a, b)."""
    a, b = step_range
    out = np.zeros((len(spike_neuron), n), dtype=np.int32)
    for k, (ni, st) in enumerate(zip(spike_neuron, spike_step)):
        m = (st >= a) & (st < b)
        out[k] = np.bincount(ni[m], minlength=n)
    return out


def rate_stats(counts: np.ndarray, window_s: float) -> dict:
    """counts: per-trial spike counts for one neuron or population (1-D)."""
    r = counts.astype(float) / window_s
    n = len(r)
    return {
        "per_trial_counts": counts.astype(int).tolist(),
        "per_trial_rate_hz": r.tolist(),
        "mean_count": float(counts.mean()),
        "mean_rate_hz": float(r.mean()),
        "sd_rate_hz": float(r.std()),  # ddof=0, as upstream get_rate
        "sem_rate_hz": float(r.std(ddof=1) / math.sqrt(n)) if n > 1 else None,
        "n_trials": n,
    }


def psth(spike_neuron, spike_step, neurons_idx, n_steps: int, dt: float, bin_ms: float) -> dict:
    """Trial-averaged population rate (Hz per neuron) in bins of ``bin_ms``."""
    bin_steps = max(1, int(round(bin_ms / 1000 / dt)))
    n_bins = int(math.ceil(n_steps / bin_steps))
    sel = np.zeros(int(max(max(neurons_idx, default=0) + 1, 1)), dtype=bool)
    sel[list(neurons_idx)] = True
    acc = np.zeros(n_bins)
    for ni, st in zip(spike_neuron, spike_step):
        m = ni < len(sel)
        m[m] = sel[ni[m]]
        acc += np.bincount(st[m] // bin_steps, minlength=n_bins)[:n_bins]
    k = max(1, len(spike_neuron))
    rate = acc / k / max(1, len(neurons_idx)) / (bin_steps * dt)
    return {"bin_ms": bin_steps * dt * 1000, "t_ms": (np.arange(n_bins) * bin_steps * dt * 1000).tolist(),
            "rate_hz": rate.tolist()}


def compare_stats(base_counts: np.ndarray, int_counts: np.ndarray, window_s: float) -> dict:
    """Paired comparison: trial k of both runs used the same seed sequence [seed, k]."""
    b = base_counts.astype(float) / window_s
    i = int_counts.astype(float) / window_s
    d = i - b
    n = len(d)
    rel = (i.mean() - b.mean()) / b.mean() * 100 if b.mean() > 0 else None
    return {
        "baseline_mean_rate_hz": float(b.mean()),
        "intervention_mean_rate_hz": float(i.mean()),
        "baseline_mean_count": float(base_counts.mean()),
        "intervention_mean_count": float(int_counts.mean()),
        "baseline_sd_hz": float(b.std()),
        "intervention_sd_hz": float(i.std()),
        "delta_rate_hz": float(i.mean() - b.mean()),
        "delta_percent": None if rel is None else float(rel),
        "paired_delta_sd_hz": float(d.std()),
        "paired_delta_sem_hz": float(d.std(ddof=1) / math.sqrt(n)) if n > 1 else None,
        "per_trial_delta_hz": d.tolist(),
        "per_trial_baseline_hz": b.tolist(),
        "per_trial_intervention_hz": i.tolist(),
        "n_trials": n,
        "trials_decreased": int((d < 0).sum()),
        "trials_increased": int((d > 0).sum()),
    }
