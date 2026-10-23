# FlyBrain Arcade

An interactive virtual-fly experiment built on the **published whole-brain leaky integrate-and-fire
model of Shiu et al. (Nature 2024)**. You stimulate identified sugar-sensing neurons, watch
simulated spikes and a feeding-related motor neuron (MN9), silence neurons, and compare against
the baseline. A cartoon fly shows an illustrative readout.

> Results are outputs **of this model under its assumptions**, not recorded biological data and
> not validated predictions about a living fly.

- Scientific model and upstream verification record: [docs/model.md](docs/model.md)
- Application-defined assumptions: [docs/assumptions.md](docs/assumptions.md)
- Validation results: [docs/validation.md](docs/validation.md)
- Measured performance: [docs/performance.md](docs/performance.md)
- Optional arena (hybrid demonstration): [docs/arena.md](docs/arena.md)
- Licences and notices: [NOTICE.md](NOTICE.md)

## Quick start

Requirements: Python ≥ 3.12 (tested 3.14.7), Node.js ≥ 20 (tested 24.22.1), git, ~1.5 GB disk
and ~4 GB RAM (the Brian2 reference engine peaks at ~3 GB). No C++ compiler is needed.

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -r backend/requirements.txt
```
(on macOS/Linux use `.venv/bin/python` in this and the following commands)

Fetch the upstream model and its FlyWire v630 data. This clones the pinned commit (~200 MB) and
verifies SHA-256 checksums:

```bash
.venv/Scripts/python scripts/fetch_upstream.py
```

Build the frontend:

```bash
cd frontend && npm install && npm run build
```

Run the app (the API also serves the built frontend):

```bash
.venv/Scripts/python -m uvicorn flybrain.api:app --app-dir backend --host 127.0.0.1 --port 8010
```

Open <http://127.0.0.1:8010>. On start-up a background worker compiles the Numba kernels and
loads the 14.7 M connections, which takes a few seconds the first time. A banner shows while this
happens.

### Development mode

Run the API as above, then in a second terminal:

```bash
cd frontend && npm run dev
```

Open <http://localhost:5174> (Vite proxies `/api` to port 8010).

### Tests

```bash
.venv/Scripts/python -m pytest
```

```bash
.venv/Scripts/python -m pytest -m "not slow"
```
(skips the two Brian2 exact-match tests, ~15 s)

```bash
cd frontend && npm test && npm run typecheck
```

### Re-running validation and benchmarks

```bash
.venv/Scripts/python scripts/validate_exact.py --duration-ms 1000 --rate 100 --seed 11
```

```bash
.venv/Scripts/python scripts/validate_statistical.py --trials 30
```

```bash
.venv/Scripts/python scripts/benchmark.py
```

## Using the app — "Sugar, Spikes & Silence"

1. **Stimulate.** Choose the engine, Poisson rate (0–200 Hz) applied to the 21 upstream sugar GRNs,
   simulated duration, schedule (whole trial = upstream protocol, or an on/off window), rate
   measurement window, number of trials and seed. Press **Run baseline**. The run happens in a
   background worker and can be cancelled. The estimate is based on the measured benchmark.
2. **Watch.** The fly's proboscis follows the smoothed MN9 rate through a documented mapping. The
   driving trace, with the application's threshold and saturation lines, sits beside it. Playback
   replays already-computed results at a chosen speed, so simulated time and wall-clock time stay
   separate. The schedule plot, a bounded spike raster (≤ 80 neurons, one trial at a time) and MN9
   rates (mean ± SD across trials, with the window stated) appear below.
3. **Silence.** Pick verified groups (paper Fig. 1b cell types with upstream IDs, e.g. Roundup,
   Rattle, Fdg; or all 21 GRNs as a control), any of the 106 upstream SEZ cell types, top
   responsive neurons from your baseline, or a FlyWire **v630** ID. Silencing uses upstream
   `silence()`, which removes all outgoing synapses.
4. **Run intervention.** This repeats the baseline exactly (same initial state, schedule and seeds)
   with the silencing applied. The comparison panel shows spike counts, rates, Δ Hz, Δ % vs
   baseline, paired per-seed differences (SD/SEM) and how many trials went down or up.
5. **Reset** clears runs and selections and keeps your settings and seed for exact reuse.
6. **Export:** config JSON, provenance JSON, rate summary CSV, selected-spikes CSV, comparison JSON,
   and every chart as SVG or PNG.

The header always shows the mode (**LIVE SIMULATION**, **REPLAY**, or **SYNTHETIC DEMO**) and the
dataset/commit. Every panel is tagged **DATA** (measured connectivity/annotations), **MODEL**
(simulated activity) or **APP** (application-defined mappings). Keyboard: every control is a
native input. On the fly stage, Space plays or pauses and the arrow keys step simulated time. The
UI honours `prefers-reduced-motion` and has a "reduce motion" switch.

### Engines and modes

| Engine | Description |
|---|---|
| `numba-port` (default) | Whole 127,400-neuron model; Numba port of the Brian2 update, validated spike-for-spike against upstream Brian2. ≤ 30 trials, ≤ 2 s. |
| `brian2-reference` | Unmodified upstream `model.py` on Brian2 2.10.1 (NumPy target). Slow (~21 s per simulated second). ≤ 3 trials, upstream protocol only. |
| `synthetic` | **SYNTHETIC DEMO**: invented 400-neuron network with the upstream equations. Always available and always labelled. |
| Replays | Precomputed runs in `replays/` with full provenance, labelled **REPLAY**. They work without the upstream data. |

If the upstream data are missing, the app explains the blocker (with the fetch command) and offers
the replay and synthetic modes. It never substitutes another network for the published model.

### Arena (stage 2, hybrid demonstration)

A top-down arena with food-cue patches, obstacles and a visible trajectory. Environment → sensory
encoder → **published neural model** → MN9 decoder → **handcrafted controller**. Walking and
steering are not provided by the model. The interface table in the UI and
[docs/arena.md](docs/arena.md) list every variable, unit, update rate, neuron ID, equation and
whether it is published or an application assumption. A controller-only condition and silencing
make matched comparisons possible. Nothing learns.

## Project layout

```
backend/flybrain/
  upstream.py        upstream adapter: paths, pinned commit, checksums, parameters (read from model.py), provenance
  neurons.py         verified neuron IDs (sugar GRNs, MN9s, SEZ cell types) and ID<->index catalog
  network.py         connectivity parquet -> CSR (cached)
  engine_brian2.py   reference engine: unmodified upstream create_model/poi/silence on Brian2
  engine_fast.py     Numba port + NeuralSession (closed loop)
  experiment.py      validated, bounded experiment configuration (pydantic)
  metrics.py         spike counts, rates, PSTHs, paired comparisons
  runs.py            run summaries, bounded raster selection, persistence, export, replays
  jobs.py            background worker process, cancellation
  synthetic.py       SYNTHETIC DEMO network (not biological)
  arena/             stage 2: environment, encoder, decoder, controller, episode loop, API
  api.py             FastAPI app
backend/tests/       pytest suite (synthetic fixtures kept separate from biological data)
frontend/src/        React + TypeScript UI (d3-scale/d3-shape SVG charts)
scripts/             fetch_upstream, validate_exact, validate_statistical, benchmark, build_replay, convert_sez_pickle
replays/             precomputed, labelled replay(s)
docs/                model, assumptions, validation (+ raw outputs), performance, arena
upstream/            (git-ignored) upstream clone with the FlyWire v630 files
data/                (git-ignored) caches and persisted runs
```

## Limitations and known blockers

- **Not real-time.** One 1 s trial of the full model takes ~2.3 s (Numba) or ~21 s (Brian2) on
  the test laptop. Batches of trials run in parallel. The arena runs at 1.2–1.8 s per simulated
  second and is played back after computation.
- **Brian2 without a C++ compiler** uses the NumPy runtime target. Installing a compiler for
  Brian2's Cython/C++ targets would speed up the reference engine; this was not attempted.
- **Hemisphere naming** of the sugar GRNs differs between upstream code comments ("right") and the
  paper Methods ("left"). The app does not resolve it.
- **FlyWire data licence** is not stated in the upstream repository. Check FlyWire/Codex terms
  before redistributing (see NOTICE.md). The data are fetched, not committed.
- Only v630 is supported. Adapting to v783 or MaleCNS would need re-verified neuron IDs and is a
  separate project.
- The model's own limitations (no neuromodulation, gap junctions or morphology; 0 Hz baseline;
  uncertain absolute rates) apply to everything shown. See [docs/model.md](docs/model.md).
