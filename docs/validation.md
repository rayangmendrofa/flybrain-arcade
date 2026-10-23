# Validation

All checks were run on 2026-10-23 with Python 3.14.7, Brian2 2.10.1, Numba 0.68.0, upstream
commit `91bdd1e`, FlyWire v630. The raw outputs are in [`docs/validation/`](validation/).

## 1. Reproduce a bounded upstream example

The upstream repository ships its own outputs: `results/example/sugarR_100Hz.parquet` and
`sugarR.parquet` (21 sugar GRNs, 30 trials × 1000 ms, Brian2 2.5.1, v630; the second was made at
200 Hz, see [model.md](model.md)). The app's default engine ran the same experiments, 30 trials
each with seed 2024 (`scripts/validate_statistical.py`). The tolerances below were declared
before the run; random streams differ, so bitwise agreement is not expected.

| Check (tolerance) | 100 Hz: app / upstream | 200 Hz: app / upstream | Pass |
|---|---|---|---|
| T1 MN9 (Fig. 1 readout) mean ± SD, Hz (\|z\| < 3) | 67.5 ± 5.3 / 67.0 ± 6.6 (z = 0.28) | 92.5 ± 5.3 / 93.3 ± 3.2 (z = −0.68) | ✓ |
| T1 MN9 (other) mean ± SD, Hz (\|z\| < 3) | 48.8 ± 4.1 / 48.6 ± 4.7 (z = 0.18) | 63.0 ± 4.5 / 61.8 ± 4.2 (z = 1.07) | ✓ |
| T2 total spikes per trial (\|z\| < 3) | 9,704 / 9,636 (z = 0.76) | 17,018 / 17,052 (z = −0.54) | ✓ |
| T3 Pearson r of per-neuron mean rates (> 0.99) | 0.99957 (423 neurons) | 0.99981 (454 neurons) | ✓ |
| T4 Jaccard of neurons with mean rate ≥ 1 Hz (> 0.9) | 0.983 | 0.997 | ✓ |
| GRN mean rate, Hz (expected ≈ r(1 − r·dt)) | 99.3 / 99.0 | 196.6 / 196.8 | ✓ |

z = (mean_app − mean_upstream) / √(SD²_app/30 + SD²_upstream/30).

## 2. Adapter vs upstream implementation under matching settings (spike-for-spike)

`scripts/validate_exact.py` draws Poisson events for the 21 GRNs once. It feeds the *same* events
to (a) the unmodified upstream `create_model` + `silence` run by Brian2 and (b) the Numba port.
For (a), the events reach `v` through a zero-delay synapse from a `SpikeGeneratorGroup`, with the
same weight, step and scheduling slot as `PoissonInput`. The spike trains of all 127,400 neurons
are then compared as sets of (step, neuron).

| Run | Brian2 spikes | Port spikes | Differences |
|---|---|---|---|
| 200 ms, 100 Hz, seed 3 | 1,874 | 1,874 | 0 (identical) |
| 1000 ms, 100 Hz, seed 11 | 9,242 | 9,242 | 0 (identical) |
| 1000 ms, 200 Hz, seed 12, Roundup (2 neurons) silenced | 13,689 | 13,689 | 0 (identical) |
| 500 ms, 50 Hz, seed 13, Rattle #1 silenced | 1,597 | 1,597 | 0 (identical) |

The first version of the port was **not** identical: it diverged at the second spike of
downstream neurons. The cause was Brian2's conditional write on `(unless refractory)` variables,
which discards input to refractory neurons. Once that rule was reproduced the trains matched
exactly. In pytest, `test_linear_constants_equal_brian2_state_update` also checks that one Brian2
step equals the port's update bit-for-bit.

## 3–7. Automated tests (`pytest`: 44 passed)

| Requirement | Tests |
|---|---|
| Stimulation onset, offset, targets, units | `test_poisson_kick_units_and_latency` (68.75 mV kick → spike on the next step); `test_stimulation_window_targets_and_rate` (spikes only in (onset, offset], only targets, rate r(1 − r·dt) ± 4 SD) |
| Synaptic delay and refractoriness | `test_synaptic_delay_is_t_dly` (shift = Δdelay steps exactly); `test_input_during_refractory_is_discarded` (hand-derived spike steps [30] vs [30, 60]) |
| Silencing = upstream intervention | `test_silencing_equals_zero_outgoing_weights_and_neuron_still_spikes` (mask ≡ zeroed weight rows, bitwise); `test_silencing_changes_output_only_downstream`; Brian2 exact test with silencing (above) |
| Reset and random-state handling | `test_same_seed_reproducible_and_reset_between_runs` (A, other run, A → identical); `test_trial_k_depends_only_on_seed_and_k`; API test reruns after a cancelled job and gets identical counts |
| Spike counts and firing rates | `test_counts_respect_half_open_window`, `test_rate_stats_definitions`, `test_psth_population_rate`, `test_compare_stats_paired`, `test_rates_match_upstream_get_rate` (against upstream `utils.get_rate`) |
| UI frame rate does not affect results | `test_results_independent_of_chunking_and_progress_polling` (chunks of 1, 7, 333, 100,000 steps → identical); frontend `mapping.test.ts` (playback samples precomputed data only) |
| Parameters, data identity | `test_parameters_read_from_upstream`, `test_upstream_pinned_and_unmodified`, `test_dataset_identity_and_index_order` (127,400 neurons, 14,687,178 connections, index ↔ ID order), `test_silencing_groups_are_verified_v630_ids` |
| Missing data | `test_missing_upstream_falls_back_to_replay_and_synthetic` |
| Arena | session chunking ≡ uninterrupted run (bitwise, odd chunk sizes); interface documentation; matched controller-only condition never feeds; walls and obstacles respected; full model: MN9 silent off-patch, > 20 Hz on-patch |

Frontend: `npm test` (4 mapping tests) and `npm run typecheck` pass.

Synthetic fixtures (`backend/tests/fixtures.py`, `flybrain/synthetic.py`) are invented networks.
They are kept apart from the biological data and labelled synthetic wherever they appear.

## Example result (within this model)

21 sugar GRNs at 100 Hz, 10 trials × 1000 ms, seed 1. Silencing both Roundup neurons
(sez_neurons.pickle) lowers MN9 (Fig. 1 readout) from 65.5 ± 3.5 Hz to 24.7 ± 4.6 Hz (−62 %;
lower in 10/10 paired trials). The other MN9 drops from 49.8 to 5.4 Hz. This is consistent with
the paper calling Roundup "the pre-MN with the strongest predicted silencing phenotype". It is a
result within the model, not a validated prediction about a living fly.
