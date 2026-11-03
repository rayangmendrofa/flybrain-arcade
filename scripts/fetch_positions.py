"""Fetch the v630 neuron annotations (positions) used by the 3D brain view.

Downloads Supplemental_file1_annotations.tsv (~22 MB) from flyconnectome/flywire_annotations
at the commit of tag v1.1.0, the last release keyed to FlyWire v630 root IDs, and verifies
its SHA-256. The positions only place dots in the visualisation; the simulation never uses them.

Usage: python scripts/fetch_positions.py
"""

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from flybrain import brain, upstream  # noqa: E402


def main() -> None:
    dest = brain.annotations_path()
    if dest.exists() and upstream.sha256_file(dest) == brain.ANNOT_SHA256:
        print(f"Already present and verified: {dest}")
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        print(f"Downloading {brain.raw_url()}")
        urllib.request.urlretrieve(brain.raw_url(), tmp)
        digest = upstream.sha256_file(tmp)
        if digest != brain.ANNOT_SHA256:
            tmp.unlink()
            sys.exit(f"Checksum mismatch: got {digest}, expected {brain.ANNOT_SHA256}")
        tmp.replace(dest)
        print(f"Verified and saved: {dest}")
    atlas = brain.load_atlas()
    m = atlas.meta
    print(f"{m['n_with_position']:,} of {m['n_neurons']:,} model neurons have a position "
          f"({m['n_without_position']} without; {m['n_rejected_outliers']} outliers dropped).")


if __name__ == "__main__":
    main()
