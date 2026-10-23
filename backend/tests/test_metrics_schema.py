import importlib.util

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from flybrain import metrics, upstream
from flybrain.experiment import ExperimentConfig

DT = 1e-4


def test_counts_respect_half_open_window():
    sn = [np.array([0, 0, 1, 0], dtype=np.int32)]
    ss = [np.array([0, 999, 1000, 1000], dtype=np.int32)]
    c = metrics.counts_in_window(sn, ss, 2, metrics.window_steps((0, 100), DT))
    assert c.tolist() == [[2, 0]]  # step 1000 (= 100 ms) is outside [0, 100) ms
    c = metrics.counts_in_window(sn, ss, 2, metrics.window_steps((100, 200), DT))
    assert c.tolist() == [[1, 1]]


def test_rate_stats_definitions():
    s = metrics.rate_stats(np.array([10, 20, 30]), 0.5)
    assert s["per_trial_rate_hz"] == [20.0, 40.0, 60.0]
    assert s["mean_rate_hz"] == 40.0
    assert s["sd_rate_hz"] == pytest.approx(np.std([20, 40, 60]))  # ddof=0 like upstream
    assert s["sem_rate_hz"] == pytest.approx(np.std([20, 40, 60], ddof=1) / np.sqrt(3))


def test_psth_population_rate():
    # 2 trials, neuron 0 spikes once per 5 ms bin in trial 0 only -> 100 Hz / 2 trials = 100 Hz/2
    sn = [np.zeros(4, dtype=np.int32), np.zeros(0, dtype=np.int32)]
    ss = [np.array([0, 50, 100, 150], dtype=np.int32), np.zeros(0, dtype=np.int32)]
    p = metrics.psth(sn, ss, [0], 200, DT, 5.0)
    assert p["rate_hz"] == pytest.approx([100.0, 100.0, 100.0, 100.0])  # 4 bins of 50 steps
    p2 = metrics.psth(sn, ss, [0], 200, DT, 10.0)
    assert p2["rate_hz"] == pytest.approx([100.0, 100.0])


def test_compare_stats_paired():
    base, inter = np.array([10, 12, 14]), np.array([5, 6, 7])
    c = metrics.compare_stats(base, inter, 1.0)
    assert c["delta_rate_hz"] == -6.0
    assert c["delta_percent"] == pytest.approx(-50.0)
    assert c["per_trial_delta_hz"] == [-5.0, -6.0, -7.0]
    assert c["trials_decreased"] == 3
    assert metrics.compare_stats(np.zeros(3), np.ones(3), 1.0)["delta_percent"] is None


@pytest.mark.upstream
def test_rates_match_upstream_get_rate():
    spec = importlib.util.spec_from_file_location("shiu_utils", upstream.upstream_dir() / "utils.py")
    utl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(utl)
    rng = np.random.default_rng(0)
    n_run, t_run = 4, 1.0
    rows = []
    for k in range(n_run):
        for fid in (101, 202):
            for t in np.sort(rng.random(rng.integers(1, 30))):
                rows.append({"t": t, "trial": k, "flywire_id": fid, "exp_name": "x"})
    df = pd.DataFrame(rows)
    rate, std = utl.get_rate(df, t_run=t_run, n_run=n_run)
    for col, fid in enumerate((101, 202)):
        counts = np.array([((df.trial == k) & (df.flywire_id == fid)).sum() for k in range(n_run)])
        s = metrics.rate_stats(counts, t_run)
        assert s["mean_rate_hz"] == pytest.approx(rate.loc[fid, "x"])
        assert s["sd_rate_hz"] == pytest.approx(std.loc[fid, "x"])


def test_schema_bounds_and_defaults():
    c = ExperimentConfig()
    assert c.window_ms == (0.0, 1000.0) and c.stim_offset_ms == 1000.0
    for bad in (
        {"stimulus": {"rate_hz": 250}},
        {"stimulus": {"rate_hz": -1}},
        {"duration_ms": 50},
        {"n_trials": 31},
        {"stimulus": {"onset_ms": 500, "offset_ms": 400}},
        {"stimulus": {"offset_ms": 1500}},
        {"rate_window_ms": [0, 1500]},
        {"engine": "brian2-reference", "n_trials": 5},
        {"engine": "brian2-reference", "stimulus": {"onset_ms": 100}},
        {"silenced_ids": ["abc"]},
        {"silenced_ids": ["SYN-3"]},
        {"engine": "synthetic", "silenced_ids": ["720575940660219265"]},
        {"unknown_field": 1},
    ):
        with pytest.raises(ValidationError):
            ExperimentConfig.model_validate(bad)


def test_comparison_matching():
    a = ExperimentConfig(seed=3)
    b = a.model_copy(update={"silenced_ids": ["1"]})
    assert a.matched_for_comparison(b) == []
    assert a.matched_for_comparison(a.model_copy(update={"seed": 4})) == ["seed"]
