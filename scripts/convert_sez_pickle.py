# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
# This script converts upstream's sez_neurons.pickle to JSON.
"""Convert upstream ``sez_neurons.pickle`` to JSON once, so the app never unpickles at runtime.

The pickle is the {cell type: [FlyWire v630 root IDs]} mapping used by upstream
figures.ipynb (Figure 2: SEZ split-GAL4 cell types). The file's SHA-256 is
checked against the pinned upstream value before loading.
"""

import json
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from flybrain import upstream  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "backend" / "flybrain" / "data" / "sez_cell_types_v630.json"


def main() -> None:
    src = upstream.upstream_dir() / "sez_neurons.pickle"
    digest = upstream.sha256_file(src)
    if digest != upstream.UPSTREAM_CODE_FILES["sez_neurons.pickle"]:
        sys.exit(f"Refusing to unpickle {src}: checksum {digest} does not match the pinned upstream file.")
    with open(src, "rb") as f:
        data = pickle.load(f)
    out = {
        "source": {
            "repository": upstream.UPSTREAM_REPO_URL,
            "commit": upstream.UPSTREAM_COMMIT,
            "file": "sez_neurons.pickle",
            "sha256": digest,
            "used_in": "figures.ipynb, Figure 2 (activation of SEZ cell types, MN9 readout)",
            "dataset": upstream.DATASET_ID,
        },
        "cell_types": {k: [int(x) for x in v] for k, v in data.items()},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"Wrote {len(out['cell_types'])} cell types to {OUT}")


if __name__ == "__main__":
    main()
