# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Neuron positions for the brain view and the per-trial spike export."""

import numpy as np
import pytest

from flybrain import brain, neurons, runs

pytestmark = [pytest.mark.upstream,
              pytest.mark.skipif(not brain.available(), reason="run scripts/fetch_positions.py first")]


@pytest.fixture(scope="module")
def atlas():
    return brain.load_atlas()


def test_atlas_is_aligned_to_model_index_by_v630_id(atlas):
    cat = neurons.catalog()
    assert atlas.n == cat.n == 127_400
    assert atlas.meta["n_with_position"] == 127_320
    assert atlas.meta["matching"].startswith("exact FlyWire v630 root ID")
    # MN9 pair: upstream labels the Fig. 1 readout as the one opposite the stimulated GRNs; the
    # annotations put it on the fly's right, i.e. larger FAFB x
    a = atlas.pos_um[cat.index_of(neurons.MN9_CONTRA)]
    b = atlas.pos_um[cat.index_of(neurons.MN9_OTHER)]
    assert np.all(np.isfinite(a)) and np.all(np.isfinite(b))
    assert a[0] > b[0]


def test_sugar_grns_sit_ventrally(atlas):
    cat = neurons.catalog()
    idx = [cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM]
    y = atlas.pos_um[idx, 1]
    y_all = np.nanmedian(atlas.pos_um[:, 1])
    assert np.nanmean(y) > y_all  # +y is ventral in FAFB; gustatory neurons enter the ventral brain


def test_binary_round_trip(atlas):
    blob, meta = brain.atlas_binary(atlas)
    n = atlas.n
    assert len(blob) == n * 6 + n
    q = np.frombuffer(blob[: n * 6], dtype="<u2").reshape(n, 3)
    ok = q[:, 0] != brain.MISSING
    assert ok.sum() == meta["n_with_position"]
    lo, hi = np.array(meta["lo_um"]), np.array(meta["hi_um"])
    back = lo + q[ok] / (brain.MISSING - 1) * (hi - lo)
    assert np.max(np.abs(back - atlas.pos_um[ok])) < 0.02  # um


def test_run_activity_contains_every_spike_sorted():
    run = runs.load_run(runs.REPLAY_DIR / "sugar100_roundup" / "intervention")
    act = brain.run_activity(run, 0)
    assert act["n_spikes"] == len(run.raw["spike_neuron"][0]) == len(act["neuron"])
    assert np.all(np.diff(act["t_ms"]) >= 0)
    assert len(act["roles"]["sugar_grns"]) == 21
    assert len(act["roles"]["silenced"]) == len(run.config.silenced_ids) > 0
    with pytest.raises(IndexError):
        brain.run_activity(run, run.config.n_trials)
