# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Fidelity of the application adapter to the upstream model (needs v630 data)."""

import numpy as np
import pandas as pd
import pytest

from flybrain import engine_fast as ef, network, neurons, upstream

pytestmark = pytest.mark.upstream


def test_upstream_pinned_and_unmodified():
    st = upstream.check_upstream()
    assert st.commit == upstream.UPSTREAM_COMMIT
    assert all(f["matches"] for f in st.files.values())


def test_parameters_read_from_upstream():
    p = upstream.upstream_params()
    assert (p.v_0, p.v_rst, p.v_th) == pytest.approx((-0.052, -0.052, -0.045))
    assert (p.t_mbr, p.tau, p.t_rfc, p.t_dly) == pytest.approx((0.020, 0.005, 0.0022, 0.0018))
    assert p.w_syn == pytest.approx(0.275e-3) and p.f_poi == 250 and p.r_poi == 150
    assert p.dt == 1e-4
    assert upstream.brian2_timestep(p.t_rfc, p.dt) == 22
    assert round(p.t_dly / p.dt) == 18
    assert "dv/dt = (v_0 - v + g) / t_mbr" in p.eqs and "dg/dt = -g / tau" in p.eqs


def test_linear_constants_equal_brian2_state_update():
    """One Brian2 step from an arbitrary state equals the port's update bit-for-bit."""
    import brian2 as b2

    b2.prefs.codegen.target = "numpy"
    mod = upstream.import_upstream_model()
    params = mod.default_params
    G = b2.NeuronGroup(3, params["eqs"], method="linear", threshold=params["eq_th"], reset=params["eq_rst"],
                       refractory="rfc", namespace=params)
    v0 = np.array([-0.052, -0.0481, -0.06])
    g0 = np.array([0.0, 0.0123, -0.004])
    G.v, G.g, G.rfc = v0 * b2.volt, g0 * b2.volt, params["t_rfc"]
    b2.Network(G).run(b2.defaultclock.dt)
    c2, c8, c9, c10 = ef.brian2_linear_constants(upstream.upstream_params())
    assert np.array_equal(np.asarray(G.g), c2 * g0)
    assert np.array_equal(np.asarray(G.v), c8 + ((c9 * g0) + (c10 * v0)))


def test_dataset_identity_and_index_order():
    cat = neurons.catalog()
    assert cat.n == 127_400  # paper: all 127,400 proofread neurons of v630
    net = network.load_network()
    assert net.n_connections == 14_687_178
    for fid in neurons.SUGAR_GRNS_UPSTREAM + (neurons.MN9_CONTRA, neurons.MN9_OTHER):
        assert cat.has(fid)
    # upstream relies on Presynaptic_Index == row of the completeness CSV
    df = pd.read_parquet(upstream.dataset_paths()[1], columns=["Presynaptic_ID", "Presynaptic_Index",
                                                                "Postsynaptic_ID", "Postsynaptic_Index"])
    sample = df.sample(5000, random_state=0)
    assert np.array_equal(cat.ids[sample.Presynaptic_Index.to_numpy()], sample.Presynaptic_ID.to_numpy())
    assert np.array_equal(cat.ids[sample.Postsynaptic_Index.to_numpy()], sample.Postsynaptic_ID.to_numpy())


def test_silencing_groups_are_verified_v630_ids():
    cat = neurons.catalog()
    for g in neurons.silencing_groups():
        assert g["ids"], g["key"]
        assert all(cat.has(int(i)) for i in g["ids"]), g["key"]


@pytest.mark.slow
@pytest.mark.parametrize("silence", [[], [720575940607272649, 720575940623211725]])
def test_exact_spike_trains_vs_upstream_brian2(silence):
    """Identical injected input -> identical spikes of all 127,400 neurons (100 ms)."""
    from flybrain.engine_brian2 import run_reference_trial

    p = upstream.upstream_params()
    cat = neurons.catalog()
    stim = tuple(cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM)
    sil = [cat.index_of(i) for i in silence]
    n = 1000
    targets, events = ef.draw_poisson_events(21, 0, n, [ef.StimGroup(stim, 150.0, 0.0, 0.1)], p.dt)
    inj = {int(t): np.nonzero(events[:, c])[0] for c, t in enumerate(targets)}
    ref = run_reference_trial(list(stim), 150.0, sil, 0.1, 21, injected_events=inj)
    port = ef.run_trials(network.load_network(), p, [], sil, 0.1, 21, 1, injected_events=[(targets, events)])
    a = set(zip(ref.spike_step.tolist(), ref.spike_neuron.tolist()))
    b = set(zip(port.spike_step[0].tolist(), port.spike_neuron[0].tolist()))
    assert len(a) > 300
    assert a == b


def test_statistics_match_upstream_published_example_outputs():
    """Distributional agreement with upstream results/example/sugarR_100Hz.parquet (Brian2 2.5.1)."""
    p = upstream.upstream_params()
    cat = neurons.catalog()
    stim = tuple(cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM)
    res = ef.run_trials(network.load_network(), p, [ef.StimGroup(stim, 100.0, 0.0, 1.0)], [], 1.0, 2024, 30)
    ref = pd.read_parquet(upstream.upstream_dir() / "results" / "example" / "sugarR_100Hz.parquet")
    mn9 = cat.index_of(neurons.MN9_CONTRA)
    x = np.array([(s == mn9).sum() for s in res.spike_neuron], float)
    y = ref[ref.flywire_id == neurons.MN9_CONTRA].groupby("trial").size().reindex(range(30), fill_value=0).to_numpy(float)
    z = (x.mean() - y.mean()) / np.sqrt(x.var() / 30 + y.var() / 30)
    assert abs(z) < 3, (x.mean(), y.mean())
    tot_x = np.array([len(s) for s in res.spike_neuron], float)
    tot_y = ref.groupby("trial").size().to_numpy(float)
    assert abs((tot_x.mean() - tot_y.mean()) / np.sqrt(tot_x.var() / 30 + tot_y.var() / 30)) < 3
