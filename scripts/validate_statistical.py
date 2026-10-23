"""Statistical comparison: fast engine vs upstream's own published example outputs.

Upstream ships results/example/sugarR.parquet (sugar GRNs, 200 Hz; the notebook
text says "By default, the neurons are excited at 200 Hz" and the GRN rates
confirm it) and sugarR_100Hz.parquet (100 Hz), each 30 trials x 1000 ms, made
with Brian2 2.5.1 on FlyWire v630. Random streams differ, so we compare
distributions with pre-declared tolerances:

  T1  MN9 (both) mean rate: |z| < 3, z = diff / sqrt(sd1^2/n1 + sd2^2/n2)
  T2  total spikes per trial: |z| < 3
  T3  Pearson r of per-neuron mean rates over neurons active in either run > 0.99
  T4  set of neurons with mean rate >= 1 Hz: Jaccard index > 0.9

Usage: python scripts/validate_statistical.py --trials 30 --out docs/validation/statistical.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from flybrain import engine_fast as ef, network, neurons, upstream  # noqa: E402

CASES = {"sugarR_100Hz": 100.0, "sugarR": 200.0}


def per_trial_counts(neuron_lists, n, n_trials) -> np.ndarray:
    out = np.zeros((n_trials, n), dtype=np.int32)
    for k, arr in enumerate(neuron_lists):
        out[k] = np.bincount(arr, minlength=n)
    return out


def zscore(a: np.ndarray, b: np.ndarray) -> float:
    se = np.sqrt(a.var() / len(a) + b.var() / len(b))
    return float((a.mean() - b.mean()) / se) if se > 0 else (0.0 if a.mean() == b.mean() else float("inf"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=30)
    ap.add_argument("--seed", type=int, default=2024)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()

    p = upstream.upstream_params()
    net = network.load_network()
    cat = neurons.catalog()
    stim = tuple(cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM)
    report = {"seed": a.seed, "trials": a.trials, "engine": ef.ENGINE_NAME, "cases": {}}
    for name, rate in CASES.items():
        ref = pd.read_parquet(upstream.upstream_dir() / "results" / "example" / f"{name}.parquet")
        ref_idx = np.array([cat.index_of(f) for f in ref["flywire_id"].to_numpy()])
        n_ref_trials = int(ref["trial"].nunique())
        ref_counts = per_trial_counts([ref_idx[ref["trial"].to_numpy() == k] for k in range(n_ref_trials)], cat.n, n_ref_trials)

        t0 = time.perf_counter()
        res = ef.run_trials(net, p, [ef.StimGroup(stim, rate, 0.0, 1.0)], [], 1.0, a.seed, a.trials)
        wall = time.perf_counter() - t0
        counts = per_trial_counts(res.spike_neuron, cat.n, a.trials)

        case = {"rate_hz": rate, "wall_s": wall, "ref_trials": n_ref_trials}
        for label, fid in (("mn9_contra", neurons.MN9_CONTRA), ("mn9_other", neurons.MN9_OTHER)):
            i = cat.index_of(fid)
            x, y = counts[:, i].astype(float), ref_counts[:, i].astype(float)
            case[label] = {"port_mean_hz": x.mean(), "port_sd": x.std(), "upstream_mean_hz": y.mean(),
                           "upstream_sd": y.std(), "z": zscore(x, y), "pass_T1": abs(zscore(x, y)) < 3}
        tot, tot_ref = counts.sum(1).astype(float), ref_counts.sum(1).astype(float)
        case["total_spikes_per_trial"] = {"port_mean": tot.mean(), "upstream_mean": tot_ref.mean(),
                                          "z": zscore(tot, tot_ref), "pass_T2": abs(zscore(tot, tot_ref)) < 3}
        m, mr = counts.mean(0), ref_counts.mean(0)
        active = (m > 0) | (mr > 0)
        r = float(np.corrcoef(m[active], mr[active])[0, 1])
        case["per_neuron_rate_pearson_r"] = {"r": r, "n_neurons": int(active.sum()), "pass_T3": r > 0.99}
        s1, s2 = set(np.nonzero(m >= 1)[0]), set(np.nonzero(mr >= 1)[0])
        jac = len(s1 & s2) / max(1, len(s1 | s2))
        case["active_set_jaccard"] = {"jaccard": jac, "port_n": len(s1), "upstream_n": len(s2), "pass_T4": jac > 0.9}
        grn = counts[:, list(stim)].mean()
        case["grn_mean_rate_hz"] = {"port": float(grn), "upstream": float(ref_counts[:, list(stim)].mean()),
                                    "expected_approx": rate * (1 - rate * p.dt)}
        report["cases"][name] = case
    print(json.dumps(report, indent=1, default=float))
    if a.out:
        a.out.write_text(json.dumps(report, indent=1, default=float))


if __name__ == "__main__":
    main()
