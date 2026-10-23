"""Connectivity loading: upstream parquet -> CSR arrays for the fast engine.

Mirrors upstream ``create_model``:
    syn.connect(i=Presynaptic_Index, j=Postsynaptic_Index)
    syn.w = 'Excitatory x Connectivity' * w_syn
Rows are kept one-to-one (duplicates are not merged) and the per-presynaptic
order of the parquet file is preserved (stable sort), so summation order
matches Brian2's synapse order as closely as possible.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

from . import upstream


@dataclass
class Network:
    n: int
    indptr: np.ndarray  # int64, shape (n+1,)
    indices: np.ndarray  # int32, postsynaptic index per synapse row
    signed_count: np.ndarray  # int32, 'Excitatory x Connectivity'
    weights: np.ndarray  # float64 volts = signed_count * w_syn
    label: str
    is_synthetic: bool = False

    @property
    def n_connections(self) -> int:
        return int(len(self.indices))

    @property
    def n_synapses_abs(self) -> int:
        return int(np.abs(self.signed_count).sum())


def build_csr(n: int, pre: np.ndarray, post: np.ndarray, signed: np.ndarray, w_syn: float) -> tuple:
    order = np.argsort(pre, kind="stable")
    pre_s = pre[order]
    indptr = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(np.bincount(pre_s, minlength=n), out=indptr[1:])
    indices = post[order].astype(np.int32)
    signed_s = signed[order].astype(np.int32)
    weights = signed[order].astype(np.int64) * w_syn  # same operation as upstream (int array * float)
    return indptr, indices, signed_s, weights


@lru_cache(maxsize=1)
def load_network() -> Network:
    """Load the v630 network, verifying checksums; caches CSR arrays as .npz."""
    st = upstream.check_upstream()
    if not st.available:
        raise FileNotFoundError("Upstream model/data unavailable: " + "; ".join(st.problems))
    params = upstream.upstream_params()
    path_comp, path_con = upstream.dataset_paths()
    digest = upstream.DATASET_FILES["connectivity"][1]
    cache = upstream.cache_dir() / f"csr_{digest[:16]}_{params.w_syn:.9g}.npz"
    n = len(pd.read_csv(path_comp, index_col=0))
    if cache.is_file():
        z = np.load(cache)
        indptr, indices, signed, weights = z["indptr"], z["indices"], z["signed"], z["weights"]
    else:
        df = pd.read_parquet(path_con, columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"])
        pre = df["Presynaptic_Index"].to_numpy(np.int64)
        post = df["Postsynaptic_Index"].to_numpy(np.int64)
        signed = df["Excitatory x Connectivity"].to_numpy(np.int64)
        indptr, indices, signed, weights = build_csr(n, pre, post, signed, params.w_syn)
        np.savez(cache, indptr=indptr, indices=indices, signed=signed, weights=weights)
    return Network(n=n, indptr=indptr, indices=indices, signed_count=signed, weights=weights,
                   label=upstream.DATASET_LABEL)
