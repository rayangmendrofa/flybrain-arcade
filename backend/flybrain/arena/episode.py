# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Closed-loop arena episode (runs inside the simulation worker)."""

from __future__ import annotations

import time
from typing import Callable

import numpy as np

from .. import engine_fast as ef
from . import core


def _resolve(cfg: core.ArenaConfig):
    if cfg.engine == "synthetic":
        from ..synthetic import SYN_OUTPUT, SYN_SENSORY, synthetic_network, synthetic_params

        sil = [int(s[4:]) for s in cfg.silenced_ids]
        return synthetic_network(), synthetic_params(), list(SYN_SENSORY), SYN_OUTPUT, sil, "SYN-399"
    from .. import network, neurons, upstream

    cat = neurons.catalog()
    stim = [cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM]
    sil = [cat.index_of(int(s)) for s in cfg.silenced_ids]
    return (network.load_network(), upstream.upstream_params(), stim, cat.index_of(neurons.MN9_CONTRA), sil,
            str(neurons.MN9_CONTRA))


def run_episode(cfg: core.ArenaConfig, progress: Callable[[float], None], should_cancel: Callable[[], bool]) -> dict:
    t0 = time.perf_counter()
    net, p, stim, out_idx, sil, out_id = _resolve(cfg)
    layout = core.make_layout(cfg.layout)
    # independent, seeded random streams: neural input (inside the session) and controller noise
    session = ef.NeuralSession(net, p, stim, sil, seed=cfg.seed)
    ctrl = core.Controller(rng=np.random.Generator(np.random.PCG64(np.random.SeedSequence([cfg.seed, 99]))),
                           x=layout.start[0], y=layout.start[1], heading=layout.start[2], walk_speed=cfg.walk_speed_mm_s)
    dec = core.Decoder()
    steps_per_window = int(round(core.CONTROL_DT_S / p.dt))
    n_windows = int(round(cfg.duration_s / core.CONTROL_DT_S))
    stim_set = np.zeros(net.n, dtype=bool)
    stim_set[stim] = True
    rec: dict[str, list] = {k: [] for k in ("t_s", "x", "y", "heading", "patch", "concentration", "grn_rate_cmd_hz",
                                             "grn_spikes", "out_spikes", "out_rate_hz", "out_smoothed_hz", "extension",
                                             "speed", "feeding", "noise_turn", "avoid_turn", "collided", "amounts")}
    neural_wall = 0.0
    extension = 0.0
    for w in range(n_windows):
        if should_cancel():
            raise ef.Cancelled()
        # environment -> encoder
        patch, conc = core.cue_at(layout, ctrl.x, ctrl.y)
        r_in = core.encode(conc, cfg.grn_max_rate_hz)
        # neural model (published model), dt unchanged
        tn = time.perf_counter()
        si, _ = session.advance(steps_per_window, r_in)
        neural_wall += time.perf_counter() - tn
        n_out = int(np.sum(si == out_idx))
        n_grn = int(np.sum(stim_set[si]))
        # decoder
        rate, smoothed, ext = dec.update(n_out, core.CONTROL_DT_S)
        extension = ext if cfg.decoder == "mn9" else 0.0
        # movement (handcrafted controller) and environment update
        mv = ctrl.step(layout, extension, core.CONTROL_DT_S)
        if mv["feeding"] and patch >= 0:
            pa = layout.patches[patch]
            pa.amount = max(0.0, pa.amount - core.CONSUME_PER_S * extension * core.CONTROL_DT_S)
        for k, v in (("t_s", (w + 1) * core.CONTROL_DT_S), ("x", ctrl.x), ("y", ctrl.y), ("heading", ctrl.heading),
                     ("patch", patch), ("concentration", conc), ("grn_rate_cmd_hz", r_in),
                     ("grn_spikes", n_grn), ("out_spikes", n_out), ("out_rate_hz", rate), ("out_smoothed_hz", smoothed),
                     ("extension", extension), ("speed", mv["speed"]), ("feeding", mv["feeding"]),
                     ("noise_turn", mv["noise_turn"]), ("avoid_turn", mv["avoid_turn"]), ("collided", mv["collided"]),
                     ("amounts", [round(pp.amount, 4) for pp in layout.patches])):
            rec[k].append(v)
        progress((w + 1) / n_windows)
    wall = time.perf_counter() - t0
    init = core.make_layout(cfg.layout)
    return {
        "kind": "arena",
        "config": cfg.model_dump(),
        "label": "HYBRID DEMONSTRATION" + (" · SYNTHETIC NETWORK" if cfg.engine == "synthetic" else ""),
        "arena": {"width_mm": core.ARENA_W_MM, "height_mm": core.ARENA_H_MM,
                  "patches": [vars(pp) for pp in init.patches], "obstacles": [vars(o) for o in init.obstacles],
                  "start": list(init.start)},
        "record": rec,
        "control_dt_s": core.CONTROL_DT_S,
        "output_neuron_id": out_id,
        "interfaces": core.interfaces(cfg.engine, cfg.decoder),
        "constants": {"decoder_tau_s": core.DECODER_TAU_S, "r0_hz": core.DECODER_R0_HZ, "r1_hz": core.DECODER_R1_HZ,
                      "feed_gate": core.FEED_GATE, "consume_per_s": core.CONSUME_PER_S, "turn_noise": core.TURN_NOISE,
                      "lookahead_mm": core.LOOKAHEAD_MM, "max_turn_rate": core.MAX_TURN_RATE},
        "timing": {"wall_s": wall, "neural_wall_s": neural_wall, "simulated_s": cfg.duration_s,
                   "wall_per_simulated_s": wall / cfg.duration_s},
        "summary": {"time_feeding_s": float(np.sum(rec["feeding"]) * core.CONTROL_DT_S),
                    "time_on_patch_s": float(np.sum(np.asarray(rec["patch"]) >= 0) * core.CONTROL_DT_S),
                    "path_length_mm": float(np.sum(rec["speed"]) * core.CONTROL_DT_S),
                    "mean_out_rate_on_patch_hz": float(np.mean([r for r, pt in zip(rec["out_rate_hz"], rec["patch"]) if pt >= 0]))
                    if any(pt >= 0 for pt in rec["patch"]) else None},
    }
