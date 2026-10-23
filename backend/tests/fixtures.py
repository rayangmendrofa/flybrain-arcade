"""Synthetic test fixtures. These are invented networks, kept separate from biological data."""

import numpy as np

from flybrain.network import Network, build_csr
from flybrain.synthetic import synthetic_params

PARAMS = synthetic_params()


def tiny_network(edges: list[tuple[int, int, int]], n: int) -> Network:
    """edges: (pre, post, signed synapse count)."""
    if edges:
        pre, post, cnt = (np.asarray(x, dtype=np.int64) for x in zip(*edges))
    else:
        pre = post = cnt = np.zeros(0, dtype=np.int64)
    indptr, indices, signed, weights = build_csr(n, pre, post, cnt, PARAMS.w_syn)
    return Network(n=n, indptr=indptr, indices=indices, signed_count=signed, weights=weights,
                   label="test fixture (synthetic)", is_synthetic=True)


def spikes_of(res, trial: int, neuron: int) -> list[int]:
    return res.spike_step[trial][res.spike_neuron[trial] == neuron].tolist()
