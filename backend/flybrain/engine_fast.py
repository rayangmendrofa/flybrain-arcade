"""Fast engine: a Numba port of the upstream Brian2 model's per-step update.

It reproduces, step for step, what Brian2 2.10 executes for upstream
``model.py`` with the default schedule (groups -> thresholds -> synapses -> resets):

1. groups:     not_refractory = (n - lastspike) >= timestep(rfc)
               if not_refractory:  g <- c2*g ;  v <- c8 + ((c9*g_old) + (c10*v))
               (constants and operation order copied from Brian2's 'linear'
               state updater output for the upstream equations)
2. thresholds: spike if v > v_th and not_refractory; lastspike <- n
3. synapses:   spikes emitted at step n - D (D = round(t_dly/dt)) add w to g of
               their targets (silenced presynaptic neurons contribute nothing,
               equivalent to upstream ``silence()`` setting their weights to 0);
               Poisson events at step n add w_syn*f_poi to v (upstream PoissonInput).
               Both writes are skipped for neurons that are refractory or spiked
               this step: Brian2 makes '(unless refractory)' variables
               conditional-write on ``not_refractory``.
4. resets:     spiking neurons: v <- v_rst, g <- 0

Poisson events are pre-drawn per (seed, trial) with NumPy's PCG64 so that a
baseline and an intervention with the same seed receive identical input, and
results do not depend on thread scheduling or chunking.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from numba import njit, prange

from .network import Network
from .upstream import ModelParams, brian2_timestep

ENGINE_NAME = "numba-port"


@dataclass(frozen=True)
class StimGroup:
    indices: tuple[int, ...]
    rate_hz: float
    onset_s: float
    offset_s: float


@dataclass
class TrialsResult:
    spike_neuron: list[np.ndarray]  # per trial, int32 neuron indices (ordered by step, then index)
    spike_step: list[np.ndarray]  # per trial, int32 steps
    n_steps: int
    dt: float
    wall_s: float
    timings: dict = field(default_factory=dict)


class Cancelled(Exception):
    pass


def brian2_linear_constants(p: ModelParams) -> tuple[float, float, float, float]:
    """Constants exactly as Brian2's generated code computes them (numpy float64 ops)."""
    exp = np.exp
    dt, tau, t_mbr, v_0 = np.float64(p.dt), np.float64(p.tau), np.float64(p.t_mbr), np.float64(p.v_0)
    lio_1 = (-dt) / tau
    lio_2 = exp(lio_1)
    lio_3 = tau / (t_mbr - tau)
    lio_4 = dt / t_mbr
    lio_5 = dt / tau
    lio_6 = (-dt) / t_mbr
    lio_8 = v_0 - (v_0 * exp(lio_6))
    lio_9 = ((lio_3 * ((-exp(lio_4)) + exp(lio_5))) * exp(lio_6)) * exp(lio_1)
    lio_10 = exp(lio_6)
    return float(lio_2), float(lio_8), float(lio_9), float(lio_10)


def trial_rng(seed: int, trial: int) -> np.random.Generator:
    return np.random.Generator(np.random.PCG64(np.random.SeedSequence([int(seed), int(trial)])))


def draw_poisson_events(seed: int, trial: int, n_steps: int, groups: list[StimGroup], dt: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (targets, events[n_steps, n_targets] uint8) for one trial.

    Each target gets an independent Bernoulli(rate*dt) draw per step inside
    [onset, offset), i.e. Brian2's binomial(N=1, p=rate*dt) PoissonInput.
    """
    targets = [i for g in groups for i in g.indices]
    rng = trial_rng(seed, trial)
    u = rng.random((n_steps, len(targets)))
    events = np.zeros((n_steps, len(targets)), dtype=np.uint8)
    col = 0
    for g in groups:
        p = g.rate_hz * dt
        on = brian2_timestep(g.onset_s, dt)
        off = min(brian2_timestep(g.offset_s, dt), n_steps)
        k = len(g.indices)
        if p > 0 and off > on:
            events[on:off, col:col + k] = u[on:off, col:col + k] < p
        col += k
    return np.asarray(targets, dtype=np.int32), events


@njit(cache=True, nogil=True)
def _advance_trial(n0, n1, v, g, lastspike, ref_steps, indptr, indices, weights, silenced,
                   targets, events, ev_offset, kick, c2, c8, c9, c10, v_th, v_rst, delay,
                   spk_buf, out_i, out_s, step_start, out_n):
    """Advance one trial from step n0 to n1. Returns updated out_n, or -1 on buffer overflow."""
    N = v.shape[0]
    cap = out_i.shape[0]
    for n in range(n0, n1):
        # groups + thresholds (per-neuron, so they can share one pass)
        ns = 0
        for i in range(N):
            if n - lastspike[i] >= ref_steps[i]:
                gi = g[i]
                vi = c8 + ((c9 * gi) + (c10 * v[i]))
                g[i] = c2 * gi
                v[i] = vi
                if vi > v_th:
                    spk_buf[ns] = i
                    ns += 1
                    lastspike[i] = n
        if out_n + ns > cap:
            return -1
        step_start[n] = out_n
        for s in range(ns):
            out_i[out_n] = spk_buf[s]
            out_s[out_n] = n
            out_n += 1
        step_start[n + 1] = out_n
        # synapses: deliver spikes emitted at step n - delay. Brian2 marks v and g
        # '(unless refractory)' as conditional-write variables, so writes to a
        # neuron that is refractory (or spiked this step) are discarded.
        m = n - delay
        if m >= 0:
            for q in range(step_start[m], step_start[m + 1]):
                j = out_i[q]
                if silenced[j]:
                    continue
                for p in range(indptr[j], indptr[j + 1]):
                    post = indices[p]
                    last = lastspike[post]
                    if last != n and n - last >= ref_steps[post]:
                        g[post] += weights[p]
        # PoissonInput: v += binomial(1, rate*dt) * w_syn*f_poi (same conditional write)
        row = n - ev_offset
        for t in range(targets.shape[0]):
            if events[row, t]:
                i = targets[t]
                last = lastspike[i]
                if last != n and n - last >= ref_steps[i]:
                    v[i] += kick
        # resets
        for s in range(ns):
            i = spk_buf[s]
            v[i] = v_rst
            g[i] = 0.0
    return out_n


@njit(parallel=True, cache=True)
def _advance_all(n0, n1, V, G, LAST, ref_steps, indptr, indices, weights, silenced,
                 targets, EVENTS, ev_offset, kick, c2, c8, c9, c10, v_th, v_rst, delay,
                 SPK, OUT_I, OUT_S, STEP_START, OUT_N):
    K = V.shape[0]
    for k in prange(K):
        if OUT_N[k] < 0:
            continue
        OUT_N[k] = _advance_trial(n0, n1, V[k], G[k], LAST[k], ref_steps, indptr, indices, weights,
                                  silenced, targets, EVENTS[k], ev_offset, kick, c2, c8, c9, c10,
                                  v_th, v_rst, delay, SPK[k], OUT_I[k], OUT_S[k], STEP_START[k], OUT_N[k])


def run_trials(
    net: Network,
    p: ModelParams,
    groups: list[StimGroup],
    silenced_idx: list[int],
    duration_s: float,
    seed: int,
    n_trials: int,
    chunk_steps: int = 500,
    progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    injected_events: list[tuple[np.ndarray, np.ndarray]] | None = None,
    max_spikes_per_trial: int | None = None,
) -> TrialsResult:
    """Run ``n_trials`` independent trials (trial r uses seed sequence [seed, r]).

    Every trial starts from the upstream initial state (v = v_0, g = 0, never spiked).
    """
    t_start = time.perf_counter()
    dt = p.dt
    n_steps = brian2_timestep(duration_s, dt)
    N = net.n
    delay = int(round(p.t_dly / dt))
    if delay < 1:
        raise ValueError("Synaptic delay must be at least one time step")
    c2, c8, c9, c10 = brian2_linear_constants(p)
    kick = p.w_syn * p.f_poi

    ref_default = brian2_timestep(p.t_rfc, dt)
    ref_steps = np.full(N, ref_default, dtype=np.int64)
    if injected_events is None:
        tg_list, ev_list = zip(*[draw_poisson_events(seed, r, n_steps, groups, dt) for r in range(n_trials)])
        targets = tg_list[0]
        EVENTS = np.stack(ev_list)
    else:
        targets = injected_events[0][0]
        EVENTS = np.stack([e for _, e in injected_events])
    ref_steps[targets] = 0  # upstream poi(): "no refractory period for Poisson targets"
    if EVENTS.shape[2] == 0:
        EVENTS = np.zeros((n_trials, n_steps, 1), dtype=np.uint8)
        targets = np.zeros(1, dtype=np.int32)

    silenced = np.zeros(N, dtype=np.bool_)
    silenced[np.asarray(silenced_idx, dtype=np.int64)] = True

    K = n_trials
    V = np.full((K, N), p.v_0, dtype=np.float64)
    G = np.zeros((K, N), dtype=np.float64)
    LAST = np.full((K, N), -(10**12), dtype=np.int64)
    cap = max_spikes_per_trial or max(100_000, 400 * n_steps)
    SPK = np.zeros((K, N), dtype=np.int32)
    OUT_I = np.zeros((K, cap), dtype=np.int32)
    OUT_S = np.zeros((K, cap), dtype=np.int32)
    STEP_START = np.zeros((K, n_steps + 1), dtype=np.int64)
    OUT_N = np.zeros(K, dtype=np.int64)

    t_setup = time.perf_counter() - t_start
    n = 0
    while n < n_steps:
        if should_cancel is not None and should_cancel():
            raise Cancelled()
        n1 = min(n + chunk_steps, n_steps)
        _advance_all(n, n1, V, G, LAST, ref_steps, net.indptr, net.indices, net.weights, silenced,
                     targets, EVENTS, 0, kick, c2, c8, c9, c10, p.v_th, p.v_rst, delay,
                     SPK, OUT_I, OUT_S, STEP_START, OUT_N)
        if np.any(OUT_N < 0):
            raise RuntimeError(f"Spike buffer overflow (> {cap} spikes in a trial); refusing to truncate results.")
        n = n1
        if progress is not None:
            progress(n / n_steps)

    spike_neuron = [OUT_I[k, : OUT_N[k]].copy() for k in range(K)]
    spike_step = [OUT_S[k, : OUT_N[k]].copy() for k in range(K)]
    wall = time.perf_counter() - t_start
    return TrialsResult(spike_neuron, spike_step, n_steps, dt, wall,
                        timings={"setup_s": t_setup, "integrate_s": wall - t_setup})


class NeuralSession:
    """One continuous trial advanced in chunks, with input rate changed between chunks.

    Used by the closed-loop arena. State (v, g, refractory clocks and spikes
    still in flight on delayed synapses) carries over between chunks, so a
    session advanced in chunks is identical to one uninterrupted run receiving
    the same input events (tested).
    """

    def __init__(self, net: Network, p: ModelParams, targets: list[int], silenced_idx: list[int], seed: int):
        self.net, self.p = net, p
        self.dt = p.dt
        self.delay = int(round(p.t_dly / p.dt))
        self.c = brian2_linear_constants(p)
        self.kick = p.w_syn * p.f_poi
        N = net.n
        self.targets = np.asarray(targets, dtype=np.int32)
        self.ref_steps = np.full(N, brian2_timestep(p.t_rfc, p.dt), dtype=np.int64)
        self.ref_steps[self.targets] = 0
        self.silenced = np.zeros(N, dtype=np.bool_)
        self.silenced[np.asarray(silenced_idx, dtype=np.int64)] = True
        self.v = np.full(N, p.v_0)
        self.g = np.zeros(N)
        self.last = np.full(N, -(10**12), dtype=np.int64)
        self.spk_buf = np.zeros(N, dtype=np.int32)
        self.rng = trial_rng(seed, 0)
        self.steps_done = 0
        self._carry_i = np.zeros(0, dtype=np.int32)
        self._carry_s = np.zeros(0, dtype=np.int32)
        self._carry_start = np.zeros(self.delay + 1, dtype=np.int64)

    def draw_events(self, n_steps: int, rate_hz: float) -> np.ndarray:
        u = self.rng.random((n_steps, len(self.targets)))
        return (u < rate_hz * self.dt).astype(np.uint8)

    def advance(self, n_steps: int, rate_hz: float = 0.0, events: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Advance ``n_steps``; returns (neuron indices, global steps) of spikes in this chunk."""
        D, p = self.delay, self.p
        if events is None:
            events = self.draw_events(n_steps, rate_hz)
        L = D + n_steps
        k = len(self._carry_i)
        cap = k + max(100_000, 400 * n_steps)
        out_i = np.zeros(cap, dtype=np.int32)
        out_s = np.zeros(cap, dtype=np.int32)
        step_start = np.zeros(L + 1, dtype=np.int64)
        out_i[:k], out_s[:k] = self._carry_i, self._carry_s
        step_start[: D + 1] = self._carry_start
        c2, c8, c9, c10 = self.c
        n_out = _advance_trial(D, L, self.v, self.g, self.last, self.ref_steps, self.net.indptr, self.net.indices,
                               self.net.weights, self.silenced, self.targets, events, D, self.kick, c2, c8, c9, c10,
                               p.v_th, p.v_rst, D, self.spk_buf, out_i, out_s, step_start, k)
        if n_out < 0:
            raise RuntimeError("Spike buffer overflow in neural session")
        new_i = out_i[k:n_out].copy()
        new_s = out_s[k:n_out].astype(np.int64) - D + self.steps_done
        # keep spikes from the last D steps (still travelling along delayed synapses)
        a = step_start[L - D]
        self._carry_i = out_i[a:n_out].copy()
        self._carry_s = out_s[a:n_out] - n_steps
        self._carry_start = step_start[L - D: L + 1] - a  # offsets for local steps 0..D of the next chunk
        self.last -= n_steps  # re-base refractory clocks to the next chunk's local numbering
        self.steps_done += n_steps
        return new_i, new_s


def warmup() -> None:
    """Trigger Numba compilation (cached on disk afterwards) on a tiny network."""
    from .synthetic import synthetic_network, synthetic_params

    run_trials(synthetic_network(n=40, seed=0), synthetic_params(), [StimGroup((0,), 100.0, 0.0, 0.01)], [], 0.01, 0, 2)
