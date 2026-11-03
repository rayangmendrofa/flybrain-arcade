# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
# This script downloads the upstream repository at a pinned commit.
"""Fetch the upstream Shiu et al. repository (code + FlyWire v630 files) at the pinned commit.

The upstream repository itself contains the connectivity data used by the
paper (2023_03_23_completeness_630_final.csv, 2023_03_23_connectivity_630_final.parquet,
about 90 MB), so a git clone is the complete data acquisition step. Files are
verified against pinned SHA-256 checksums; nothing is modified.

Usage: python scripts/fetch_upstream.py [--dir upstream/Drosophila_brain_model]
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from flybrain import upstream  # noqa: E402


def run(*cmd: str) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, default=upstream.upstream_dir())
    a = ap.parse_args()
    d: Path = a.dir
    if not d.exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        run("git", "clone", upstream.UPSTREAM_REPO_URL + ".git", str(d))
    run("git", "-C", str(d), "fetch", "--quiet", "origin")
    run("git", "-C", str(d), "checkout", "--quiet", upstream.UPSTREAM_COMMIT)
    upstream.check_upstream.cache_clear()
    st = upstream.check_upstream()
    for name, info in st.files.items():
        mark = "OK " if info.get("matches") else "BAD"
        print(f"  [{mark}] {name}")
    if not st.available:
        sys.exit("Upstream verification failed: " + "; ".join(st.problems))
    print(f"Upstream ready at {d} (commit {st.commit}).")


if __name__ == "__main__":
    main()
