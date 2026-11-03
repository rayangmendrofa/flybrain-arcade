# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Neuron positions for the 3D brain view, matched to the model by exact FlyWire v630 root ID.

Source: flyconnectome/flywire_annotations at tag v1.1.0 (Schlegel et al. 2024), whose
``Supplemental_files_columns.md`` states that ``root_id`` "is the ID of the neuron in the
FlyWire `630` release" and that ``pos_x/pos_y/pos_z`` are "anchor coordinates in 4x4x40nm
voxel space (typically on the backbone of the neuron)". Later tags of that repository use
v783 IDs and are deliberately not used: no ID translation between releases happens here.

Positions are used only to place dots in a visualisation. They play no part in the simulation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from . import neurons, upstream

ANNOT_REPO_URL = "https://github.com/flyconnectome/flywire_annotations"
ANNOT_TAG = "v1.1.0"
ANNOT_COMMIT = "df6bb136f5b3d91c3992df4e8de2642329e2a384"
ANNOT_FILE = "Supplemental_file1_annotations.tsv"
ANNOT_SHA256 = "55c99c61eecf8db6cc36f1a684b35e4c4208afbab02197d753ccc8dc2a6e2e76"
ANNOT_CITATION = (
    "Schlegel, P., Yin, Y., Bates, A.S. et al. Whole-brain annotation and multi-connectome cell typing "
    "of Drosophila. Nature 634, 139-152 (2024). https://doi.org/10.1038/s41586-024-07686-5"
)
VOXEL_NM = np.array([4.0, 4.0, 40.0])
# Anchors further than this outside the 0.1-99.9 percentile box are treated as invalid
# (3 rows in v1.1.0 have coordinates several times larger than the brain).
OUTLIER_MARGIN_UM = 50.0
MISSING = 65535

ATLAS_VERSION = 1


def annotations_path() -> Path:
    return upstream.PROJECT_ROOT / "upstream" / f"flywire_annotations_{ANNOT_TAG}" / ANNOT_FILE


def raw_url() -> str:
    return f"https://raw.githubusercontent.com/flyconnectome/flywire_annotations/{ANNOT_COMMIT}/supplemental_files/{ANNOT_FILE}"


@dataclass
class Atlas:
    pos_um: np.ndarray  # (n, 3) float32, FAFB axes in micrometres, NaN where unknown
    super_class: np.ndarray  # (n,) uint8 index into class_names (0 = unknown)
    class_names: list[str]
    meta: dict

    @property
    def n(self) -> int:
        return len(self.pos_um)


def available() -> bool:
    return annotations_path().exists()


def _build(path: Path) -> Atlas:
    digest = upstream.sha256_file(path)
    if digest != ANNOT_SHA256:
        raise RuntimeError(f"{path.name}: SHA-256 {digest} does not match the pinned {ANNOT_SHA256}")
    cat = neurons.catalog()
    a = pd.read_csv(path, sep="\t", usecols=["root_id", "pos_x", "pos_y", "pos_z", "super_class", "side"],
                    dtype={"root_id": np.int64})
    a = a.drop_duplicates("root_id")
    um = a[["pos_x", "pos_y", "pos_z"]].to_numpy(float) * VOXEL_NM / 1000.0
    lo, hi = np.percentile(um, 0.1, axis=0) - OUTLIER_MARGIN_UM, np.percentile(um, 99.9, axis=0) + OUTLIER_MARGIN_UM
    bad = np.any((um < lo) | (um > hi), axis=1)

    # Axis directions, checked against the annotations rather than assumed.
    side = a["side"].to_numpy()
    x_right, x_left = um[(side == "right") & ~bad, 0].mean(), um[(side == "left") & ~bad, 0].mean()
    if not x_right > x_left:
        raise RuntimeError("unexpected FAFB x orientation (side=right should have larger x)")

    class_names = ["unknown"] + sorted(a["super_class"].dropna().unique().tolist())
    cls_code = {c: k for k, c in enumerate(class_names)}
    pos = np.full((cat.n, 3), np.nan, np.float32)
    cls = np.zeros(cat.n, np.uint8)
    matched = invalid = 0
    for rid, p, sc, b in zip(a["root_id"].to_numpy(), um, a["super_class"].to_numpy(), bad):
        if not cat.has(rid):
            continue
        k = cat.index_of(rid)
        if b:
            invalid += 1
            continue
        pos[k] = p
        cls[k] = cls_code.get(sc, 0) if isinstance(sc, str) else 0
        matched += 1
    meta = {
        "atlas_version": ATLAS_VERSION,
        "dataset": upstream.DATASET_ID,
        "n_neurons": int(cat.n),
        "n_with_position": int(matched),
        "n_without_position": int(cat.n - matched),
        "n_rejected_outliers": int(invalid),
        "matching": "exact FlyWire v630 root ID (no ID translation)",
        "source": {
            "repository": ANNOT_REPO_URL, "tag": ANNOT_TAG, "commit": ANNOT_COMMIT, "file": ANNOT_FILE,
            "sha256": ANNOT_SHA256, "citation": ANNOT_CITATION,
            "columns": "pos_x/pos_y/pos_z: anchor point on the neuron's backbone, 4x4x40 nm voxels",
            "licence": "No licence file in the repository; check before redistributing (see NOTICE.md).",
        },
        "units": "micrometres (voxel x 4/4/40 nm)",
        "axes": "FAFB: +x towards the fly's right (checked: side=right has larger x), +y ventral, +z posterior",
        "outlier_rule": f"anchors more than {OUTLIER_MARGIN_UM:g} um outside the 0.1-99.9 percentile box are dropped",
        "class_names": class_names,
    }
    return Atlas(pos, cls, class_names, meta)


@lru_cache(maxsize=1)
def load_atlas() -> Atlas:
    path = annotations_path()
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing; run scripts/fetch_positions.py")
    cache = upstream.cache_dir() / f"brain_atlas_v630_{ANNOT_TAG}_a{ATLAS_VERSION}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        return Atlas(z["pos"], z["cls"], meta["class_names"], meta)
    atlas = _build(path)
    np.savez_compressed(cache, pos=atlas.pos_um, cls=atlas.super_class, meta=json.dumps(atlas.meta))
    return atlas


def atlas_binary(atlas: Atlas) -> tuple[bytes, dict]:
    """Quantised positions for the browser: uint16 x/y/z per neuron (65535 = no position), then uint8 class."""
    p = atlas.pos_um
    ok = ~np.isnan(p[:, 0])
    lo, hi = p[ok].min(axis=0), p[ok].max(axis=0)
    q = np.full(p.shape, MISSING, np.uint16)
    q[ok] = np.round((p[ok] - lo) / (hi - lo) * (MISSING - 1)).astype(np.uint16)
    layout = {"positions": "uint16[n*3] little-endian, x/y/z interleaved; value v -> lo + v/65534*(hi-lo) um; 65535 = none",
              "classes": "uint8[n] index into class_names, immediately after positions"}
    meta = atlas.meta | {"lo_um": lo.round(3).tolist(), "hi_um": hi.round(3).tolist(), "layout": layout}
    return q.astype("<u2").tobytes() + atlas.super_class.tobytes(), meta


def run_activity(run, trial: int) -> dict:
    """All spikes of one trial, sorted by time, plus the neuron roles the view highlights."""
    if run.engine == "synthetic":
        raise ValueError("The brain view needs the published network; the synthetic demo has no neuron positions.")
    n_trials = len(run.raw["spike_neuron"])
    if not 0 <= trial < n_trials:
        raise IndexError(f"trial must be in 0..{n_trials - 1}")
    sn = np.asarray(run.raw["spike_neuron"][trial])
    ss = np.asarray(run.raw["spike_step"][trial])
    order = np.lexsort((sn, ss))
    dt_ms = run.raw["dt"] * 1000.0
    cat = neurons.catalog()
    silenced = [cat.index_of(int(i)) for i in run.config.silenced_ids if not str(i).startswith("SYN-")]
    stim = [cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM] if run.config.stimulus.rate_hz > 0 else []
    return {
        "run_id": run.id,
        "trial": trial,
        "n_trials": n_trials,
        "duration_ms": run.config.duration_ms,
        "dt_ms": dt_ms,
        "n_spikes": int(len(sn)),
        "neuron": sn[order].astype(int).tolist(),
        "t_ms": np.round(ss[order] * dt_ms, 2).tolist(),
        "roles": {
            "sugar_grns": stim,
            "mn9": [cat.index_of(neurons.MN9_CONTRA), cat.index_of(neurons.MN9_OTHER)],
            "silenced": silenced,
        },
        "schedule": {"onset_ms": run.config.stimulus.onset_ms,
                     "offset_ms": run.config.stimulus.offset_ms if run.config.stimulus.offset_ms is not None else run.config.duration_ms,
                     "rate_hz": run.config.stimulus.rate_hz},
        "note": "Simulated spikes of the Shiu et al. model (one trial). Not recorded biological activity.",
    }
