# FlyBrain Arcade: handoff guide for website design

This guide is for bringing the project into another chat, for example one that holds the
gelastinta.com designs. It lists every file that matters, grouped by what it gives you, and the
facts and rules a designer needs. `python scripts/make_handoff.py` packs the files below into
upload-ready zips in `handoff/`.

**Start here when uploading:**
1. This file, `docs/HANDOFF.md`.
2. `handoff/1-content-and-science.zip`, for the words, facts and honesty rules.
3. `handoff/2-website-data-and-assets.zip`, for the real data, the 3D fly and the video poster.
4. `handoff/3-visualisation-code.zip`, only if the other chat will rebuild the 3D views or the
   page.
5. `handoff/4-simulation-backend.zip`, only if it needs to understand or re-run the simulation.
6. The video itself (33 MB), uploaded separately:
   `frontend/site/public/media/flybrain-story.mp4`.

---

## Key facts (check against these before writing copy)

| What | Value | Source file |
|---|---|---|
| Neurons in the model | 127,400 (FlyWire public release v630) | `docs/model.md` |
| Connections / synapses | 14,687,178 connections; 52,793,639 synapses | `docs/performance.md` |
| Neurons with a 3D position | 127,320 of 127,400, matched by exact v630 ID | `site data/atlas.json` |
| Stimulus | 21 sugar-taste neurons (GRNs), random spikes at 100 per second, 1 simulated second | `site data/runs/baseline.json` |
| Output neuron | MN9, a motor neuron that "controls rostrum lifting during proboscis extension" (paper) | `docs/model.md` |
| Main result | MN9 65.5 Hz → 24.7 Hz (−62%) when the 2 Roundup neurons are silenced; lower in 10 of 10 paired trials | `site data/comparison.json` |
| Arena (hybrid demo, 15 s) | intact model: 10.7 s feeding; Roundup silenced: 0.9 s feeding | `site data/arena/*.json` |
| Speed | 1 simulated second takes ~2.3 s to compute (Numba); not real time | `docs/performance.md` |
| Validation | Numba port identical spike-for-spike to the original Brian2 code; matches the paper's bundled results (r > 0.9995) | `docs/validation.md` |

## Honesty rules the design must keep

- **Category labels.** Tag every visual or number with one of three categories:
  - **DATA**: measured wiring and positions.
  - **MODEL**: simulated activity.
  - **APP**: our display choices, such as the proboscis-extension mapping, the gait, the
    controller, camera moves and colours.

  The colours are DATA teal `#4fd1c5`, MODEL yellow `#f6c945` and APP pink `#f472b6`.
- **Not real data.** Say "simulated" or "replay", never "recorded". Never imply the animation is
  real fly behaviour.
- **Wrong species on purpose.** The 3D fly is a stylised house fly from an AI-generated model. The
  brain is a fruit-fly (*Drosophila*) brain. Say both.
- **Movement.** Walking and leg movement are not produced by the brain model: the dataset has no
  nerve cord. Only the proboscis and the decision to stop and feed come from the model.
- **No inner life.** No claims of hunger, wanting, feeling, learning or consciousness. Use
  "food-cue input", not "the fly feels hungry".
- **Credits** must name Shiu et al. 2024 (Nature), FlyWire (Dorkenwald et al. 2024; Schlegel et
  al. 2024), flywire_annotations v1.1.0 and the Tripo-generated model.
- **Licences to confirm before the page goes public** are listed in `NOTICE.md`: the FlyWire data,
  flywire_annotations (no licence file) and the Tripo model.

---

## 1 · Content and science (text to read; small)

| File | What it gives you |
|---|---|
| `README.md` | Overview, how to run everything, project layout |
| `docs/model.md` | The published model: equations, parameters, neuron IDs, limitations |
| `docs/assumptions.md` | Every application choice (mappings, smoothing, thresholds) |
| `docs/validation.md` | How the re-implementation was checked against the original |
| `docs/performance.md` | Timing and memory measurements |
| `docs/arena.md` | The hybrid arena: what is model and what is handcrafted |
| `docs/visualisation.md` | The 3D fly, brain view, gait, video and the showcase page |
| `NOTICE.md` | Licences, citations and open licence questions |
| `frontend/src/site/Site.tsx` | **All current page copy**: headings, paragraphs, limitations list, credits |
| `frontend/src/site/story.ts` | **Video script**: every caption and its timing (76 s) |
| `frontend/src/site/site.css` | Current page look: colour tokens, spacing, layout breakpoints |

## 2 · Website data and assets (what the page displays)

All of this comes from `scripts/export_site_data.py` or the video studio. It is git-ignored, so
regenerate it if it is missing.

| File | Size | What it is |
|---|---|---|
| `frontend/site/public/data/manifest.json` | 3 KB | Provenance for everything below |
| `frontend/site/public/data/runs/baseline.json` | 124 KB | Sugar run: MN9 rate over time (10-trial mean) and every spike of trial 1 |
| `frontend/site/public/data/runs/intervention.json` | 96 KB | Same, with Roundup silenced |
| `frontend/site/public/data/comparison.json` | 5 KB | Per-trial MN9 rates for both runs and the paired result |
| `frontend/site/public/data/arena/intact.json` | 26 KB | 15 s hybrid-arena episode: path, heading, speed, MN9, feeding |
| `frontend/site/public/data/arena/roundup_silenced.json` | 25 KB | Same with Roundup silenced |
| `frontend/site/public/data/atlas.json` + `atlas.bin` | 0.9 MB | 3D positions of 127,320 neurons (binary layout described in `atlas.json`) |
| `frontend/public/models/housefly.glb` (+ `.json`) | 0.5 MB | Web-ready 3D house fly (glTF, meshopt-compressed) |
| `frontend/site/public/media/flybrain-story-poster.jpg` | 0.2 MB | Poster frame (inside-the-head view) |
| `frontend/site/public/media/flybrain-story.mp4` | 33 MB | The narrated 76 s video, 1080p H.264 |
| `replays/sugar100_roundup/` | 0.6 MB | Full replay the page data was exported from (all 10 trials, all spikes) |

## 3 · Visualisation and animation code (to rebuild or restyle the views)

| File | What it does |
|---|---|
| `frontend/src/three/scene.ts` | three.js scene: lights, camera moves, fly loading and alignment, fly/brain views, arena mode |
| `frontend/src/three/proboscis.ts` | Jointed proboscis and how MN9 extension maps onto its three joints |
| `frontend/src/three/brain.ts` | Brain point cloud and spike-flash shader |
| `frontend/src/three/legs.ts` | Finds the six legs in the fused mesh and bends them in the shader |
| `frontend/src/three/gait.ts` | Tripod gait maths (tested in `gait.test.ts`) |
| `frontend/src/three/arenaWorld.ts` | Arena floor, sugar patches, obstacles, trail; pose interpolation |
| `frontend/src/lib/mapping.ts` | The MN9 rate → proboscis-extension mapping (APP) |
| `frontend/src/lib/brainData.ts` | Decoding neuron positions and spike lists |
| `frontend/src/lib/sceneHooks.ts` | React hooks: create scene, playback clock |
| `frontend/src/site/*` | The showcase page: `Site.tsx`, `Explorer.tsx` (3D replay viewer), `LifNeuron.tsx` (one-neuron widget), `ArenaDemo.tsx`, `Studio.tsx` (video renderer), `data.ts`, `story.ts`, `site.css` |
| `frontend/src/components/Arena3D.tsx`, `arena3d.css`, `Fly3D.tsx`, `FlyStage.tsx` | Shared 3D arena view and the app's fly stage |
| `frontend/site/index.html`, `frontend/site/main.tsx`, `frontend/vite.site.config.ts` | Page entry and static build config (relative URLs, any sub-path) |
| `frontend/package.json` | Exact library versions (three 0.186.1, React 19.3, Vite 8.3.4, mediabunny 1.61.4) |
| `frontend/scripts/build-fly-model.mjs` | OBJ → compressed GLB conversion |

## 4 · Simulation and data pipeline (Python)

| File | What it does |
|---|---|
| `backend/flybrain/engine_fast.py` | Numba simulation of the whole 127,400-neuron model (validated) |
| `backend/flybrain/engine_brian2.py` | Runs the unmodified original model on Brian2 (reference) |
| `backend/flybrain/upstream.py` | Pinned upstream commit, dataset checksums, parameters, provenance |
| `backend/flybrain/neurons.py` + `data/sez_cell_types_v630.json` | Verified neuron IDs (sugar GRNs, MN9, Roundup and other cell types) |
| `backend/flybrain/network.py` | Loads the connectome into a sparse matrix |
| `backend/flybrain/experiment.py`, `metrics.py`, `runs.py` | Experiment settings, rates, comparisons, exports |
| `backend/flybrain/brain.py` | Neuron positions for the 3D view |
| `backend/flybrain/arena/` | Hybrid arena: environment, encoder, decoder, handcrafted controller |
| `backend/flybrain/api.py`, `jobs.py` | Local web API and background worker |
| `scripts/export_site_data.py` | Writes all website data (section 2) |
| `scripts/fetch_upstream.py`, `scripts/fetch_positions.py` | Download and checksum the model, connectome and positions |
| `scripts/validate_*.py`, `scripts/benchmark.py`, `scripts/build_replay.py` | Validation, timing, replay generation |
| `backend/requirements.txt` | Exact Python package versions |

**Not in the bundles**, because they are too large, third-party or rebuilt by scripts:
- `upstream/`: the original model and FlyWire data, about 200 MB;
- `assets/source/housefly_tripo.obj`: the 38 MB original fly mesh;
- `data/cache/`, `node_modules/`, `.venv/`, `dist/` and `dist-site/`.
