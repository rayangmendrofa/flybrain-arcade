"""Background simulation jobs.

One long-lived worker *process* owns simulation time, state and random seeds;
the web server only enqueues bounded configurations and receives batched
results. Cancellation is cooperative for the Numba engine (checked between
chunks of simulated time) and falls back to terminating and respawning the
worker (always used for Brian2, whose ``Network.run`` cannot be interrupted).
"""

from __future__ import annotations

import multiprocessing as mp
import os
import platform
import queue
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .experiment import ExperimentConfig

CANCEL_GRACE_S = 5.0


# --------------------------------------------------------------------------- worker side

def _resolve(cfg: ExperimentConfig):
    """Map a config to (network, params, stim indices, silenced indices, label)."""
    from . import network, neurons, synthetic, upstream

    if cfg.engine == "synthetic":
        net = synthetic.synthetic_network()
        p = synthetic.synthetic_params()
        stim = list(synthetic.SYN_SENSORY)
        sil = [int(s[4:]) for s in cfg.silenced_ids]
        if any(i >= net.n for i in sil):
            raise ValueError("Unknown synthetic neuron ID")
        return net, p, stim, sil
    p = upstream.upstream_params()
    cat = neurons.catalog()
    stim = [cat.index_of(i) for i in neurons.SUGAR_GRNS_UPSTREAM]
    sil = [cat.index_of(int(s)) for s in cfg.silenced_ids]
    net = network.load_network() if cfg.engine == "numba-port" else None
    return net, p, stim, sil


def _peak_mem() -> int | None:
    try:
        import psutil
        m = psutil.Process().memory_info()
        return int(getattr(m, "peak_wset", 0) or m.rss)
    except Exception:  # pragma: no cover
        return None


def run_job(cfg: ExperimentConfig, progress: Callable[[float], None], should_cancel: Callable[[], bool]) -> dict:
    """Execute one experiment configuration. Runs inside the worker process (or tests)."""
    from . import engine_fast as ef

    net, p, stim, sil = _resolve(cfg)
    dur = cfg.duration_ms / 1000
    t0 = time.perf_counter()
    if cfg.engine in ("numba-port", "synthetic"):
        group = ef.StimGroup(tuple(stim), cfg.stimulus.rate_hz, cfg.stimulus.onset_ms / 1000, cfg.stim_offset_ms / 1000)
        res = ef.run_trials(net, p, [group], sil, dur, cfg.seed, cfg.n_trials,
                            progress=progress, should_cancel=should_cancel)
        neurons_out = res.spike_neuron
        steps_out = res.spike_step
        n_steps, dt = res.n_steps, res.dt
        backend = {"engine": cfg.engine, "implementation": "Numba port of upstream Brian2 update (validated)",
                   "numba_threads": _numba_threads()}
        n_neurons = net.n
    else:
        import numpy as np
        from .engine_brian2 import run_reference_trial

        neurons_out, steps_out = [], []
        for k in range(cfg.n_trials):
            if should_cancel():
                raise ef.Cancelled()
            seed_k = int(np.random.SeedSequence([cfg.seed, k]).generate_state(1)[0] % (2**31))
            r = run_reference_trial(stim, cfg.stimulus.rate_hz, sil, dur, seed_k)
            neurons_out.append(r.spike_neuron.astype(np.int32))
            steps_out.append(r.spike_step.astype(np.int32))
            progress((k + 1) / cfg.n_trials)
        n_steps, dt = r.n_steps, r.dt
        backend = {"engine": cfg.engine, "implementation": f"Upstream model.py on Brian2 {r.brian2_version} (numpy runtime target)"}
        from .neurons import catalog
        n_neurons = catalog().n
    wall = time.perf_counter() - t0
    return {
        "spike_neuron": neurons_out, "spike_step": steps_out, "n_steps": n_steps, "dt": dt, "n_neurons": n_neurons,
        "stim_idx": stim, "silenced_idx": sil,
        "timing": {"wall_s": wall, "simulated_s": dur * cfg.n_trials, "simulated_s_per_trial": dur,
                   "wall_per_simulated_s": wall / (dur * cfg.n_trials)},
        "backend": backend | {"cpu": platform.processor(), "python": platform.python_version(),
                              "worker_peak_memory_bytes": _peak_mem()},
    }


def _numba_threads() -> int | None:
    try:
        import numba
        return int(numba.get_num_threads())
    except Exception:  # pragma: no cover
        return None


def worker_main(req_q, res_q, cancel_val) -> None:  # pragma: no cover - exercised via the API
    from . import engine_fast as ef, network, upstream

    # Warm up: compile/load the Numba kernels and preload the network so the
    # first experiment does not pay these costs.
    info: dict = {"pid": os.getpid(), "numba_threads": _numba_threads(), "params": None, "warmup_error": None}
    try:
        t0 = time.perf_counter()
        ef.warmup()
        if upstream.check_upstream().available:
            network.load_network()
            info["params"] = upstream.upstream_params().as_dict()
        info["warmup_s"] = time.perf_counter() - t0
    except Exception as e:
        info["warmup_error"] = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    res_q.put(("ready", None, info))
    while True:
        item = req_q.get()
        if item is None:
            return
        job_id, job_num, kind, cfg_json = item
        last = [0.0]

        def progress(f: float) -> None:
            now = time.perf_counter()
            if now - last[0] > 0.2 or f >= 1:
                last[0] = now
                res_q.put(("progress", job_id, f))

        def should_cancel() -> bool:
            return cancel_val.value == job_num

        res_q.put(("started", job_id, None))
        try:
            if kind == "arena":
                from .arena.core import ArenaConfig
                from .arena.episode import run_episode

                out = run_episode(ArenaConfig.model_validate_json(cfg_json), progress, should_cancel)
            else:
                out = run_job(ExperimentConfig.model_validate_json(cfg_json), progress, should_cancel)
            res_q.put(("done", job_id, out))
        except ef.Cancelled:
            res_q.put(("cancelled", job_id, None))
        except Exception as e:  # report, never crash the worker
            res_q.put(("error", job_id, f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"))


# --------------------------------------------------------------------------- server side

@dataclass
class Job:
    id: str
    num: int
    config: Any  # ExperimentConfig or arena.core.ArenaConfig
    kind: str  # "baseline" | "intervention" | "arena"
    baseline_run_id: str | None = None
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float = 0.0
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    error: str | None = None
    run_id: str | None = None

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "status": self.status, "progress": self.progress,
                "created": self.created, "started": self.started, "finished": self.finished,
                "error": self.error, "run_id": self.run_id, "engine": self.config.engine,
                "baseline_run_id": self.baseline_run_id}


class JobManager:
    """Owns the worker process; runs one job at a time in FIFO order."""

    def __init__(self, on_done: Callable[[Job, dict], str]):
        self._ctx = mp.get_context("spawn")
        self._on_done = on_done
        self._lock = threading.Lock()
        self.jobs: dict[str, Job] = {}
        self.worker_info: dict | None = None
        self._pending: queue.Queue[Job] = queue.Queue()
        self._num = 0
        self._events: queue.Queue = queue.Queue()
        self._cancel_requested_at: float | None = None
        self._generation = 0
        self._start_worker()
        threading.Thread(target=self._dispatch_loop, daemon=True, name="job-dispatch").start()

    # worker lifecycle
    def _start_worker(self) -> None:
        self._generation += 1
        self._req_q = self._ctx.Queue()
        self._res_q = self._ctx.Queue()
        self._cancel = self._ctx.Value("q", -1)
        self._proc = self._ctx.Process(target=worker_main, args=(self._req_q, self._res_q, self._cancel),
                                       daemon=True, name="flybrain-worker")
        self._proc.start()
        threading.Thread(target=self._reader, args=(self._res_q, self._generation), daemon=True,
                         name="job-results").start()

    def _reader(self, res_q, generation: int) -> None:
        while generation == self._generation:
            try:
                kind, jid, payload = res_q.get(timeout=0.5)
            except queue.Empty:
                continue
            except (EOFError, OSError):
                return
            if kind == "ready":
                self.worker_info = payload
            else:
                self._events.put((kind, jid, payload))

    def _restart_worker(self) -> None:
        try:
            self._proc.terminate()
            self._proc.join(5)
        except Exception:
            pass
        self.worker_info = None
        self._start_worker()

    def shutdown(self) -> None:
        self._generation += 1
        try:
            self._req_q.put(None)
            self._proc.join(2)
        finally:
            if self._proc.is_alive():
                self._proc.terminate()

    # public API
    def submit(self, cfg: Any, kind: str, baseline_run_id: str | None = None) -> Job:
        with self._lock:
            self._num += 1
            job = Job(id=uuid.uuid4().hex[:12], num=self._num, config=cfg, kind=kind, baseline_run_id=baseline_run_id)
            self.jobs[job.id] = job
        self._pending.put(job)
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        if job is None:
            return None
        with self._lock:
            if job.status == "queued":
                job.status = "cancelled"
                job.finished = time.time()
            elif job.status == "running":
                self._cancel.value = job.num
                self._cancel_requested_at = time.perf_counter()
        return job

    def queue_position(self, job: Job) -> int:
        return sum(1 for j in self.jobs.values() if j.status == "queued" and j.num < job.num)

    # dispatch
    def _dispatch_loop(self) -> None:
        while True:
            job = self._pending.get()
            if job.status == "cancelled":
                continue
            self._cancel_requested_at = None
            job.status, job.started = "running", time.time()
            self._req_q.put((job.id, job.num, job.kind, job.config.model_dump_json()))
            self._wait_for(job)

    def _wait_for(self, job: Job) -> None:
        while True:
            # Hard cancel: Brian2 runs, or cooperative cancel not honoured in time.
            if self._cancel_requested_at is not None:
                waited = time.perf_counter() - self._cancel_requested_at
                if job.config.engine == "brian2-reference" or waited > CANCEL_GRACE_S:
                    self._restart_worker()
                    self._finish(job, "cancelled")
                    return
            if not self._proc.is_alive():
                self._restart_worker()
                self._finish(job, "error", "Simulation worker exited unexpectedly (out of memory?)")
                return
            try:
                kind, jid, payload = self._events.get(timeout=0.2)
            except queue.Empty:
                continue
            if jid != job.id:
                continue  # stale item from a cancelled job
            if kind == "progress":
                job.progress = float(payload)
            elif kind == "done":
                try:
                    job.run_id = self._on_done(job, payload)
                    job.progress = 1.0
                    self._finish(job, "done")
                except Exception as e:
                    self._finish(job, "error", f"Result processing failed: {type(e).__name__}: {e}")
                return
            elif kind == "cancelled":
                self._finish(job, "cancelled")
                return
            elif kind == "error":
                self._finish(job, "error", str(payload))
                return

    def _finish(self, job: Job, status: str, error: str | None = None) -> None:
        with self._lock:
            job.status, job.error, job.finished = status, error, time.time()
            self._cancel.value = -1
            self._cancel_requested_at = None


def run_inline(cfg: ExperimentConfig) -> dict[str, Any]:
    """Synchronous execution (tests, scripts)."""
    return run_job(cfg, lambda f: None, lambda: False)
