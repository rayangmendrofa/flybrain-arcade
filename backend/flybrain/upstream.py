# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
# This file pins and verifies the upstream repository and reads its model parameters.
"""Upstream model adapter: locating, verifying and loading the Shiu et al. model.

Single source of truth for:
- where the upstream repository lives and which commit it must be at,
- which dataset files are used (FlyWire public materialization v630, as
  packaged in the upstream repository) and their SHA-256 checksums,
- the model parameters, read from the upstream ``model.default_params``
  (never re-typed here), converted to SI floats for the fast engine.

Nothing in this module modifies upstream code or data.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]

UPSTREAM_REPO_URL = "https://github.com/philshiu/Drosophila_brain_model"
UPSTREAM_COMMIT = "91bdd1e7dcf193f3e7ca5a8933497fcef63b7960"
UPSTREAM_COMMIT_DATE = "2024-09-14"
UPSTREAM_LICENCE = "MIT License, Copyright (c) 2023 Philip Shiu and Nico Spiller"

PAPER_CITATION = (
    "Shiu, P.K., Sterne, G.R., Spiller, N. et al. A Drosophila computational brain model "
    "reveals sensorimotor processing. Nature 634, 210-219 (2024). "
    "https://doi.org/10.1038/s41586-024-07763-9"
)
PAPER_LICENCE = "Creative Commons Attribution 4.0 International (article text and figures)"

# The paper (Methods, "Computational model") states that all 127,400 proofread
# neurons of FlyWire public materialization v630 are included. The upstream
# example notebook and figures.ipynb use these exact two files.
DATASET_ID = "flywire-v630-shiu2024"
DATASET_LABEL = "FlyWire public materialization v630 (connectivity as packaged by Shiu et al.)"
DATASET_FILES = {
    "completeness": (
        "2023_03_23_completeness_630_final.csv",
        "479ed718404e7b1d898ee9a353410f481e6ed7694c30f579a7c2699f1c708a5d",
    ),
    "connectivity": (
        "2023_03_23_connectivity_630_final.parquet",
        "94db8c650533bc36ffa3223f2e62325d5648b8d6bd31c3a4e1c804628c7557b3",
    ),
}
UPSTREAM_CODE_FILES = {
    "model.py": "b879a8a286f367165e3effa6d47562cac289333c977be7716ccb646067326cce",
    "sez_neurons.pickle": "2bc5a2a8289924f2de39a8e68bdc07025cb6d6c6c6ddc83a973c0cace7cec2ce",
}
# Reference outputs shipped by upstream (results/example), produced with v630.
UPSTREAM_REFERENCE_RESULTS = {
    "sugarR": "83921d50089d966785e402d6c0e3be5ab3eba5beb680410a09c557b0f22dcc28",
    "sugarR_100Hz": "93722ec03c3faa5a85790d77ed16bdd7f1e38a7c847ed0bc3af3dc2e4d0c3d34",
}

# Brian2 default clock step. Upstream model.py does not set dt, so Brian2's
# default (0.1 ms) applies; the paper does not state dt.
BRIAN2_DEFAULT_DT_S = 1e-4


def upstream_dir() -> Path:
    env = os.environ.get("FLYBRAIN_UPSTREAM_DIR")
    if env:
        return Path(env).resolve()
    return PROJECT_ROOT / "upstream" / "Drosophila_brain_model"


def cache_dir() -> Path:
    d = Path(os.environ.get("FLYBRAIN_CACHE_DIR", PROJECT_ROOT / "data" / "cache"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def _cached_sha256(path: Path) -> str:
    """SHA-256 with a small stamp cache keyed by (size, mtime)."""
    stamp_path = cache_dir() / "sha256_stamps.json"
    try:
        stamps = json.loads(stamp_path.read_text())
    except (OSError, ValueError):
        stamps = {}
    st = path.stat()
    key = str(path.resolve())
    rec = stamps.get(key)
    if rec and rec["size"] == st.st_size and rec["mtime"] == st.st_mtime:
        return rec["sha256"]
    digest = sha256_file(path)
    stamps[key] = {"size": st.st_size, "mtime": st.st_mtime, "sha256": digest}
    try:
        stamp_path.write_text(json.dumps(stamps, indent=1))
    except OSError:
        pass
    return digest


def git_head(path: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


@dataclass
class UpstreamStatus:
    available: bool
    directory: str
    commit: str | None
    commit_matches: bool
    files: dict
    problems: list[str]

    def as_dict(self) -> dict:
        return self.__dict__.copy()


@lru_cache(maxsize=1)
def check_upstream() -> UpstreamStatus:
    """Verify that the upstream repo and the v630 dataset files are present and unmodified."""
    root = upstream_dir()
    problems: list[str] = []
    files: dict[str, dict] = {}
    if not root.is_dir():
        return UpstreamStatus(False, str(root), None, False, {}, [
            f"Upstream repository not found at {root}. Run `python scripts/fetch_upstream.py`."
        ])
    commit = git_head(root)
    commit_ok = commit == UPSTREAM_COMMIT
    if commit is None:
        problems.append("Could not read upstream git commit (git missing or not a clone).")
    elif not commit_ok:
        problems.append(f"Upstream is at commit {commit}, expected {UPSTREAM_COMMIT}.")
    expected = {name: digest for name, digest in DATASET_FILES.values()}
    expected.update(UPSTREAM_CODE_FILES)
    for name, digest in expected.items():
        p = root / name
        if not p.is_file():
            files[name] = {"present": False}
            problems.append(f"Missing upstream file {name}.")
            continue
        actual = _cached_sha256(p)
        ok = actual == digest
        files[name] = {"present": True, "sha256": actual, "matches": ok, "bytes": p.stat().st_size}
        if not ok:
            problems.append(f"Checksum mismatch for {name}.")
    available = all(f.get("matches") for f in files.values()) and len(files) == len(expected)
    return UpstreamStatus(available, str(root), commit, commit_ok, files, problems)


def import_upstream_model() -> ModuleType:
    """Import the unmodified upstream ``model.py`` as module ``shiu_model``.

    Importing it imports Brian2 (a few seconds on first import).
    """
    if "shiu_model" in sys.modules:
        return sys.modules["shiu_model"]
    path = upstream_dir() / "model.py"
    spec = importlib.util.spec_from_file_location("shiu_model", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import upstream model from {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["shiu_model"] = mod
    spec.loader.exec_module(mod)
    return mod


@dataclass(frozen=True)
class ModelParams:
    """Upstream ``default_params`` in SI units (seconds, volts, hertz)."""

    t_run: float
    n_run: int
    v_0: float
    v_rst: float
    v_th: float
    t_mbr: float
    tau: float
    t_rfc: float
    t_dly: float
    w_syn: float
    r_poi: float
    r_poi2: float
    f_poi: float
    eqs: str
    eq_th: str
    eq_rst: str
    dt: float = BRIAN2_DEFAULT_DT_S

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@lru_cache(maxsize=1)
def upstream_params() -> ModelParams:
    """Read ``default_params`` from upstream model.py and strip Brian2 units."""
    mod = import_upstream_model()
    p = mod.default_params

    def si(q) -> float:
        return float(np.asarray(q))

    return ModelParams(
        t_run=si(p["t_run"]), n_run=int(p["n_run"]),
        v_0=si(p["v_0"]), v_rst=si(p["v_rst"]), v_th=si(p["v_th"]),
        t_mbr=si(p["t_mbr"]), tau=si(p["tau"]), t_rfc=si(p["t_rfc"]), t_dly=si(p["t_dly"]),
        w_syn=si(p["w_syn"]), r_poi=si(p["r_poi"]), r_poi2=si(p["r_poi2"]), f_poi=float(p["f_poi"]),
        eqs=p["eqs"].strip(), eq_th=p["eq_th"], eq_rst=p["eq_rst"],
    )


def brian2_timestep(t: float, dt: float) -> int:
    """Same rounding as ``brian2.core.functions.timestep``."""
    return int(np.int64((t + 1e-3 * dt) / dt))


def dataset_paths() -> tuple[Path, Path]:
    root = upstream_dir()
    return root / DATASET_FILES["completeness"][0], root / DATASET_FILES["connectivity"][0]


def provenance_record() -> dict:
    """Machine-readable record of model code, dataset and licences."""
    st = check_upstream()
    return {
        "model": {
            "name": "Shiu et al. whole-brain leaky integrate-and-fire model",
            "repository": UPSTREAM_REPO_URL,
            "commit_expected": UPSTREAM_COMMIT,
            "commit_found": st.commit,
            "commit_date": UPSTREAM_COMMIT_DATE,
            "licence": UPSTREAM_LICENCE,
            "paper": PAPER_CITATION,
            "paper_licence": PAPER_LICENCE,
        },
        "dataset": {
            "id": DATASET_ID,
            "label": DATASET_LABEL,
            "files": {k: {"name": n, "sha256": d} for k, (n, d) in DATASET_FILES.items()},
            "neuron_id_system": "FlyWire root IDs of materialization v630 (not valid for v783 or MaleCNS)",
        },
        "upstream_status": st.as_dict(),
    }
