# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Behaviour when the upstream repository / FlyWire data is missing (run in a clean subprocess)."""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = r"""
import json, time
from fastapi.testclient import TestClient
from flybrain.api import app
out = {}
with TestClient(app) as c:
    s = c.get('/api/status').json()
    out['available'] = s['upstream']['available']
    out['problems'] = s['upstream']['problems']
    out['engines'] = {k: v['available'] for k, v in s['engines'].items()}
    out['live_status'] = c.post('/api/baseline', json={'engine': 'numba-port', 'n_trials': 1}).status_code
    r = c.post('/api/replays/sugar100_roundup/load').json()
    b, i = r['runs']['baseline'], r['runs']['intervention']
    out['replay_mode'] = c.get(f'/api/runs/{b}').json()['mode']
    out['compare_status'] = c.get('/api/compare', params={'baseline': b, 'intervention': i}).status_code
    out['raster_status'] = c.get(f'/api/runs/{b}/raster').status_code
    out['rates_csv_status'] = c.get(f'/api/runs/{b}/export/rates.csv').status_code
    out['replay_intervention_status'] = c.post('/api/intervention', json={'baseline_run_id': b, 'silenced_ids': ['1']}).status_code
    j = c.post('/api/baseline', json={'engine': 'synthetic', 'n_trials': 2, 'duration_ms': 300}).json()
    while True:
        st = c.get(f"/api/jobs/{j['id']}").json()
        if st['status'] in ('done', 'error', 'cancelled'):
            break
        time.sleep(0.2)
    out['synthetic'] = st['status']
print('RESULT' + json.dumps(out))
"""


def test_missing_upstream_falls_back_to_replay_and_synthetic(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    env = dict(os.environ, FLYBRAIN_UPSTREAM_DIR=str(tmp_path / "missing"), FLYBRAIN_PERSIST_RUNS="0",
               FLYBRAIN_CACHE_DIR=str(tmp_path / "cache"), PYTHONPATH=str(backend))
    res = subprocess.run([sys.executable, "-c", SCRIPT], env=env, capture_output=True, text=True, timeout=300)
    line = [ln for ln in res.stdout.splitlines() if ln.startswith("RESULT")]
    assert line, res.stderr[-2000:]
    out = json.loads(line[0][6:])
    assert out["available"] is False and any("not found" in p for p in out["problems"])
    assert out["engines"] == {"numba-port": False, "brian2-reference": False, "synthetic": True}
    assert out["live_status"] == 409
    assert out["replay_mode"] == "replay"
    assert out["compare_status"] == out["raster_status"] == out["rates_csv_status"] == 200
    assert out["replay_intervention_status"] == 409
    assert out["synthetic"] == "done"
