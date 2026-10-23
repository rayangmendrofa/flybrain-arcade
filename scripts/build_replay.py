"""Precompute a baseline + intervention pair and save it as a labelled REPLAY.

Replays let the app show real model output on machines without the upstream
data. They are always labelled REPLAY in the UI and carry full provenance.

Usage: python scripts/build_replay.py --name sugar100_roundup --rate 100 --trials 10 --seed 1 \
           --silence-type roundup --title "..." --description "..."
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from flybrain import neurons, runs  # noqa: E402
from flybrain.experiment import ExperimentConfig  # noqa: E402
from flybrain.jobs import run_inline  # noqa: E402


def make_run(cfg: ExperimentConfig, kind: str, baseline=None) -> runs.Run:
    raw = run_inline(cfg)
    rid = f"replay-{kind}-" + runs.new_run_id()
    summary = runs.build_summary(cfg, raw, "live", rid, kind, baseline)
    return runs.Run(id=rid, kind=kind, mode="live", config=cfg, raw=raw, created=time.time(), summary=summary,
                    baseline_run_id=None if baseline is None else baseline.id)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--engine", default="numba-port")
    ap.add_argument("--rate", type=float, default=100)
    ap.add_argument("--trials", type=int, default=10)
    ap.add_argument("--duration-ms", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--silence-type", default="roundup", help="cell type key from upstream sez_neurons.pickle")
    a = ap.parse_args()

    ids = [str(i) for i in neurons.sez_cell_types()["cell_types"][a.silence_type]]
    cfg = ExperimentConfig(engine=a.engine, duration_ms=a.duration_ms, seed=a.seed, n_trials=a.trials,
                           stimulus={"rate_hz": a.rate})
    base = make_run(cfg, "baseline")
    inter = make_run(cfg.model_copy(update={"silenced_ids": ids}), "intervention", base)
    out = runs.REPLAY_DIR / a.name
    if out.exists():
        shutil.rmtree(out)
    runs.write_run(base, out / "baseline")
    runs.write_run(inter, out / "intervention")
    (out / "comparison.json").write_text(json.dumps(runs.compare(base, inter)))
    meta = {"title": a.title, "description": a.description, "computed_at": time.strftime("%Y-%m-%d"),
            "engine": a.engine, "config": json.loads(cfg.model_dump_json()), "silenced_type": a.silence_type}
    (out / "replay.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
