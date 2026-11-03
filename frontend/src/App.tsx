// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, waitForJob } from "./api";
import { ComparisonPanel, OutputRates, RasterChart, ScheduleChart } from "./components/Charts";
import { Controls, SilencePicker } from "./components/Controls";
import { FlyStage } from "./components/FlyStage";
import { AssumptionsPanel, ExportPanel, Header, PerformancePanel, ProvenancePanel, ReplayPicker, UnavailableBanner } from "./components/Info";
import { usePrefersReducedMotion } from "./components/Panel";
import type { Comparison, ExperimentConfig, Job, NeuronGroup, ReplayMeta, RunSummary, Status } from "./types";

const Arena = lazy(() => import("./components/Arena"));

class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="banner error-banner" role="alert">
        This part of the app could not be loaded (the app was probably rebuilt).{" "}
        <button type="button" className="btn small" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}

const DEFAULT_CFG: ExperimentConfig = {
  engine: "numba-port",
  duration_ms: 1000,
  seed: 1,
  n_trials: 10,
  stimulus: { target: "sugar_grns", rate_hz: 100, onset_ms: 0, offset_ms: null },
  silenced_ids: [],
  rate_window_ms: null,
};

type Groups = { silencing_groups: NeuronGroup[]; all_cell_types: NeuronGroup[]; synthetic_groups: NeuronGroup[] };

export default function App() {
  const prefersReduced = usePrefersReducedMotion();
  const [reducedOverride, setReducedOverride] = useState<boolean | null>(null);
  const reduced = reducedOverride ?? prefersReduced;
  const [tab, setTab] = useState<"experiment" | "arena">("experiment");
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [replays, setReplays] = useState<ReplayMeta[]>([]);
  const [cfg, setCfg] = useState<ExperimentConfig>(DEFAULT_CFG);
  const [baseline, setBaseline] = useState<RunSummary | null>(null);
  const [intervention, setIntervention] = useState<RunSummary | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [silenced, setSilenced] = useState<Map<string, string>>(new Map());
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollStop = useRef({ stopped: false });
  const busy = !!job && (job.status === "queued" || job.status === "running");

  // status: poll until the worker reports ready
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const s = await api.status();
        if (!live) return;
        setStatus(s);
        setStatusErr(null);
        if (!s.upstream.available) setCfg((c) => (c.engine === "synthetic" ? c : { ...c, engine: "synthetic" }));
        if (!s.worker.ready) timer = setTimeout(load, 1500);
      } catch (e) {
        if (!live) return;
        setStatusErr("Cannot reach the FlyBrain backend. Is the server running? (" + String((e as Error).message) + ")");
        timer = setTimeout(load, 3000);
      }
    };
    load();
    api.groups().then(setGroups).catch(() => undefined);
    api.replays().then(setReplays).catch(() => undefined);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  const runJob = useCallback(async (start: () => Promise<Job>): Promise<RunSummary | null> => {
    setError(null);
    pollStop.current = { stopped: false };
    try {
      const j = await start();
      setJob(j);
      const done = await waitForJob(j.id, setJob, pollStop.current);
      if (done.status !== "done" || !done.run_id) return null;
      return await api.run(done.run_id);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      return null;
    }
  }, []);

  const onBaseline = async () => {
    setIntervention(null);
    setComparison(null);
    setSilenced(new Map());
    const r = await runJob(() => api.baseline({ ...cfg, silenced_ids: [] }));
    if (r) setBaseline(r);
  };

  const onIntervention = async () => {
    if (!baseline) return;
    const r = await runJob(() => api.intervention(baseline.run_id, [...silenced.keys()]));
    if (r) {
      setIntervention(r);
      try {
        setComparison(await api.compare(baseline.run_id, r.run_id));
      } catch (e) {
        setError(String((e as Error).message));
      }
    }
  };

  const onCancel = async () => {
    if (job) setJob(await api.cancel(job.id));
  };

  const onReset = async () => {
    if (busy && job) {
      pollStop.current.stopped = true;
      await api.cancel(job.id).catch(() => undefined);
    }
    setJob(null);
    setBaseline(null);
    setIntervention(null);
    setComparison(null);
    setSilenced(new Map());
    setError(null);
    setCfg((c) => ({ ...c, silenced_ids: [] })); // keep seed and settings for exact reuse
  };

  const onLoadReplay = async (name: string) => {
    setError(null);
    try {
      const r = await api.loadReplay(name);
      const b = r.runs.baseline ? await api.run(r.runs.baseline) : null;
      const i = r.runs.intervention ? await api.run(r.runs.intervention) : null;
      setJob(null);
      setBaseline(b);
      setIntervention(i);
      if (b) setCfg(b.config);
      setSilenced(new Map((i?.silenced ?? []).map((n) => [n.id, n.name ?? n.id])));
      setComparison(b && i ? await api.compare(b.run_id, i.run_id) : null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  const mode = baseline?.mode ?? null;

  return (
    <div className={`app ${reduced ? "reduced" : ""} ${mode === "synthetic" ? "is-synthetic" : ""}`}>
      <a className="skip" href="#controls">
        Skip to controls
      </a>
      <Header status={status} mode={mode} engine={baseline ? baseline.config.engine : null} reduced={reduced} setReduced={(v) => setReducedOverride(v)} />
      {statusErr && (
        <div className="banner error-banner" role="alert">
          {statusErr}
        </div>
      )}
      <UnavailableBanner status={status} />
      {status && !status.worker.ready && !statusErr && (
        <div className="banner info-banner" role="status">
          Simulation worker is starting (compiling kernels and loading 14.7 M connections)…
        </div>
      )}
      {mode === "synthetic" && (
        <div className="banner synth-banner" role="note">
          SYNTHETIC DEMO: an invented 400-neuron network driven by the upstream equations. Nothing shown is the published fly-brain model or FlyWire data.
        </div>
      )}
      {mode === "replay" && (
        <div className="banner replay-banner" role="note">
          REPLAY of precomputed results ({baseline?.config.engine}, seed {baseline?.config.seed}). This is not a live simulation; see Model provenance for parameters.
        </div>
      )}
      {error && (
        <div className="banner error-banner" role="alert">
          {error}
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="Experiences">
        <button role="tab" type="button" aria-selected={tab === "experiment"} className={tab === "experiment" ? "on" : ""} onClick={() => setTab("experiment")}>
          Sugar, Spikes &amp; Silence
        </button>
        <button role="tab" type="button" aria-selected={tab === "arena"} className={tab === "arena" ? "on" : ""} onClick={() => setTab("arena")}>
          Arena · hybrid demo
        </button>
      </nav>

      {tab === "experiment" ? (
        <main className="layout">
          <aside className="side">
            <Controls status={status} cfg={cfg} setCfg={setCfg} job={job} baseline={baseline} intervention={intervention} silenced={silenced} onBaseline={onBaseline} onIntervention={onIntervention} onCancel={onCancel} onReset={onReset} busy={busy} />
            <SilencePicker cfg={cfg} groups={groups} baseline={baseline} silenced={silenced} setSilenced={setSilenced} onIntervention={onIntervention} busy={busy} />
            <ReplayPicker replays={replays} onLoad={onLoadReplay} busy={busy} />
          </aside>
          <div className="main">
            <FlyStage baseline={baseline} intervention={intervention} reducedMotion={reduced} mode={mode} />
            <OutputRates baseline={baseline} intervention={intervention} />
            <ComparisonPanel comparison={comparison} />
            <ScheduleChart baseline={baseline} intervention={intervention} />
            <RasterChart baseline={baseline} intervention={intervention} />
            <ExportPanel baseline={baseline} intervention={intervention} />
          </div>
          <div className="wide">
            <ProvenancePanel status={status} run={intervention ?? baseline} />
            <AssumptionsPanel />
            <PerformancePanel status={status} />
          </div>
        </main>
      ) : (
        <ChunkBoundary>
          <Suspense fallback={<p className="empty">Loading arena…</p>}>
            <Arena status={status} reducedMotion={reduced} />
          </Suspense>
        </ChunkBoundary>
      )}
      <footer className="foot">
        Model: Shiu et al., Nature 634, 210–219 (2024), MIT-licensed code by P. Shiu &amp; N. Spiller. Data: FlyWire v630. FlyBrain Arcade is a visualisation; results are within-model outputs.
      </footer>
    </div>
  );
}
