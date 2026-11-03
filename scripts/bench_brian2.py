# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
# This script benchmarks the unmodified upstream model.
"""Benchmark the unmodified upstream Brian2 model (NumPy runtime target).

Usage: python scripts/bench_brian2.py --duration-ms 100 --rate 100 --seed 1 --out data/cache/bench_brian2.json
"""

import argparse
import json
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import numpy as np  # noqa: E402
import psutil  # noqa: E402

from flybrain import neurons, upstream  # noqa: E402
from flybrain.engine_brian2 import run_reference_trial  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration-ms", type=float, default=100)
    ap.add_argument("--rate", type=float, default=100)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()

    cat = neurons.catalog()
    stim = [cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM]
    t0 = time.perf_counter()
    res = run_reference_trial(stim, a.rate, [], a.duration_ms / 1000, a.seed)
    wall = time.perf_counter() - t0
    proc = psutil.Process()
    mem = proc.memory_info()
    peak = getattr(mem, "peak_wset", None) or getattr(mem, "rss", None)
    mn9 = cat.index_of(neurons.MN9_CONTRA)
    out = {
        "engine": "brian2-reference",
        "brian2": res.brian2_version,
        "codegen_target": res.codegen_target,
        "duration_ms": a.duration_ms,
        "rate_hz": a.rate,
        "seed": a.seed,
        "n_neurons": cat.n,
        "wall_s_total": wall,
        "timings": res.timings,
        "n_spikes": int(len(res.spike_neuron)),
        "mn9_contra_spikes": int(np.sum(res.spike_neuron == mn9)),
        "peak_memory_bytes": peak,
        "cpu": platform.processor(),
        "python": sys.version.split()[0],
    }
    print(json.dumps(out, indent=1))
    if a.out:
        a.out.write_text(json.dumps(out, indent=1))
        np.savez_compressed(a.out.with_suffix(".npz"), i=res.spike_neuron, s=res.spike_step)


if __name__ == "__main__":
    main()
