# Application-defined assumptions

Everything below is a choice made by FlyBrain Arcade, not something taken from the paper or the
upstream code. The UI tags each item **APP** (pink ✎). Measured data are tagged **DATA** (teal ◆)
and simulated activity **MODEL** (yellow ∿).

## Experiment ("Sugar, Spikes & Silence")

| # | Assumption | Where |
|---|---|---|
| A1 | dt = 0.1 ms (Brian2 default; upstream sets none). | both engines |
| A2 | Trial *k* of a run uses NumPy `SeedSequence([seed, k])`. The Numba port pre-draws the Poisson events with PCG64. Brian2 runs call `brian2.seed(SeedSequence([seed,k]).generate_state(1)[0] mod 2³¹)`. Seeds are engine-specific: the same seed does not give the same input stream in the two engines. | `engine_fast.py`, `jobs.py` |
| A3 | Baseline and intervention share seeds, so trial *k* of both receives **identical input events**. The comparison is paired. | `/api/intervention` copies the baseline config |
| A4 | Optional stimulation on/off window: the upstream Poisson mechanism gated in time. Upstream always stimulates for the whole trial, which is the default. The Brian2 engine only allows the upstream protocol. | `StimulusConfig` |
| A5 | Bounds: rate 0–200 Hz (paper's sugar range is 10–200 Hz; 0 Hz is a control); duration 100–2000 ms; ≤ 30 trials (≤ 3 and ≤ 1000 ms for Brian2); ≤ 200 silenced neurons. | `experiment.py` |
| A6 | Firing rate = spikes in a half-open window [start, end) ÷ window length. The default window is the whole trial (the upstream `get_rate` definition). SD uses ddof = 0 like upstream. SEM uses ddof = 1. | `metrics.py` |
| A7 | Relative change = (mean_intervention − mean_baseline) / mean_baseline. It is reported as n/a when the baseline is 0. | `metrics.compare_stats` |
| A8 | The raster shows ≤ 80 neurons for one trial at a time: outputs, silenced (≤ 20), stimulated GRNs, then the top-30 responsive neurons by baseline rate. All spikes stay on the server. | `runs.py` |
| A9 | "Top responsive" excludes the stimulated GRNs. It mimics the paper's screen of the top sugar-responsive neurons (Fig. 1f) and is not the paper's list. | `runs.py` |

## Cartoon fly (illustrative readout)

| # | Assumption |
|---|---|
| B1 | The driving signal is the trial-averaged contralateral MN9 rate in 5 ms bins. |
| B2 | Causal exponential smoothing with τ = 50 ms. |
| B3 | Extension e = clamp((s − 5 Hz)/(100 Hz − 5 Hz), 0, 1). The 5 Hz threshold and 100 Hz saturation are presentation choices; 100 Hz is about the model's MN9 rate at 200 Hz sugar input. |
| B4 | Proboscis pose interpolates linearly between "tucked" and "extended" with e. It is not a biomechanical model. The paper itself states the MN9-rate → rostrum-lifting relation is unknown. |
| B5 | The drop glows while the sugar GRNs are stimulated. It depicts the stimulation, not a food cue or a stimulus the fly perceives. |
| B6 | Playback speed (0.1–1× simulated time per wall-clock time) only changes how fast stored results are shown. |

## Arena (hybrid demonstration)

See [arena.md](arena.md). Every non-neural box is an application assumption: contact-only cue,
linear concentration → Poisson rate, MN9 decoding and feeding gate, patch depletion, and the
handcrafted random-walk controller with obstacle avoidance.

## Language

The app never claims hunger, intention, emotion, consciousness or biological equivalence. It says
"food-cue input", "within this model" and "illustrative readout". Synthetic mode is always banner-
and badge-labelled. Replays are labelled REPLAY with their provenance.
