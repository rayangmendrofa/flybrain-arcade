# 3D visualisation, brain view, video and showcase page

Everything on this page is presentation. It never feeds back into the simulation. Each item says
whether it is **DATA**, **MODEL** or **APP** (an application choice).

## 3D fly (APP)

- **Source asset:** `assets/source/housefly_tripo.obj` (git-ignored, 37.8 MB, SHA-256 `b1e3ab17…`).
  It was generated with Tripo AI and supplied by the project owner. It is one fused mesh with
  per-vertex colours and no parts, UVs or skeleton.
- **Species:** it depicts a **house fly** (*Musca*-like), not *Drosophila*. It is used as a stylised
  illustration only.
- **Web version:** `npm run build:fly` writes `frontend/public/models/housefly.glb` (≈0.5 MB). It
  uses gltfpack 1.3.0 with `-si 0.2 -cc`: meshoptimizer simplification to ~98k triangles,
  quantisation and `EXT_meshopt_compression`. `housefly.json` records the checksums of both files.
- **Fixes applied at load** (`frontend/src/three/scene.ts`):
  - gltfpack copies the OBJ's sRGB vertex colours into glTF's linear `COLOR_0`, so they are
    converted back to linear.
  - The mesh's body axis is turned about 34.6° from +z. This was measured from the red eye
    vertices and the brown abdomen vertices. It is rotated so the head faces +z on the midline
    (`MODEL_ALIGN`).
- **Anatomical anchors** (`ANCHORS`): mouth, head centre and eye-to-eye width. These were measured
  on the aligned mesh from slices along the body axis.

## Proboscis (MODEL → APP)

The mesh's own mouthparts are fused into the head, so a jointed proboscis is modelled separately
(`frontend/src/three/proboscis.ts`). It has a rostrum, a haustellum and a two-lobed labellum, and
is attached under the head.

- **Driver.** It is driven by one number: the extension fraction *e* from the documented MN9
  mapping in `lib/mapping.ts`. That mapping smooths the rate with τ = 50 ms and ramps from 5 Hz
  to 100 Hz.
- **Joint sequencing (APP).** How *e* is shared across the joints is a display choice:
  - the rostrum moves over *e* 0–0.6;
  - the haustellum unfolds over *e* 0.15–0.85;
  - the labellum opens over *e* 0.55–1.

  The paper only states that MN9 "controls rostrum lifting during proboscis extension".
- **Sugar cube.** It sits where the fully extended labellum ends. With the stimulus on, the syrup
  drop glows.

## Brain view (DATA positions, MODEL spikes, APP drawing)

- **Positions (DATA).**
  - Source: `flyconnectome/flywire_annotations` at tag **v1.1.0** (commit `df6bb13…`), file
    `Supplemental_file1_annotations.tsv`, SHA-256 `55c99c61…`. Fetch it with
    `python scripts/fetch_positions.py`.
  - Why this tag: the repository documents that its `root_id` column is the FlyWire **630** release
    ID. Later tags use v783 IDs and are deliberately not used.
  - Matching: neurons are matched to the model by **exact v630 root ID**, with no ID translation.
    127,320 of 127,400 model neurons have a position. 78 are missing from the annotations, and 2
    anchors lie far outside the brain and are dropped.
  - Coordinates: the `pos_x/y/z` anchor point (on the neuron's backbone) is used, in 4×4×40 nm
    voxels.
  - Axes: FAFB +x is the fly's right. This was checked: neurons annotated `side=right` have larger
    x. +y is ventral and +z posterior. In the 3D scene the cloud is turned to face forward and
    scaled to 90% of the head width. It is a *Drosophila* brain drawn inside a stylised house-fly
    head. The UI and the video say so.
- **Spikes (MODEL).**
  - `GET /api/runs/{id}/brain?trial=k` returns every spike of one trial, sorted by time.
  - The static page uses trial 1 of the bundled replay.
  - The proboscis follows the trial-averaged MN9 rate, as in the 2D stage.
- **Drawing (APP).**
  - Each spike makes its neuron's dot flash, then fade with a 12 ms time constant.
  - Colours: the 21 stimulated sugar GRNs are blue, the two MN9s pink, silenced neurons grey.
  - In the head view the body becomes an x-ray outline that keeps only the rim lighting.

## Legs and gait (APP, arena only)

The brain dataset has no nerve cord, so the model cannot move legs. The arena's walking comes from
the handcrafted controller (see [arena.md](arena.md)). The page makes the legs step so the walking
reads naturally.

- **Leg detection** (`frontend/src/three/legs.ts`), with no skeleton involved:
  - every triangle entirely below y = 0.15 is grouped by connectivity;
  - the six groups that reach the floor are the lower legs;
  - they are named L1–L3 and R1–R3 from their side and front-to-back order;
  - each vertex is displaced in the vertex shader by its leg's foot offset, weighted from 0 at the
    cut to 1 at the floor. The same applies to the shadow pass.
- **Gait** (`frontend/src/three/gait.ts`, unit-tested in `gait.test.ts`):
  - an alternating tripod: L1, R2 and L3 move together, half a cycle out of phase with R1, L2
    and R3;
  - duty factor 0.55;
  - step frequency 1.5 Hz + 1.4 × (body lengths per s).

  This resembles fly walking qualitatively (Wosnitza et al. 2013; Mendes et al. 2013), but the
  constants are display choices, not fitted values.
- **Determinism.** Gait phase is the integral of step frequency over the recorded controller
  speed, so any frame can be drawn on its own.
- **Scale.** The arena is drawn with a 2.5 mm body length, so the controller's millimetres and
  speeds keep their proportions.
- **Overlays.**
  - "Colour by who drives what" tints the legs pink (APP) and the proboscis yellow (MODEL via
    MN9).
  - "Show only what the brain model decides" freezes everything the controller moves, leaving only
    the proboscis.

## Video (APP rendering of MODEL output)

- **Sequence.** `frontend/src/site/story.ts` defines a 76 s sequence:
  - a title card;
  - sugar on;
  - into the head, then 1 s of simulated time shown 20× slower;
  - back out;
  - the same experiment with Roundup silenced;
  - an end card with the paired comparison and credits.

  It is a pure function of video time.
- **Studio.** `site/#studio` is available only in the dev server (`npm run dev:site`).
  - It renders each frame at 1920×1080, 30 fps, whatever the machine speed.
  - It draws the captions and readouts onto a 2D canvas.
  - It encodes with WebCodecs through mediabunny 1.61.4: H.264 MP4, or VP9 WebM if H.264 is not
    available.
  - A dev-only Vite endpoint saves the file to `frontend/site/public/media/`.
- **Labels.** Every frame is labelled "SIMULATION REPLAY · not recorded data". It also names the
  run and states the slow-motion factor and the extension-mapping range.

## Showcase page (gelastinta.com)

- **What it is.** `frontend/site/` is a separate static build. It needs no backend: all data is
  precomputed.
- **Commands:**

  ```bash
  .venv/Scripts/python scripts/export_site_data.py
  ```

  This writes `frontend/site/public/data/`:
  - neuron positions;
  - the sugar/Roundup replay with every spike of trial 1;
  - the comparison;
  - two 15 s arena episodes;
  - `manifest.json` with provenance.

  ```bash
  cd frontend && npm run build:site
  ```

  This produces `frontend/dist-site/`, about 3.5 MB plus the video. All URLs are relative, so it
  can be served from any sub-path, e.g. `gelastinta.com/flybrain/`.
- **Sections:**
  - the map (DATA);
  - a single-neuron widget using the model's own equations and parameters;
  - the 3D replay explorer;
  - per-trial silencing bars;
  - the hybrid arena;
  - an explicit "what this does and doesn't show" list;
  - sources and credits.
- **Before publishing**, confirm the licences flagged in [../NOTICE.md](../NOTICE.md):
  - the FlyWire data;
  - `flywire_annotations`, which has no licence file;
  - the Tripo-generated model.
