# Notices

## Upstream model code

FlyBrain Arcade runs, and contains a port of the per-step update of, the model in
<https://github.com/philshiu/Drosophila_brain_model> (commit `91bdd1e7dcf193f3e7ca5a8933497fcef63b7960`).
The upstream repository is fetched into `upstream/` and is not modified. Its licence:

```
MIT License

Copyright (c) 2023 Philip Shiu and Nico Spiller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`backend/flybrain/data/sez_cell_types_v630.json` is a JSON conversion of upstream
`sez_neurons.pickle` (same content; source SHA-256 recorded inside the file).

## Paper

Shiu, P.K., Sterne, G.R., Spiller, N. et al. *A Drosophila computational brain model reveals
sensorimotor processing.* Nature 634, 210–219 (2024). <https://doi.org/10.1038/s41586-024-07763-9>.
The article is published under a Creative Commons Attribution 4.0 International licence.

## Connectome data

The connectivity files (FlyWire public materialization v630, as packaged by the upstream
repository) are **not** redistributed here; `scripts/fetch_upstream.py` obtains them from the
upstream repository. The upstream repository does not state a separate licence for these files.
Use of FlyWire data is governed by FlyWire / Codex terms: check <https://codex.flywire.ai/about_codex>
and the FlyWire citation guidelines before reuse, and cite Dorkenwald et al., *Nature* (2024) and
Schlegel et al., *Nature* (2024). (A third-party listing tags FlyWire neuron data as CC BY-NC 4.0;
this was not confirmed against FlyWire's own terms.)

`replays/` contains simulation outputs (spike times of the model) computed from these data,
not connectome data.

## Neuron positions (3D brain view)

`scripts/fetch_positions.py` downloads `Supplemental_file1_annotations.tsv` from
<https://github.com/flyconnectome/flywire_annotations> at tag v1.1.0 (commit
`df6bb136f5b3d91c3992df4e8de2642329e2a384`, the last release keyed to FlyWire v630 IDs) into
`upstream/` (git-ignored). Cite Schlegel et al., *Whole-brain annotation and multi-connectome cell
typing of Drosophila*, Nature 634, 139–152 (2024). **The repository has no licence file.** The
static page (`frontend/site/public/data/atlas.bin`) contains positions derived from it: confirm
reuse terms with the authors / FlyWire before publishing the page.

## 3D fly model

`frontend/public/models/housefly.glb` (and the copy in `frontend/site/public/models/`) is a
simplified version of a house-fly mesh generated with Tripo AI and supplied by the project owner.
The 38 MB source (`assets/source/`) is git-ignored. Check Tripo's terms for the account that
generated it before redistributing the model publicly.

## Libraries added for the 3D views and video

three.js 0.186.1 (MIT), gltfpack 1.3.0 / meshoptimizer (MIT; build tool only), mediabunny 1.61.4
(MPL-2.0; used only by the development video studio, not shipped in the page build).
