# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Run records: metrics, bounded raster selections, comparisons, persistence and export.

The browser never receives the full network's spikes: only rates for outputs,
populations and a bounded raster selection (<= MAX_RASTER_ROWS neurons, one
trial at a time).
"""

from __future__ import annotations

import csv
import io
import json
import time
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from . import metrics, neurons, synthetic, upstream
from .experiment import ExperimentConfig

MAX_RASTER_ROWS = 80
TOP_RESPONSIVE = 30
PSTH_BIN_MS = 5.0
RUNS_DIR = upstream.PROJECT_ROOT / "data" / "runs"
REPLAY_DIR = upstream.PROJECT_ROOT / "replays"


@lru_cache(maxsize=1)
def _type_by_id() -> dict[int, str]:
    out: dict[int, str] = {}
    for name, ids in neurons.sez_cell_types()["cell_types"].items():
        for i in ids:
            out.setdefault(int(i), name)
    return out


def neuron_label(engine: str, idx: int) -> dict:
    if engine == "synthetic":
        role = ("synthetic sensory" if idx in synthetic.SYN_SENSORY else
                "synthetic output A" if idx == synthetic.SYN_OUTPUT else
                "synthetic output B" if idx == synthetic.SYN_OUTPUT_2 else "synthetic")
        return {"index": idx, "id": f"SYN-{idx}", "name": role, "cell_type": None, "synthetic": True}
    fid = neurons.catalog().id_of(idx)
    name = None
    if fid in neurons.OUTPUTS:
        name = neurons.OUTPUTS[fid]["name"]
    elif fid in neurons.SUGAR_GRNS_UPSTREAM:
        name = f"sugar GRN {neurons.SUGAR_GRNS_UPSTREAM.index(fid) + 1}"
    ct = _type_by_id().get(fid)
    return {"index": idx, "id": str(fid), "name": name or ct, "cell_type": ct, "synthetic": False}


def output_indices(engine: str) -> list[tuple[str, int, dict]]:
    if engine == "synthetic":
        return [("out_a", synthetic.SYN_OUTPUT, {"name": "Synthetic output A", "short": "OUT-A",
                                                  "source": "synthetic (invented)", "side_note": ""}),
                ("out_b", synthetic.SYN_OUTPUT_2, {"name": "Synthetic output B", "short": "OUT-B",
                                                    "source": "synthetic (invented)", "side_note": ""})]
    cat = neurons.catalog()
    return [("mn9_contra", cat.index_of(neurons.MN9_CONTRA), neurons.OUTPUTS[neurons.MN9_CONTRA]),
            ("mn9_other", cat.index_of(neurons.MN9_OTHER), neurons.OUTPUTS[neurons.MN9_OTHER])]


@dataclass
class Run:
    id: str
    kind: str
    mode: str  # "live" | "replay" | "synthetic"
    config: ExperimentConfig
    raw: dict  # spike arrays + timing (+ backend info)
    created: float
    summary: dict
    baseline_run_id: str | None = None

    @property
    def engine(self) -> str:
        return self.config.engine


def build_summary(cfg: ExperimentConfig, raw: dict, mode: str, run_id: str, kind: str,
                  baseline: "Run | None" = None) -> dict:
    dt, n_steps, n = raw["dt"], raw["n_steps"], raw["n_neurons"]
    sn, ss = raw["spike_neuron"], raw["spike_step"]
    wa, wb = metrics.window_steps(cfg.window_ms, dt)
    window_s = (wb - wa) * dt
    counts = metrics.counts_in_window(sn, ss, n, (wa, wb))
    stim = list(raw["stim_idx"])
    sil = list(raw["silenced_idx"])

    outputs = []
    for key, idx, meta in output_indices(cfg.engine):
        outputs.append({"key": key, **meta, "neuron": neuron_label(cfg.engine, idx),
                        "stats": metrics.rate_stats(counts[:, idx], window_s),
                        "psth": metrics.psth(sn, ss, [idx], n_steps, dt, PSTH_BIN_MS)})
    stim_pop = {"label": "Stimulated sensory neurons (population mean per neuron)",
                "stats": metrics.rate_stats(counts[:, stim].sum(1), window_s * len(stim)),
                "psth": metrics.psth(sn, ss, stim, n_steps, dt, PSTH_BIN_MS)}

    mean_rates = counts.mean(0) / window_s
    order = np.argsort(-mean_rates, kind="stable")
    excluded = set(stim)
    top = [int(i) for i in order if mean_rates[i] > 0 and int(i) not in excluded][:TOP_RESPONSIVE]
    base_rates = None
    if baseline is not None:
        base_rates = np.asarray(baseline.summary["_mean_rates"])  # type: ignore[index]
        # keep the baseline's top list so rows line up
        top = baseline.summary["top_responsive_idx"]
    top_rows = [{**neuron_label(cfg.engine, i), "mean_rate_hz": float(mean_rates[i]),
                 "sd_rate_hz": float((counts[:, i] / window_s).std()),
                 "baseline_rate_hz": None if base_rates is None else float(base_rates[i]),
                 "silenced": i in sil} for i in top]

    raster_rows = _raster_rows(cfg.engine, stim, [idx for _, idx, _ in output_indices(cfg.engine)], sil, top)
    n_active = int((mean_rates > 0).sum())
    summary = {
        "run_id": run_id, "kind": kind, "mode": mode, "created": time.time(),
        "baseline_run_id": None if baseline is None else baseline.id,
        "config": json.loads(cfg.model_dump_json()),
        "schedule": {"rate_hz": cfg.stimulus.rate_hz, "onset_ms": cfg.stimulus.onset_ms,
                     "offset_ms": cfg.stim_offset_ms, "duration_ms": cfg.duration_ms,
                     "target_label": "21 sugar GRNs (upstream list)" if cfg.engine != "synthetic" else "12 synthetic sensory neurons",
                     "mechanism": "Independent Poisson input per target (Brian2 PoissonInput, N=1, weight w_syn*f_poi on v); no refractory period for targets"},
        "rate_window_ms": list(cfg.window_ms),
        "rate_definition": "spikes in window / window length, per trial; mean and SD (ddof=0, as upstream get_rate) across trials",
        "outputs": outputs,
        "stimulated_population": stim_pop,
        "top_responsive": top_rows,
        "top_responsive_idx": top,
        "silenced": [neuron_label(cfg.engine, i) for i in sil],
        "raster_rows": [neuron_label(cfg.engine, i) | {"group": g} for g, i in raster_rows],
        "network": {"n_neurons": n, "n_active_neurons": n_active,
                    "total_spikes_per_trial_mean": float(np.mean([len(x) for x in sn]))},
        "timing": raw["timing"],
        "backend": raw["backend"],
        "dt_ms": dt * 1000, "n_steps": n_steps,
        "_mean_rates": mean_rates.tolist(),
    }
    return summary


def _raster_rows(engine, stim, outs, sil, top) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    seen = set()
    for group, idxs in (("output", outs), ("silenced", sil[:20]), ("stimulated", stim), ("responsive", top)):
        for i in idxs:
            if i not in seen and len(rows) < MAX_RASTER_ROWS:
                rows.append((group, int(i)))
                seen.add(i)
    return rows


def raster(run: Run, trial: int) -> dict:
    rows = run.summary["raster_rows"]
    idx_to_row = {r["index"]: k for k, r in enumerate(rows)}
    sn = run.raw["spike_neuron"][trial]
    ss = run.raw["spike_step"][trial]
    sel = np.isin(sn, list(idx_to_row))
    dt = run.raw["dt"]
    return {"trial": trial, "n_trials": len(run.raw["spike_neuron"]),
            "rows": rows,
            "spikes": [[idx_to_row[int(i)], round(float(s) * dt * 1000, 2)] for i, s in zip(sn[sel], ss[sel])],
            "duration_ms": run.config.duration_ms}


def compare(base: Run, inter: Run) -> dict:
    cfg = base.config
    dt = base.raw["dt"]
    wa, wb = metrics.window_steps(cfg.window_ms, dt)
    window_s = (wb - wa) * dt
    n = base.raw["n_neurons"]
    cb = metrics.counts_in_window(base.raw["spike_neuron"], base.raw["spike_step"], n, (wa, wb))
    ci = metrics.counts_in_window(inter.raw["spike_neuron"], inter.raw["spike_step"], n, (wa, wb))
    outs = [{"key": key, "name": meta["name"], "short": meta["short"], "neuron": neuron_label(cfg.engine, idx),
             **metrics.compare_stats(cb[:, idx], ci[:, idx], window_s)}
            for key, idx, meta in output_indices(cfg.engine)]
    d = ci.mean(0) / window_s - cb.mean(0) / window_s
    changed = np.argsort(-np.abs(d), kind="stable")[:20]
    return {
        "baseline_run_id": base.id, "intervention_run_id": inter.id,
        "silenced": inter.summary["silenced"],
        "rate_window_ms": list(cfg.window_ms),
        "pairing": "Trial k of baseline and intervention used the same seed sequence [seed, k], "
                   "so both received identical sensory input events (numba-port/synthetic) or identical "
                   "Brian2 RNG streams (brian2-reference).",
        "outputs": outs,
        "most_changed": [{**neuron_label(cfg.engine, int(i)), "baseline_rate_hz": float(cb[:, i].mean() / window_s),
                          "intervention_rate_hz": float(ci[:, i].mean() / window_s), "delta_hz": float(d[i])}
                         for i in changed if d[i] != 0],
        "interpretation": "Result within this model under its assumptions; not a validated prediction about a living fly.",
    }


# ------------------------------------------------------------------ persistence / export

def public_summary(run: Run) -> dict:
    return {k: v for k, v in run.summary.items() if not k.startswith("_")}


def persist(run: Run, directory: Path = RUNS_DIR) -> Path:
    return write_run(run, directory / run.id)


def write_run(run: Run, d: Path) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(run.config.model_dump_json(indent=1))
    # _mean_rates (one float per neuron) is only needed to build a live intervention summary
    (d / "summary.json").write_text(json.dumps({k: v for k, v in run.summary.items() if k != "_mean_rates"}))
    (d / "provenance.json").write_text(json.dumps(provenance(run), indent=1))
    spikes_frame(run).to_parquet(d / "spikes.parquet", compression="zstd")
    return d


def spikes_frame(run: Run) -> pd.DataFrame:
    rows_t, rows_i, rows_k = [], [], []
    for k, (sn, ss) in enumerate(zip(run.raw["spike_neuron"], run.raw["spike_step"])):
        rows_i.append(sn)
        rows_t.append(ss)
        rows_k.append(np.full(len(sn), k, dtype=np.int32))
    i = np.concatenate(rows_i) if rows_i else np.array([], np.int32)
    return pd.DataFrame({"trial": np.concatenate(rows_k) if rows_k else np.array([], np.int32),
                         "step": np.concatenate(rows_t) if rows_t else np.array([], np.int32),
                         "neuron_index": i})


def load_run(d: Path, mode: str = "replay") -> Run:
    cfg = ExperimentConfig.model_validate_json((d / "config.json").read_text())
    summary = json.loads((d / "summary.json").read_text())
    df = pd.read_parquet(d / "spikes.parquet")
    n_trials = cfg.n_trials
    sn = [df.neuron_index.to_numpy()[df.trial.to_numpy() == k].astype(np.int32) for k in range(n_trials)]
    ss = [df.step.to_numpy()[df.trial.to_numpy() == k].astype(np.int32) for k in range(n_trials)]
    raw = {"spike_neuron": sn, "spike_step": ss, "dt": summary["dt_ms"] / 1000, "n_steps": summary["n_steps"],
           "n_neurons": summary["network"]["n_neurons"], "stim_idx": [], "silenced_idx": [],
           "timing": summary["timing"], "backend": summary["backend"]}
    summary = summary | {"mode": mode}
    return Run(id=summary["run_id"], kind=summary["kind"], mode=mode, config=cfg, raw=raw,
               created=summary["created"], summary=summary, baseline_run_id=summary.get("baseline_run_id"))


def provenance(run: Run) -> dict:
    rec = upstream.provenance_record() if run.engine != "synthetic" else {
        "model": {"name": "SYNTHETIC DEMO", "note": synthetic.SYNTHETIC_PARAMS_NOTE},
        "dataset": {"id": "synthetic", "label": synthetic.SYNTHETIC_LABEL}}
    rec.pop("upstream_status", None)
    return {
        **rec,
        "run_id": run.id, "kind": run.kind, "mode": run.mode,
        "baseline_run_id": run.baseline_run_id,
        "config": json.loads(run.config.model_dump_json()),
        "seed_scheme": "trial k uses numpy SeedSequence([seed, k]) (numba-port/synthetic: PCG64 Poisson draws; "
                       "brian2-reference: brian2.seed(SeedSequence([seed,k]).generate_state(1)[0] mod 2^31))",
        "simulation_backend": run.summary["backend"],
        "timing": run.summary["timing"],
        "dt_ms": run.summary["dt_ms"],
        "generated_by": "FlyBrain Arcade",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(run.created)),
    }


def export_csv(run: Run, what: str) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    if what == "rates":
        dt = run.raw["dt"]
        wa, wb = metrics.window_steps(run.config.window_ms, dt)
        window_s = (wb - wa) * dt
        counts = metrics.counts_in_window(run.raw["spike_neuron"], run.raw["spike_step"], run.raw["n_neurons"], (wa, wb))
        w.writerow(["# run_id", run.id, "window_ms", *run.config.window_ms, "mode", run.mode, "engine", run.engine])
        w.writerow(["neuron_id", "name", "group", "trial", "spike_count", "rate_hz"])
        # labels come from the stored summary, so replays export without the upstream catalog
        for r in run.summary["raster_rows"]:
            i = r["index"]
            for k in range(counts.shape[0]):
                w.writerow([r["id"], r["name"] or "", r.get("group", ""), k, int(counts[k, i]), counts[k, i] / window_s])
    elif what == "spikes":
        rows = run.summary["raster_rows"]
        sel = {r["index"]: r for r in rows}
        dt = run.raw["dt"]
        w.writerow(["# run_id", run.id, "selection", f"{len(rows)} raster neurons", "mode", run.mode, "engine", run.engine])
        w.writerow(["trial", "time_ms", "neuron_id", "name", "group"])
        for k, (sn, ss) in enumerate(zip(run.raw["spike_neuron"], run.raw["spike_step"])):
            m = np.isin(sn, list(sel))
            for i, s in zip(sn[m], ss[m]):
                r = sel[int(i)]
                w.writerow([k, round(float(s) * dt * 1000, 2), r["id"], r["name"] or "", r["group"]])
    else:
        raise ValueError(what)
    return buf.getvalue()


def new_run_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
