"""Fast-engine semantics on synthetic fixtures (no biological data needed).

Covers: stimulation onset/offset/targets/units, synaptic delay, Brian2's
refractory conditional write, silencing semantics, reset/seed handling and
independence from chunking (the only coupling between UI polling and the
integrator).
"""

import dataclasses

import numpy as np
import pytest

from flybrain import engine_fast as ef
from flybrain.synthetic import SYN_SENSORY, synthetic_network, synthetic_params

from fixtures import PARAMS, spikes_of, tiny_network

DT = PARAMS.dt


def injected(n_steps, targets, event_steps):
    ev = np.zeros((n_steps, len(targets)), dtype=np.uint8)
    for col, steps in enumerate(event_steps):
        ev[steps, col] = 1
    return [(np.asarray(targets, dtype=np.int32), ev)]


def test_poisson_kick_units_and_latency():
    # One input event adds w_syn * f_poi = 0.275 mV * 250 = 68.75 mV to v at step n,
    # which crosses threshold (7 mV above rest) and is detected at step n + 1.
    assert PARAMS.w_syn * PARAMS.f_poi == pytest.approx(0.06875)
    net = tiny_network([], 2)
    res = ef.run_trials(net, PARAMS, [], [], 0.01, 0, 1, injected_events=injected(100, [0], [[10, 50]]))
    assert spikes_of(res, 0, 0) == [11, 51]
    assert spikes_of(res, 0, 1) == []


def test_stimulation_window_targets_and_rate():
    net = tiny_network([], 3)
    on, off, rate, dur, trials = 0.1, 0.3, 200.0, 0.5, 20
    res = ef.run_trials(net, PARAMS, [ef.StimGroup((0,), rate, on, off)], [], dur, 5, trials)
    on_s, off_s = round(on / DT), round(off / DT)
    all_steps = np.concatenate([res.spike_step[k][res.spike_neuron[k] == 0] for k in range(trials)])
    assert all_steps.min() >= on_s + 1 and all_steps.max() <= off_s  # event at n -> spike at n + 1
    for k in range(trials):
        assert set(res.spike_neuron[k].tolist()) <= {0}  # only the target spikes
    # Expected rate inside the window: rate * (1 - rate*dt) (an event in the step
    # right after a spike is discarded by Brian2's conditional write / reset).
    measured = len(all_steps) / (trials * (off - on))
    expected = rate * (1 - rate * DT)
    sd = np.sqrt(expected * (off - on) * trials) / (trials * (off - on))
    assert abs(measured - expected) < 4 * sd


def test_synaptic_delay_is_t_dly():
    net = tiny_network([(0, 1, 400)], 2)
    ev = injected(400, [0], [[10]])
    first = {}
    for t_dly in (0.0018, 0.0005):
        p = dataclasses.replace(PARAMS, t_dly=t_dly)
        res = ef.run_trials(net, p, [], [], 0.04, 0, 1, injected_events=ev)
        assert spikes_of(res, 0, 0) == [11]
        first[t_dly] = spikes_of(res, 0, 1)[0]
    assert first[0.0018] - first[0.0005] == 18 - 5  # delay steps = round(t_dly / dt)
    assert first[0.0018] > 11 + 18


def test_input_during_refractory_is_discarded():
    # Neuron 1 is driven to spike at step 30 by neuron 0; a second strong input
    # from neuron 2 arriving during its 2.2 ms refractory period is ignored
    # (Brian2 conditional write on 'unless refractory' variables), but the same
    # input arriving after the refractory period makes it fire again.
    net = tiny_network([(0, 1, 10000), (2, 1, 10000)], 3)
    during = ef.run_trials(net, PARAMS, [], [], 0.01, 0, 1, injected_events=injected(100, [0, 2], [[10], [20]]))
    after = ef.run_trials(net, PARAMS, [], [], 0.01, 0, 1, injected_events=injected(100, [0, 2], [[10], [40]]))
    assert spikes_of(during, 0, 1) == [30]  # input delivered at step 39 < 30 + 22
    assert spikes_of(after, 0, 1) == [30, 60]  # input delivered at step 59 >= 52


def test_silencing_equals_zero_outgoing_weights_and_neuron_still_spikes():
    net = synthetic_network()
    p = synthetic_params()
    sil = [SYN_SENSORY[0], 60, 61, 95]
    g = [ef.StimGroup(SYN_SENSORY, 120.0, 0.0, 0.5)]
    masked = ef.run_trials(net, p, g, sil, 0.5, 9, 3)
    w = net.weights.copy()
    for j in sil:
        w[net.indptr[j]:net.indptr[j + 1]] = 0.0
    zeroed = ef.run_trials(dataclasses.replace(net, weights=w), p, g, [], 0.5, 9, 3)
    for k in range(3):
        assert np.array_equal(masked.spike_neuron[k], zeroed.spike_neuron[k])
        assert np.array_equal(masked.spike_step[k], zeroed.spike_step[k])
    # upstream silence() removes output only: a stimulated silenced neuron still fires
    assert len(spikes_of(masked, 0, SYN_SENSORY[0])) > 20


def test_silencing_changes_output_only_downstream():
    net = tiny_network([(0, 1, 10000), (1, 2, 10000)], 3)
    ev = injected(200, [0], [[10]])
    base = ef.run_trials(net, PARAMS, [], [], 0.02, 0, 1, injected_events=ev)
    sil = ef.run_trials(net, PARAMS, [], [1], 0.02, 0, 1, injected_events=ev)
    assert spikes_of(base, 0, 1) == spikes_of(sil, 0, 1) == [30]
    assert spikes_of(base, 0, 2) == [49]
    assert spikes_of(sil, 0, 2) == []


@pytest.fixture(scope="module")
def synth():
    return synthetic_network(), synthetic_params(), [ef.StimGroup(SYN_SENSORY, 100.0, 0.05, 0.4)]


def _same(a, b):
    return all(np.array_equal(x, y) for x, y in zip(a.spike_neuron, b.spike_neuron)) and \
        all(np.array_equal(x, y) for x, y in zip(a.spike_step, b.spike_step))


def test_same_seed_reproducible_and_reset_between_runs(synth):
    net, p, g = synth
    a1 = ef.run_trials(net, p, g, [], 0.5, 42, 4)
    other = ef.run_trials(net, p, g, [70, 71], 0.5, 7, 4)  # different run in between
    a2 = ef.run_trials(net, p, g, [], 0.5, 42, 4)
    assert _same(a1, a2)
    assert not _same(a1, other)
    assert not _same(a1, ef.run_trials(net, p, g, [], 0.5, 43, 4))


def test_trial_k_depends_only_on_seed_and_k(synth):
    net, p, g = synth
    three = ef.run_trials(net, p, g, [], 0.5, 3, 3)
    five = ef.run_trials(net, p, g, [], 0.5, 3, 5)
    for k in range(3):
        assert np.array_equal(three.spike_neuron[k], five.spike_neuron[k])
    assert not np.array_equal(five.spike_step[0], five.spike_step[1])


@pytest.mark.parametrize("chunk", [1, 7, 333, 100000])
def test_results_independent_of_chunking_and_progress_polling(synth, chunk):
    """The UI only ever affects how often the worker reports progress (chunking);
    the integration timestep and results must not change."""
    net, p, g = synth
    ref = ef.run_trials(net, p, g, [], 0.5, 11, 2, chunk_steps=500)
    calls = []
    res = ef.run_trials(net, p, g, [], 0.5, 11, 2, chunk_steps=chunk, progress=calls.append)
    assert _same(ref, res)
    assert calls[-1] == 1.0


def test_cancellation_raises_and_buffer_overflow_is_an_error(synth):
    net, p, g = synth
    with pytest.raises(ef.Cancelled):
        ef.run_trials(net, p, g, [], 0.5, 1, 1, chunk_steps=10, should_cancel=lambda: True)
    with pytest.raises(RuntimeError, match="overflow"):
        ef.run_trials(net, p, g, [], 0.5, 1, 1, max_spikes_per_trial=10)


def test_linear_constants_match_closed_form():
    c2, c8, c9, c10 = ef.brian2_linear_constants(PARAMS)
    dt, tau, tm = PARAMS.dt, PARAMS.tau, PARAMS.t_mbr
    assert c2 == pytest.approx(np.exp(-dt / tau), rel=1e-14)
    assert c10 == pytest.approx(np.exp(-dt / tm), rel=1e-14)
    assert c9 == pytest.approx(tau / (tm - tau) * (np.exp(-dt / tm) - np.exp(-dt / tau)), rel=1e-12)
    assert c8 == pytest.approx(PARAMS.v_0 * (1 - np.exp(-dt / tm)), rel=1e-12)


@pytest.mark.parametrize("chunks", [[2000], [500, 500, 500, 500], [17, 983, 1, 999]])
def test_neural_session_chunking_equals_single_run(synth, chunks):
    """Closed-loop sessions carry v, g, refractory clocks and in-flight spikes across chunks."""
    net, p, _ = synth
    rng = np.random.default_rng(5)
    targets = np.asarray(SYN_SENSORY, dtype=np.int32)
    events = (rng.random((2000, len(targets))) < 0.012).astype(np.uint8)
    ref = ef.run_trials(net, p, [], [60], 0.2, 0, 1, injected_events=[(targets, events)])
    sess = ef.NeuralSession(net, p, list(targets), [60], seed=0)
    got_i, got_s, start = [], [], 0
    for n in chunks:
        i, s = sess.advance(n, events=events[start:start + n])
        got_i.append(i)
        got_s.append(s)
        start += n
    assert np.array_equal(np.concatenate(got_i), ref.spike_neuron[0])
    assert np.array_equal(np.concatenate(got_s), ref.spike_step[0])
    assert len(ref.spike_neuron[0]) > 200
