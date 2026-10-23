import numpy as np
import pytest
from pydantic import ValidationError

from flybrain.arena import core
from flybrain.arena.episode import run_episode


def run(**kw):
    return run_episode(core.ArenaConfig(**kw), lambda f: None, lambda: False)


def test_config_bounds():
    for bad in ({"duration_s": 0.5}, {"duration_s": 60}, {"grn_max_rate_hz": 300}, {"decoder": "steering"},
                {"walk_speed_mm_s": 0}, {"extra": 1}):
        with pytest.raises(ValidationError):
            core.ArenaConfig(**bad)


def test_interfaces_document_every_stage():
    itf = core.interfaces("numba-port", "mn9")
    assert [i["name"] for i in itf] == ["Environment", "Sensory encoder", "Neural model", "Output decoder", "Movement"]
    for i in itf:
        assert i["variables"] and i["provenance"] and i["equations"]
        assert all(v["unit"] and v["rate"] for v in i["variables"])
    assert "720575940660219265" in itf[3]["neurons"]
    assert "HANDCRAFTED" in itf[4]["provenance"]


def test_encoder_decoder_mappings():
    assert core.encode(0.5, 100) == 50
    assert core.encode(2.0, 100) == 100  # concentration clamped to [0, 1]
    d = core.Decoder()
    for _ in range(100):
        rate, s, e = d.update(5, 0.05)  # 100 Hz
    assert rate == pytest.approx(100) and s == pytest.approx(100, rel=1e-3) and e == pytest.approx(1, abs=1e-3)
    assert core.Decoder().update(0, 0.05) == (0.0, 0.0, 0.0)


def test_synthetic_episode_deterministic_and_matched_conditions():
    a = run(engine="synthetic", layout="single_patch", duration_s=6, seed=4)
    b = run(engine="synthetic", layout="single_patch", duration_s=6, seed=4)
    assert a["record"] == b["record"]
    ctrl = run(engine="synthetic", layout="single_patch", duration_s=6, seed=4, decoder="none")
    assert not any(ctrl["record"]["feeding"])
    assert all(e == 0 for e in ctrl["record"]["extension"])
    # feeding can only happen in contact with a patch
    for fed, patch in zip(a["record"]["feeding"], a["record"]["patch"]):
        assert not fed or patch >= 0
    # the encoder only drives the neurons when the fly touches a cue
    for r_in, c in zip(a["record"]["grn_rate_cmd_hz"], a["record"]["concentration"]):
        assert r_in == pytest.approx(100 * c)


def test_controller_respects_walls_and_obstacles():
    r = run(engine="synthetic", layout="obstacle_course", duration_s=20, seed=11, decoder="none", walk_speed_mm_s=30)
    lay = core.make_layout("obstacle_course")
    for x, y in zip(r["record"]["x"], r["record"]["y"]):
        assert 0 <= x <= core.ARENA_W_MM and 0 <= y <= core.ARENA_H_MM
        assert not any(o.contains(x, y) for o in lay.obstacles)


@pytest.mark.upstream
def test_full_model_episode_mn9_gates_feeding():
    """Seed 1 reaches cue 1: with the MN9 decoder the fly stops and feeds; controller-only walks through."""
    mn9 = run(duration_s=8, seed=1)
    ctrl = run(duration_s=8, seed=1, decoder="none")
    on = np.asarray(mn9["record"]["patch"]) >= 0
    assert on.any()
    assert mn9["summary"]["time_feeding_s"] > 1.0
    assert ctrl["summary"]["time_feeding_s"] == 0
    # MN9 is silent off-patch and active on-patch in this model
    rates = np.asarray(mn9["record"]["out_rate_hz"])
    assert rates[~on].mean() < 5 and rates[on].mean() > 20
