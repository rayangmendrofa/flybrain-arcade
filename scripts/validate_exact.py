# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
# This script compares the fast engine against the unmodified upstream model.
"""Exact comparison: upstream Brian2 model vs fast engine with identical input events.

Pre-draws Poisson events for the 21 sugar GRNs, injects the same events into
(a) upstream Brian2 (create_model/silence unmodified; events delivered to v
with PoissonInput's weight and scheduling slot) and (b) the Numba port, then
compares the full spike trains of all 127,400 neurons.

Usage: python scripts/validate_exact.py --duration-ms 200 --rate 100 --seed 3 [--silence-top 1]
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import numpy as np  # noqa: E402

from flybrain import engine_fast as ef, network, neurons, upstream  # noqa: E402
from flybrain.engine_brian2 import run_reference_trial  # noqa: E402


def compare(a_i, a_s, b_i, b_s) -> dict:
    a = set(zip(a_s.tolist(), a_i.tolist()))
    b = set(zip(b_s.tolist(), b_i.tolist()))
    first_diff = min((a ^ b), default=None)
    return {
        "brian2_spikes": len(a), "port_spikes": len(b), "common": len(a & b),
        "only_brian2": len(a - b), "only_port": len(b - a),
        "identical": a == b,
        "first_difference_step_neuron": first_diff,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration-ms", type=float, default=200)
    ap.add_argument("--rate", type=float, default=100)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--silence", type=int, nargs="*", default=[], help="FlyWire IDs to silence")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()

    p = upstream.upstream_params()
    cat = neurons.catalog()
    stim = tuple(cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM)
    slnc = [cat.index_of(i) for i in a.silence]
    dur = a.duration_ms / 1000
    n_steps = upstream.brian2_timestep(dur, p.dt)
    targets, events = ef.draw_poisson_events(a.seed, 0, n_steps, [ef.StimGroup(stim, a.rate, 0.0, dur)], p.dt)
    inj = {int(t): np.nonzero(events[:, c])[0] for c, t in enumerate(targets)}

    t0 = time.perf_counter()
    ref = run_reference_trial(list(stim), a.rate, slnc, dur, a.seed, injected_events=inj)
    t_ref = time.perf_counter() - t0
    net = network.load_network()
    t0 = time.perf_counter()
    port = ef.run_trials(net, p, [], slnc, dur, a.seed, 1, injected_events=[(targets, events)])
    t_port = time.perf_counter() - t0

    res = compare(ref.spike_neuron, ref.spike_step, port.spike_neuron[0].astype(np.int64), port.spike_step[0].astype(np.int64))
    res.update({
        "duration_ms": a.duration_ms, "rate_hz": a.rate, "seed": a.seed, "silenced": a.silence,
        "n_input_events": int(events.sum()),
        "wall_brian2_s": t_ref, "wall_port_s": t_port, "brian2_version": ref.brian2_version,
    })
    print(json.dumps(res, indent=1, default=str))
    if a.out:
        a.out.write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
