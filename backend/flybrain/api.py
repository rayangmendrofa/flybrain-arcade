"""FastAPI application: bounded experiment API + static frontend."""

from __future__ import annotations

import json
import os
import platform
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import neurons, runs, synthetic, upstream
from .experiment import MAX_DURATION_MS, MAX_TRIALS, RATE_MAX_HZ, RATE_MIN_HZ, ExperimentConfig
from .jobs import Job, JobManager

FRONTEND_DIST = upstream.PROJECT_ROOT / "frontend" / "dist"
BENCHMARK_FILE = upstream.PROJECT_ROOT / "docs" / "benchmark.json"
MAX_RUNS_IN_MEMORY = 24

_runs: dict[str, runs.Run] = {}
_runs_lock = threading.Lock()
_episodes: dict[str, dict] = {}  # arena episodes (stage 2)
# comparisons precomputed with a replay (so replays work without the upstream catalog)
_stored_comparisons: dict[tuple[str, str], dict] = {}
_manager: JobManager | None = None


def _store_run(run: runs.Run) -> None:
    with _runs_lock:
        _runs[run.id] = run
        while len(_runs) > MAX_RUNS_IN_MEMORY:
            _runs.pop(next(iter(_runs)))


def _on_job_done(job: Job, raw: dict) -> str:
    if job.kind == "arena":
        eid = runs.new_run_id()
        raw["episode_id"] = eid
        raw["mode"] = "synthetic" if job.config.engine == "synthetic" else "live"
        _episodes[eid] = raw
        while len(_episodes) > 12:
            _episodes.pop(next(iter(_episodes)))
        return eid
    baseline = _runs.get(job.baseline_run_id) if job.baseline_run_id else None
    rid = runs.new_run_id()
    mode = "synthetic" if job.config.engine == "synthetic" else "live"
    summary = runs.build_summary(job.config, raw, mode, rid, job.kind, baseline)
    run = runs.Run(id=rid, kind=job.kind, mode=mode, config=job.config, raw=raw, created=time.time(),
                   summary=summary, baseline_run_id=job.baseline_run_id)
    _store_run(run)
    if os.environ.get("FLYBRAIN_PERSIST_RUNS", "1") == "1":
        try:
            runs.persist(run)
        except OSError:
            pass
    return rid


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _manager
    _manager = JobManager(_on_job_done)
    yield
    _manager.shutdown()


app = FastAPI(title="FlyBrain Arcade", version="0.1.0", lifespan=lifespan)


def _mgr() -> JobManager:
    if _manager is None:
        raise HTTPException(503, "Job manager not running")
    return _manager


def _get_run(run_id: str) -> runs.Run:
    run = _runs.get(run_id)
    if run is None:
        raise HTTPException(404, f"Unknown run {run_id} (runs are kept in memory for this session)")
    return run


# ------------------------------------------------------------------ status & catalog

@app.get("/api/status")
def status() -> dict:
    st = upstream.check_upstream()
    # Parameters are read from upstream model.py by the worker process (which
    # imports Brian2); the web server itself never imports Brian2.
    info = _manager.worker_info if _manager else None
    params = info.get("params") if info else None
    bench = json.loads(BENCHMARK_FILE.read_text()) if BENCHMARK_FILE.is_file() else None
    return {
        "upstream": st.as_dict(),
        "engines": {
            "numba-port": {"available": st.available, "max_trials": MAX_TRIALS["numba-port"],
                           "max_duration_ms": MAX_DURATION_MS["numba-port"],
                           "label": "Upstream model — Numba port (validated spike-for-spike vs Brian2)"},
            "brian2-reference": {"available": st.available, "max_trials": MAX_TRIALS["brian2-reference"],
                                 "max_duration_ms": MAX_DURATION_MS["brian2-reference"],
                                 "label": "Upstream model.py on Brian2 (reference; slow)"},
            "synthetic": {"available": True, "max_trials": MAX_TRIALS["synthetic"],
                          "max_duration_ms": MAX_DURATION_MS["synthetic"], "label": synthetic.SYNTHETIC_LABEL},
        },
        "bounds": {"rate_hz": [RATE_MIN_HZ, RATE_MAX_HZ], "duration_ms": [100, 2000]},
        "provenance": upstream.provenance_record() | {"upstream_status": None},
        "params": params,
        "feeding_output": neurons.FEEDING_OUTPUT_DESCRIPTION,
        "outputs": [{"id": str(k), **v} for k, v in neurons.OUTPUTS.items()],
        "sugar_grns": {"ids": [str(i) for i in neurons.SUGAR_GRNS_UPSTREAM], "source": neurons.SUGAR_GRNS_SOURCE},
        "benchmark": bench,
        "worker": {"ready": info is not None, **({k: v for k, v in info.items() if k != "params"} if info else {})},
        "server": {"python": platform.python_version(), "cpu": platform.processor(), "os": platform.platform()},
    }


@app.get("/api/neurons/groups")
def neuron_groups() -> dict:
    synth = [{"key": "syn:l3", "label": "Synthetic layer-3 subset (SYN-92…111)",
              "ids": [f"SYN-{i}" for i in synthetic.SYN_LAYERS[2][:20]], "source": "synthetic (invented)",
              "paper_context": "Synthetic demo only"},
             {"key": "syn:inh", "label": "Synthetic inhibitory hidden neurons (SYN-52…57)",
              "ids": [f"SYN-{i}" for i in synthetic.SYN_LAYERS[1][:6]], "source": "synthetic (invented)",
              "paper_context": "Synthetic demo only"},
             {"key": "syn:sensory", "label": "All 12 synthetic sensory neurons (control)",
              "ids": [f"SYN-{i}" for i in synthetic.SYN_SENSORY], "source": "synthetic (invented)",
              "paper_context": "Synthetic demo only"}]
    return {"silencing_groups": neurons.silencing_groups(), "all_cell_types": neurons.all_cell_types(),
            "synthetic_groups": synth,
            "note": "Cell-type IDs come from upstream sez_neurons.pickle (v630). Silencing follows upstream "
                    "silence(): all outgoing synapse weights of each neuron are set to 0."}


@app.get("/api/neurons/lookup")
def neuron_lookup(id: str = Query(..., max_length=24)) -> dict:
    if not id.isdigit():
        raise HTTPException(422, "FlyWire IDs are digits only")
    if not upstream.check_upstream().available:
        raise HTTPException(503, "Upstream data unavailable")
    cat = neurons.catalog()
    if not cat.has(int(id)):
        return {"found": False, "id": id, "dataset": upstream.DATASET_ID}
    return {"found": True, "dataset": upstream.DATASET_ID, **runs.neuron_label("numba-port", cat.index_of(int(id)))}


# ------------------------------------------------------------------ experiments

class InterventionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    baseline_run_id: str
    silenced_ids: list[str] = Field(min_length=1, max_length=200)


def _check_engine(cfg: ExperimentConfig) -> None:
    if cfg.engine != "synthetic" and not upstream.check_upstream().available:
        raise HTTPException(409, "Upstream model data unavailable; use the synthetic demo or a replay. "
                                 + "; ".join(upstream.check_upstream().problems))
    if cfg.engine != "synthetic":
        cat = neurons.catalog()
        missing = [s for s in cfg.silenced_ids if not cat.has(int(s))]
        if missing:
            raise HTTPException(422, f"Not in {upstream.DATASET_ID}: {', '.join(missing)}")


@app.post("/api/baseline")
def run_baseline(cfg: ExperimentConfig) -> dict:
    if cfg.silenced_ids:
        raise HTTPException(422, "A baseline run has no silenced neurons")
    _check_engine(cfg)
    return _mgr().submit(cfg, "baseline").public()


@app.post("/api/intervention")
def run_intervention(req: InterventionRequest) -> dict:
    base = _get_run(req.baseline_run_id)
    if base.mode == "replay":
        raise HTTPException(409, "Replays cannot be extended with new simulations; run a live baseline first")
    try:
        cfg = base.config.model_copy(update={"silenced_ids": req.silenced_ids})
        cfg = ExperimentConfig.model_validate(cfg.model_dump())
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json()))
    _check_engine(cfg)
    assert not base.config.matched_for_comparison(cfg)
    return _mgr().submit(cfg, "intervention", baseline_run_id=base.id).public()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = _mgr().jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return job.public() | {"queue_position": _mgr().queue_position(job)}


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str) -> dict:
    job = _mgr().cancel(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return job.public()


@app.get("/api/runs/{run_id}")
def run_summary(run_id: str) -> dict:
    return runs.public_summary(_get_run(run_id))


@app.get("/api/runs/{run_id}/raster")
def run_raster(run_id: str, trial: int = Query(0, ge=0)) -> dict:
    run = _get_run(run_id)
    if trial >= len(run.raw["spike_neuron"]):
        raise HTTPException(422, "Trial index out of range")
    return runs.raster(run, trial)


@app.get("/api/compare")
def compare(baseline: str, intervention: str) -> dict:
    b, i = _get_run(baseline), _get_run(intervention)
    if (baseline, intervention) in _stored_comparisons:
        return _stored_comparisons[(baseline, intervention)]
    diffs = b.config.matched_for_comparison(i.config)
    if diffs:
        raise HTTPException(422, f"Runs are not matched for comparison (differ in: {', '.join(diffs)})")
    return runs.compare(b, i)


# ------------------------------------------------------------------ exports

@app.get("/api/runs/{run_id}/export/{name}")
def export(run_id: str, name: str) -> Response:
    run = _get_run(run_id)
    fname = f"flybrain_{run.id}_{name}"
    headers = {"Content-Disposition": f'attachment; filename="{fname}"'}
    if name == "config.json":
        return Response(run.config.model_dump_json(indent=1), media_type="application/json", headers=headers)
    if name == "provenance.json":
        return JSONResponse(runs.provenance(run), headers=headers)
    if name in ("rates.csv", "spikes.csv"):
        return PlainTextResponse(runs.export_csv(run, name.split(".")[0]), media_type="text/csv", headers=headers)
    raise HTTPException(404, "Unknown export")


@app.get("/api/compare/export.json")
def compare_export(baseline: str, intervention: str) -> Response:
    data = compare(baseline, intervention)
    data["provenance"] = {"baseline": runs.provenance(_get_run(baseline)),
                          "intervention": runs.provenance(_get_run(intervention))}
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="flybrain_compare_{intervention}.json"'})


# ------------------------------------------------------------------ replays

@app.get("/api/replays")
def list_replays() -> list[dict]:
    out = []
    if runs.REPLAY_DIR.is_dir():
        for d in sorted(runs.REPLAY_DIR.iterdir()):
            meta = d / "replay.json"
            if meta.is_file():
                out.append(json.loads(meta.read_text()) | {"name": d.name})
    return out


@app.post("/api/replays/{name}/load")
def load_replay(name: str) -> dict:
    d = runs.REPLAY_DIR / name
    if not (d / "replay.json").is_file() or d.resolve().parent != runs.REPLAY_DIR.resolve():
        raise HTTPException(404, "Unknown replay")
    meta = json.loads((d / "replay.json").read_text())
    loaded = {}
    for role in ("baseline", "intervention"):
        if (d / role).is_dir():
            run = runs.load_run(d / role, mode="replay")
            _store_run(run)
            loaded[role] = run.id
    if (d / "comparison.json").is_file() and len(loaded) == 2:
        cmp = json.loads((d / "comparison.json").read_text())
        cmp |= {"baseline_run_id": loaded["baseline"], "intervention_run_id": loaded["intervention"]}
        _stored_comparisons[(loaded["baseline"], loaded["intervention"])] = cmp
    return {"meta": meta, "runs": loaded}


# ------------------------------------------------------------------ arena (stage 2)

from .arena import api as arena_api  # noqa: E402

app.include_router(arena_api.router)


# ------------------------------------------------------------------ frontend

if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        f = (FRONTEND_DIST / path).resolve()
        if path and f.is_file() and FRONTEND_DIST.resolve() in f.parents:
            return FileResponse(f)
        # index.html must not be cached: it names the hashed asset files of the current build
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
