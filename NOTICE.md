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
