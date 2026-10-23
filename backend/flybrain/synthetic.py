"""Synthetic demonstration network (NOT biological data).

A small random network used (a) as a test fixture and (b) as the clearly
labelled "SYNTHETIC DEMO" mode when the upstream FlyWire data cannot be
loaded. Neuron identities, connectivity and outputs are invented here and must
never be presented as the published model or as FlyWire neurons.
"""

from __future__ import annotations

import numpy as np

from .network import Network, build_csr

SYNTHETIC_LABEL = "SYNTHETIC DEMO network (random; not FlyWire, not the published model)"
SYNTHETIC_PARAMS_NOTE = "Uses the upstream LIF equations and parameters on an invented random network."

# Synthetic roles: indices into the synthetic network (layered, feed-forward-biased)
SYN_N = 400
SYN_SENSORY = tuple(range(0, 12))  # 'synthetic sensory' neurons (stimulated)
SYN_LAYERS = (tuple(range(12, 52)), tuple(range(52, 92)), tuple(range(92, 132)))
SYN_OUTPUT = 399  # 'synthetic output A'
SYN_OUTPUT_2 = 398  # 'synthetic output B'


def synthetic_params():
    """Upstream default_params values, repeated here so synthetic mode works without the upstream repo."""
    from .upstream import ModelParams

    return ModelParams(t_run=1.0, n_run=30, v_0=-0.052, v_rst=-0.052, v_th=-0.045, t_mbr=0.02, tau=0.005,
                       t_rfc=0.0022, t_dly=0.0018, w_syn=0.000275, r_poi=150.0, r_poi2=0.0, f_poi=250.0,
                       eqs="(upstream equations)", eq_th="v > v_th", eq_rst="v = v_rst; w = 0; g = 0 * mV")


def synthetic_network(n: int = SYN_N, seed: int = 7, w_syn: float = 0.000275) -> Network:
    """Invented layered network: sensory -> 3 hidden layers -> two outputs, plus weak random background."""
    rng = np.random.default_rng(seed)
    pre, post, signed = [], [], []

    def link(j, t, count):
        pre.append(int(j))
        post.append(int(t))
        signed.append(int(count))

    if n >= SYN_N:
        layers = (SYN_SENSORY,) + SYN_LAYERS
        for a, b in zip(layers[:-1], layers[1:]):
            for t in b:
                for j in rng.choice(a, size=6, replace=False):
                    link(j, t, int(rng.integers(30, 90)))
        # a few inhibitory hidden neurons (layer 2) onto layer 3
        for j in SYN_LAYERS[1][:6]:
            for t in rng.choice(SYN_LAYERS[2], size=10, replace=False):
                link(j, t, -int(rng.integers(20, 60)))
        for out, k in ((SYN_OUTPUT, 15), (SYN_OUTPUT_2, 8)):
            for j in rng.choice(SYN_LAYERS[2], size=k, replace=False):
                link(j, out, int(rng.integers(20, 60)))
        background = np.arange(132, 398)
    else:
        background = np.arange(n)
    for _ in range(2 * len(background)):
        j, t = rng.choice(background, size=2)
        link(j, t, int(rng.integers(-8, 9)))
    pre_a, post_a, signed_a = (np.asarray(x, dtype=np.int64) for x in (pre, post, signed))
    indptr, indices, signed_s, weights = build_csr(n, pre_a, post_a, signed_a, w_syn)
    return Network(n=n, indptr=indptr, indices=indices, signed_count=signed_s, weights=weights,
                   label=SYNTHETIC_LABEL, is_synthetic=True)
