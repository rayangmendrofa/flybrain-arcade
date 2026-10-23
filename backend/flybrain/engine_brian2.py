"""Reference engine: runs the unmodified upstream Brian2 model.

Uses ``create_model``, ``poi`` and ``silence`` from upstream ``model.py``
exactly as ``model.run_trial`` does, adding only:
- ``brian2.seed`` so a trial is reproducible,
- an optional *injected-events* stimulus used for validation: identical,
  pre-drawn Poisson event steps are delivered to ``v`` with the same weight,
  time step and scheduling slot as ``PoissonInput``, so the fast engine can be
  compared spike-for-spike against Brian2.

Without a C++ compiler Brian2 uses its NumPy runtime target, which is slow
(see docs/performance.md). This engine is used for validation and is
available in the app for short runs only.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from . import upstream


@dataclass
class ReferenceResult:
    spike_neuron: np.ndarray  # int64 neuron indices
    spike_step: np.ndarray  # int64 time steps (t = step * dt)
    n_steps: int
    dt: float
    timings: dict = field(default_factory=dict)
    brian2_version: str = ""
    codegen_target: str = ""


def _brian2():
    import brian2

    # No C++ compiler is assumed; select the NumPy runtime explicitly so that
    # Brian2 does not attempt (and fail) Cython compilation.
    brian2.prefs.codegen.target = "numpy"
    return brian2


def run_reference_trial(
    stim_idx: list[int],
    rate_hz: float,
    silence_idx: list[int],
    duration_s: float,
    seed: int,
    injected_events: dict[int, np.ndarray] | None = None,
) -> ReferenceResult:
    """Run one trial of the upstream model.

    stim_idx: neuron indices (upstream "Brian IDs") receiving Poisson input at ``rate_hz``.
    injected_events: optional {neuron_index: array of steps}; replaces PoissonInput
        with deterministic events at those steps (validation only).
    """
    b2 = _brian2()
    mod = upstream.import_upstream_model()
    params = dict(mod.default_params)
    params["t_run"] = duration_s * b2.second
    params["r_poi"] = rate_hz * b2.Hz
    path_comp, path_con = upstream.dataset_paths()

    b2.start_scope()
    b2.seed(seed)
    t0 = time.perf_counter()
    neu, syn, spk_mon = mod.create_model(str(path_comp), str(path_con), params)
    t_build = time.perf_counter() - t0

    extra = []
    if injected_events is None:
        poi_inp, neu = mod.poi(neu, stim_idx, [], params)
        extra.extend(poi_inp)
    else:
        dt = float(b2.defaultclock.dt)
        idx, steps = [], []
        for k, (i, ev) in enumerate(sorted(injected_events.items())):
            idx.append(np.full(len(ev), k))
            steps.append(np.asarray(ev))
            neu[i].rfc = 0 * b2.ms  # same side effect as upstream poi()
        idx = np.concatenate(idx) if idx else np.array([], int)
        steps = np.concatenate(steps) if steps else np.array([], int)
        targets = sorted(injected_events)
        gen = b2.SpikeGeneratorGroup(len(targets), idx, steps * dt * b2.second, name="injected_poisson")
        # PoissonInput runs in the 'synapses' slot and adds weight to v at step n;
        # a zero-delay synapse from a SpikeGeneratorGroup firing at step n does the same.
        inj = b2.Synapses(gen, neu, on_pre="v += w_syn*f_poi", delay=0 * b2.ms,
                          namespace={"w_syn": params["w_syn"], "f_poi": params["f_poi"]},
                          name="injected_synapses")
        inj.connect(i=np.arange(len(targets)), j=np.array(targets))
        extra.extend([gen, inj])

    syn = mod.silence(silence_idx, syn)
    net = b2.Network(neu, syn, spk_mon, *extra)
    t1 = time.perf_counter()
    net.run(duration=params["t_run"])
    t_run = time.perf_counter() - t1

    dt = float(b2.defaultclock.dt)
    steps = np.rint(np.asarray(spk_mon.t) / dt).astype(np.int64)
    return ReferenceResult(
        spike_neuron=np.asarray(spk_mon.i, dtype=np.int64),
        spike_step=steps,
        n_steps=int(round(duration_s / dt)),
        dt=dt,
        timings={"build_s": t_build, "run_s": t_run},
        brian2_version=b2.__version__,
        codegen_target="numpy",
    )
