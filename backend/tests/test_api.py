# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import os
import time

import pytest
from fastapi.testclient import TestClient

os.environ["FLYBRAIN_PERSIST_RUNS"] = "0"

from flybrain.api import app  # noqa: E402
from flybrain import upstream  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def wait(c, job_id, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = c.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("done", "error", "cancelled"):
            return s
        time.sleep(0.2)
    raise TimeoutError(job_id)


SYN = {"engine": "synthetic", "duration_ms": 500, "seed": 4, "n_trials": 3, "stimulus": {"rate_hz": 80}}


def test_status(client):
    s = client.get("/api/status").json()
    assert s["engines"]["synthetic"]["available"]
    assert s["provenance"]["model"]["commit_expected"] == upstream.UPSTREAM_COMMIT


def test_synthetic_baseline_intervention_compare_export(client):
    j = client.post("/api/baseline", json=SYN).json()
    b = wait(client, j["id"])
    assert b["status"] == "done", b
    run = client.get(f"/api/runs/{b['run_id']}").json()
    assert run["mode"] == "synthetic"
    assert len(run["raster_rows"]) <= 80
    assert "_mean_rates" not in run
    assert run["outputs"][0]["stats"]["n_trials"] == 3

    j2 = client.post("/api/intervention", json={"baseline_run_id": b["run_id"],
                                                 "silenced_ids": [f"SYN-{i}" for i in range(92, 112)]}).json()
    i = wait(client, j2["id"])
    assert i["status"] == "done", i
    inter = client.get(f"/api/runs/{i['run_id']}").json()
    assert inter["config"]["seed"] == 4 and inter["config"]["silenced_ids"][0] == "SYN-92"

    cmp = client.get("/api/compare", params={"baseline": b["run_id"], "intervention": i["run_id"]}).json()
    out = cmp["outputs"][0]
    assert out["n_trials"] == 3 and out["intervention_mean_rate_hz"] < out["baseline_mean_rate_hz"]

    r = client.get(f"/api/runs/{b['run_id']}/raster", params={"trial": 2}).json()
    assert r["trial"] == 2 and all(0 <= s[1] < 500 for s in r["spikes"])
    assert client.get(f"/api/runs/{b['run_id']}/raster", params={"trial": 3}).status_code == 422

    for name, ctype in (("config.json", "application/json"), ("provenance.json", "application/json"),
                        ("rates.csv", "text/csv"), ("spikes.csv", "text/csv")):
        resp = client.get(f"/api/runs/{b['run_id']}/export/{name}")
        assert resp.status_code == 200 and resp.headers["content-type"].startswith(ctype)
    prov = client.get(f"/api/runs/{b['run_id']}/export/provenance.json").json()
    assert prov["dataset"]["id"] == "synthetic" and prov["config"]["seed"] == 4
    assert client.get("/api/compare/export.json", params={"baseline": b["run_id"], "intervention": i["run_id"]}).status_code == 200


def test_validation_errors(client):
    assert client.post("/api/baseline", json={**SYN, "stimulus": {"rate_hz": 999}}).status_code == 422
    assert client.post("/api/baseline", json={**SYN, "silenced_ids": ["SYN-1"]}).status_code == 422
    assert client.post("/api/intervention", json={"baseline_run_id": "nope", "silenced_ids": ["SYN-1"]}).status_code == 404


def test_unmatched_runs_cannot_be_compared(client):
    a = wait(client, client.post("/api/baseline", json=SYN).json()["id"])
    b = wait(client, client.post("/api/baseline", json={**SYN, "seed": 5}).json()["id"])
    r = client.get("/api/compare", params={"baseline": a["run_id"], "intervention": b["run_id"]})
    assert r.status_code == 422 and "seed" in r.json()["detail"]


@pytest.mark.upstream
def test_live_model_run_and_cancellation(client):
    cfg = {"engine": "numba-port", "duration_ms": 300, "seed": 1, "n_trials": 2, "stimulus": {"rate_hz": 100}}
    s = wait(client, client.post("/api/baseline", json=cfg).json()["id"])
    assert s["status"] == "done", s
    run = client.get(f"/api/runs/{s['run_id']}").json()
    assert run["mode"] == "live" and run["outputs"][0]["neuron"]["id"] == "720575940660219265"
    assert run["network"]["n_neurons"] == 127400

    long = {"engine": "numba-port", "duration_ms": 2000, "seed": 1, "n_trials": 30, "stimulus": {"rate_hz": 200}}
    j = client.post("/api/baseline", json=long).json()
    while client.get(f"/api/jobs/{j['id']}").json()["status"] != "running":
        time.sleep(0.1)
    client.post(f"/api/jobs/{j['id']}/cancel")
    c = wait(client, j["id"], timeout=30)
    assert c["status"] == "cancelled"
    # the worker remains usable after cancellation
    s2 = wait(client, client.post("/api/baseline", json=cfg).json()["id"])
    run2 = client.get(f"/api/runs/{s2['run_id']}").json()
    assert run2["outputs"][0]["stats"]["per_trial_counts"] == run["outputs"][0]["stats"]["per_trial_counts"]
