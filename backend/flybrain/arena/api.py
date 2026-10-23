"""Arena endpoints (stage 2, hybrid demonstration)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from . import core

router = APIRouter(prefix="/api/arena", tags=["arena"])


@router.get("/layouts")
def layouts() -> dict:
    out = {}
    for name in ("two_patches", "obstacle_course", "single_patch"):
        lay = core.make_layout(name)
        out[name] = {"patches": [vars(p) for p in lay.patches], "obstacles": [vars(o) for o in lay.obstacles],
                     "start": list(lay.start)}
    return {"width_mm": core.ARENA_W_MM, "height_mm": core.ARENA_H_MM, "layouts": out,
            "interfaces": core.interfaces("numba-port", "mn9"), "control_dt_s": core.CONTROL_DT_S}


@router.post("/episodes")
def start_episode(cfg: core.ArenaConfig) -> dict:
    from .. import api as main
    from .. import neurons, upstream

    if cfg.engine != "synthetic":
        if not upstream.check_upstream().available:
            raise HTTPException(409, "Upstream model data unavailable; use the synthetic engine.")
        cat = neurons.catalog()
        bad = [s for s in cfg.silenced_ids if not s.isdigit() or not cat.has(int(s))]
        if bad:
            raise HTTPException(422, f"Not FlyWire v630 IDs: {', '.join(bad)}")
    elif any(not (s.startswith("SYN-") and s[4:].isdigit()) for s in cfg.silenced_ids):
        raise HTTPException(422, "The synthetic engine only has synthetic neurons (SYN-…)")
    return main._mgr().submit(cfg, "arena").public()


@router.get("/episodes/{episode_id}")
def get_episode(episode_id: str) -> dict:
    from .. import api as main

    ep = main._episodes.get(episode_id)
    if ep is None:
        raise HTTPException(404, "Unknown episode")
    return ep


@router.get("/episodes/{episode_id}/export.json")
def export_episode(episode_id: str) -> JSONResponse:
    from .. import api as main

    ep = get_episode(episode_id)
    prov = main.upstream.provenance_record()
    prov.pop("upstream_status", None)
    return JSONResponse(ep | {"provenance": prov},
                        headers={"Content-Disposition": f'attachment; filename="flybrain_arena_{episode_id}.json"'})
