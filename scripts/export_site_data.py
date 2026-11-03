"""Export precomputed data for the static showcase page (no backend needed to view it).

Writes to frontend/site/public/data/:
  manifest.json            provenance for everything below
  atlas.json, atlas.bin    neuron positions (FlyWire v630 IDs, flywire_annotations v1.1.0), visualisation only
  runs/baseline.json       replay: 21 sugar GRNs at 100 Hz (MN9 PSTH over all trials + every spike of trial 1)
  runs/intervention.json   same seeds with both Roundup neurons silenced
  comparison.json          paired MN9 comparison (from the replay)
  arena/<name>.json        hybrid-demonstration arena episodes (published model + handcrafted controller)
and copies the 3D fly model into frontend/site/public/models/.

Every file says what it is: REPLAY of the published model or HYBRID DEMONSTRATION. Nothing here is
recorded biological data.

Usage: python scripts/export_site_data.py [--replay sugar100_roundup] [--arena-seconds 15] [--skip-arena]
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from flybrain import brain, neurons, runs, upstream  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "site" / "public"


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


def run_payload(run: runs.Run, label: str) -> dict:
    s = run.summary
    mn9 = s["outputs"][0]
    act = brain.run_activity(run, 0)
    return {
        "label": label,
        "kind": run.kind,
        "mode": "replay",
        "config": json.loads(run.config.model_dump_json()),
        "schedule": s["schedule"],
        "silenced": s.get("silenced"),
        "mn9": {"name": mn9["name"], "neuron": mn9["neuron"], "stats": mn9["stats"], "psth": mn9["psth"],
                "psth_note": "trial-averaged rate in 5 ms bins over all trials of this run"},
        "activity": {**act, "t_ms": [round(t, 1) for t in act["t_ms"]]},
        "timing": s["timing"],
        "backend": s["backend"],
    }


ARENA_FIELDS = ("t_s", "x", "y", "heading", "speed", "feeding", "extension", "out_rate_hz", "out_smoothed_hz",
                "patch", "concentration", "amounts")


def export_arena(name: str, cfg_kwargs: dict, seconds: float) -> dict:
    from flybrain.arena import core, episode

    cfg = core.ArenaConfig(duration_s=seconds, **cfg_kwargs)
    t0 = time.perf_counter()
    ep = episode.run_episode(cfg, progress=lambda f: None, should_cancel=lambda: False)
    print(f"  arena {name}: {seconds:g} s simulated in {time.perf_counter() - t0:.1f} s")

    def rnd(v):
        if isinstance(v, float):
            return round(v, 4)
        if isinstance(v, list):
            return [rnd(x) for x in v]
        return v

    rec = {k: rnd(ep["record"][k]) for k in ARENA_FIELDS}
    return {"name": name, "label": ep["label"], "config": ep["config"], "arena": ep["arena"], "record": rec,
            "control_dt_s": ep["control_dt_s"], "constants": ep["constants"], "interfaces": ep["interfaces"],
            "summary": ep["summary"], "timing": ep["timing"], "output_neuron_id": ep["output_neuron_id"]}


def git_commit() -> str | None:
    try:
        return subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", default="sugar100_roundup")
    ap.add_argument("--arena-seconds", type=float, default=15.0)
    ap.add_argument("--skip-arena", action="store_true")
    a = ap.parse_args()

    data = OUT / "data"
    print(f"Exporting to {data.relative_to(ROOT)}")
    blob, atlas_meta = brain.atlas_binary(brain.load_atlas())
    (data / "atlas.bin").parent.mkdir(parents=True, exist_ok=True)
    (data / "atlas.bin").write_bytes(blob)
    print(f"  {(data / 'atlas.bin').relative_to(ROOT)}  {len(blob) / 1024:.0f} KB")
    dump(data / "atlas.json", atlas_meta)

    rdir = runs.REPLAY_DIR / a.replay
    replay_meta = json.loads((rdir / "replay.json").read_text())
    base = runs.load_run(rdir / "baseline")
    inter = runs.load_run(rdir / "intervention")
    dump(data / "runs" / "baseline.json", run_payload(base, "Sugar neurons stimulated"))
    dump(data / "runs" / "intervention.json", run_payload(inter, "Same input, Roundup neurons silenced"))
    dump(data / "comparison.json", json.loads((rdir / "comparison.json").read_text()))

    arena_files = []
    if not a.skip_arena:
        roundup = [str(i) for i in neurons.sez_cell_types()["cell_types"]["roundup"]]
        for name, kw in (("intact", {}), ("roundup_silenced", {"silenced_ids": roundup})):
            ep = export_arena(name, {"layout": "two_patches", "seed": 1, **kw}, a.arena_seconds)
            dump(data / "arena" / f"{name}.json", ep)
            arena_files.append(f"arena/{name}.json")
    else:
        arena_files = sorted(f"arena/{p.name}" for p in (data / "arena").glob("*.json"))

    models = OUT / "models"
    models.mkdir(parents=True, exist_ok=True)
    for f in ("housefly.glb", "housefly.json"):
        shutil.copy2(ROOT / "frontend" / "public" / "models" / f, models / f)

    manifest = {
        "generated": time.strftime("%Y-%m-%d"),
        "project_commit": git_commit(),
        "what": "Precomputed outputs of the Shiu et al. (2024) whole-brain LIF model, shown as REPLAY. Not recorded biological data.",
        "model": {"citation": upstream.PAPER_CITATION, "repository": upstream.UPSTREAM_REPO_URL,
                  "commit": upstream.UPSTREAM_COMMIT, "licence": upstream.UPSTREAM_LICENCE},
        "dataset": {"id": upstream.DATASET_ID, "label": upstream.DATASET_LABEL,
                    "files": {k: {"file": f, "sha256": h} for k, (f, h) in upstream.DATASET_FILES.items()}},
        "positions": atlas_meta["source"] | {"n_with_position": atlas_meta["n_with_position"],
                                             "n_neurons": atlas_meta["n_neurons"]},
        "replay": {"name": a.replay, **replay_meta, "files": ["runs/baseline.json", "runs/intervention.json", "comparison.json"]},
        "arena": {"files": arena_files,
                  "label": "HYBRID DEMONSTRATION: published model + handcrafted walking controller (application assumptions)"},
        "fly_model": json.loads((ROOT / "frontend" / "public" / "models" / "housefly.json").read_text()),
    }
    dump(data / "manifest.json", manifest)


if __name__ == "__main__":
    main()
