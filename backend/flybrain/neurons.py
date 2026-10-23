"""Verified neuron identifiers (FlyWire v630 root IDs) and the ID <-> index catalog.

Every identifier here is copied from the upstream repository at the pinned
commit; the ``source`` strings say exactly where. No neuron is named here
that is not named in upstream code or data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from . import upstream

# example.ipynb ("sugar-sensing neurons in the right hemisphere") and
# figures.ipynb Fig. 1D/3A/4E ("labellar sugar-sensing gustatory receptor
# neurons on right hemisphere"). NOTE: the paper's Methods state unilateral
# *left* hemisphere activation was used; the hemisphere wording differs between
# code comments and paper, and this app does not resolve it.
SUGAR_GRNS_UPSTREAM: tuple[int, ...] = (
    720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
    720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
    720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
    720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
    720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
    720575940611875570,
)
SUGAR_GRNS_SOURCE = "upstream example.ipynb `neu_sugar`; figures.ipynb Fig. 1D (21 labellar sugar GRNs)"

# figures.ipynb Fig. 1E/1F and example.ipynb use this ID as "MN9". Paper Methods:
# "when describing MN9 activity, we refer to the MN9 contralateral to the GRNs activated."
MN9_CONTRA = 720575940660219265
# figures.ipynb Fig. 2: ids_mn9 = [720575940660219265, 720575940645521262]  # left and right
MN9_OTHER = 720575940645521262

OUTPUTS = {
    MN9_CONTRA: {
        "name": "MN9 (Fig. 1 readout)",
        "short": "MN9-c",
        "source": "upstream example.ipynb `id_mn9`; figures.ipynb Fig. 1E/1F",
        "side_note": "Paper default MN9 readout: contralateral to the stimulated sugar GRNs.",
    },
    MN9_OTHER: {
        "name": "MN9 (other hemisphere)",
        "short": "MN9-i",
        "source": "upstream figures.ipynb Fig. 2 `ids_mn9` (pair listed as 'left and right')",
        "side_note": "Inferred ipsilateral partner of the Fig. 1 MN9 (application inference from the Fig. 2 pair).",
    },
}

FEEDING_OUTPUT_DESCRIPTION = (
    "MN9 is a proboscis motor neuron that 'controls rostrum lifting during proboscis extension' "
    "(Shiu et al. 2024). The paper notes the exact relation between MN9 firing rate and rostrum "
    "lifting is not known and assumes higher MN9 rates correspond to higher rostrum-lifting probability."
)

# Cell types drawn in the paper's Fig. 1b feeding-initiation circuit that also
# appear (with v630 IDs) in upstream sez_neurons.pickle. Sternum, Roundtree,
# Rounddown and Zorro are in Fig. 1b but have no IDs in the upstream files,
# so they are not offered.
FIG1B_TYPES_WITH_IDS = ("G2N_1", "rattle", "usnea", "FMIn", "bract", "Fdg", "roundup", "clavicle")
# Discussed in the paper text in relation to the sugar circuit / MN9.
PAPER_DISCUSSED_TYPES = ("phantom",)

_SEZ_JSON = Path(__file__).with_name("data") / "sez_cell_types_v630.json"


@lru_cache(maxsize=1)
def sez_cell_types() -> dict:
    return json.loads(_SEZ_JSON.read_text())


@dataclass
class Catalog:
    ids: np.ndarray  # int64 FlyWire root IDs; position = model index ("Brian ID")

    def __post_init__(self) -> None:
        self._index = {int(f): i for i, f in enumerate(self.ids)}

    @property
    def n(self) -> int:
        return len(self.ids)

    def has(self, flyid: int) -> bool:
        return int(flyid) in self._index

    def index_of(self, flyid: int) -> int:
        try:
            return self._index[int(flyid)]
        except KeyError:
            raise KeyError(f"FlyWire ID {flyid} is not in dataset {upstream.DATASET_ID}") from None

    def id_of(self, index: int) -> int:
        return int(self.ids[index])


@lru_cache(maxsize=1)
def catalog() -> Catalog:
    """Index order = row order of the completeness CSV, as in upstream ``run_exp``."""
    path_comp, _ = upstream.dataset_paths()
    df = pd.read_csv(path_comp, index_col=0)
    return Catalog(ids=df.index.to_numpy(dtype=np.int64))


def silencing_groups() -> list[dict]:
    """Verified neuron groups that can be silenced, with their sources."""
    types = sez_cell_types()["cell_types"]
    groups = []
    for key in FIG1B_TYPES_WITH_IDS + PAPER_DISCUSSED_TYPES:
        groups.append({
            "key": f"type:{key}",
            "label": key.replace("_", "-"),
            "ids": [str(i) for i in types[key]],
            "source": "upstream sez_neurons.pickle (figures.ipynb Fig. 2 cell types)",
            "paper_context": (
                "Drawn in paper Fig. 1b feeding-initiation circuit"
                if key in FIG1B_TYPES_WITH_IDS else "Discussed in paper text (sugar circuit / MN9)"
            ),
        })
    groups.append({
        "key": "sugar_grns",
        "label": "All 21 sugar GRNs (control)",
        "ids": [str(i) for i in SUGAR_GRNS_UPSTREAM],
        "source": SUGAR_GRNS_SOURCE,
        "paper_context": "Control: removes all output of the stimulated neurons.",
    })
    return groups


def all_cell_types() -> list[dict]:
    types = sez_cell_types()["cell_types"]
    return [{"key": f"type:{k}", "label": k, "ids": [str(i) for i in v]} for k, v in sorted(types.items(), key=lambda kv: kv[0].lower())]
