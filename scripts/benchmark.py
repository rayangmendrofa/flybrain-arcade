# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Benchmark both engines on the full v630 model and write docs/benchmark.json.

Each row runs in a fresh subprocess so that peak memory (Windows peak working
set / Linux ru_maxrss) belongs to that row only. Wall-clock excludes Python
start-up but includes network loading / model construction.

Usage: python scripts/benchmark.py [--quick]
"""

import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

ROWS = [
    ("numba-port", 1000, 1, 100.0),
    ("numba-port", 1000, 10, 100.0),
    ("numba-port", 1000, 30, 100.0),
    ("numba-port", 1000, 30, 200.0),
    ("brian2-reference", 1000, 1, 100.0),
]


def peak_mem_bytes() -> int | None:
    import psutil

    m = psutil.Process().memory_info()
    return int(getattr(m, "peak_wset", 0) or 0) or None


def single(engine: str, duration_ms: int, trials: int, rate: float) -> dict:
    from flybrain.experiment import ExperimentConfig
    from flybrain.jobs import run_inline

    if engine == "numba-port":
        from flybrain import engine_fast

        engine_fast.warmup()  # JIT compile (cached on disk) is not part of a run
    cfg = ExperimentConfig(engine=engine, duration_ms=duration_ms, n_trials=trials, seed=1,
                           stimulus={"rate_hz": rate})
    t0 = time.perf_counter()
    out = run_inline(cfg)
    wall = time.perf_counter() - t0
    return {"engine": engine, "duration_ms": duration_ms, "trials": trials, "rate_hz": rate,
            "wall_s": wall, "wall_per_simulated_s": wall / (duration_ms / 1000 * trials),
            "spikes_per_trial": sum(len(x) for x in out["spike_neuron"]) / trials,
            "peak_memory_gb": (peak_mem_bytes() or 0) / 1e9 or None,
            "numba_threads": out["backend"].get("numba_threads")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--single", nargs=4)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    if a.single:
        e, d, t, r = a.single
        print(json.dumps(single(e, int(d), int(t), float(r))))
        return

    from flybrain import network, upstream

    net = network.load_network()
    rows = []
    for e, d, t, r in ROWS[:2] if a.quick else ROWS:
        res = subprocess.run([sys.executable, __file__, "--single", e, str(d), str(t), str(r)],
                             capture_output=True, text=True, check=True)
        row = json.loads(res.stdout.strip().splitlines()[-1])
        print(row)
        rows.append(row)
    import psutil

    cpu = platform.processor()
    out = {
        "measured_at": time.strftime("%Y-%m-%d"),
        "hardware": f"{cpu}; {psutil.cpu_count(logical=True)} logical CPUs; "
                    f"{psutil.virtual_memory().total / 2**30:.1f} GiB RAM; {platform.platform()}; Python {platform.python_version()}",
        "model_size": {"neurons": net.n, "connections": net.n_connections, "synapses": net.n_synapses_abs},
        "dataset": upstream.DATASET_ID,
        "notes": ["Wall-clock includes network loading/model construction, excludes interpreter start-up and Numba JIT.",
                  "brian2-reference uses Brian2's numpy runtime target (no C++ compiler on this machine).",
                  "numba-port runs trials in parallel threads; a single trial uses one thread."],
        "rows": rows,
    }
    (ROOT / "docs" / "benchmark.json").write_text(json.dumps(out, indent=1))
    print("wrote docs/benchmark.json")


if __name__ == "__main__":
    main()
