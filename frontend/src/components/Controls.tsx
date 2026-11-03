// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { useMemo, useState } from "react";
import { api } from "../api";
import type { Engine, ExperimentConfig, Job, NeuronGroup, RunSummary, Status } from "../types";
import { CategoryTag, fmt, Panel, shortId } from "./Panel";

const DURATIONS = [250, 500, 1000, 2000];

export function estimateSeconds(status: Status | null, cfg: ExperimentConfig): number | null {
  const rows = status?.benchmark?.rows.filter((r) => r.engine === cfg.engine) ?? [];
  if (!rows.length) return null;
  // use the most relevant measured ratio (wall s per simulated s) for this engine
  const multi = rows.find((r) => r.trials > 1) ?? rows[0];
  const single = rows.find((r) => r.trials === 1) ?? rows[0];
  const ratio = cfg.n_trials > 1 ? multi.wall_per_simulated_s : single.wall_per_simulated_s;
  return (ratio * cfg.n_trials * cfg.duration_ms) / 1000;
}

export function Controls(props: {
  status: Status | null;
  cfg: ExperimentConfig;
  setCfg: (c: ExperimentConfig) => void;
  job: Job | null;
  baseline: RunSummary | null;
  intervention: RunSummary | null;
  silenced: Map<string, string>;
  onBaseline: () => void;
  onIntervention: () => void;
  onCancel: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const { status, cfg, setCfg, job, baseline, busy } = props;
  const eng = status?.engines[cfg.engine];
  const wholeTrial = cfg.stimulus.offset_ms == null && cfg.stimulus.onset_ms === 0;
  const est = estimateSeconds(status, cfg);
  const set = (patch: Partial<ExperimentConfig>) => setCfg({ ...cfg, ...patch });
  const setStim = (patch: Partial<ExperimentConfig["stimulus"]>) => setCfg({ ...cfg, stimulus: { ...cfg.stimulus, ...patch } });
  const baselineLocked = !!baseline;

  const changeEngine = (e: Engine) => {
    const max = status?.engines[e];
    const next: ExperimentConfig = {
      ...cfg,
      engine: e,
      n_trials: Math.min(cfg.n_trials, max?.max_trials ?? 30),
      duration_ms: Math.min(cfg.duration_ms, max?.max_duration_ms ?? 2000),
      silenced_ids: [],
    };
    if (e === "brian2-reference") next.stimulus = { ...next.stimulus, onset_ms: 0, offset_ms: null };
    setCfg(next);
  };

  return (
    <Panel title="1 · Stimulate" cats={["data", "model"]} id="controls">
      <fieldset disabled={busy || baselineLocked} className="ctl">
        <legend className="sr-only">Experiment configuration</legend>
        {baselineLocked && <p className="note">Configuration is locked to the baseline so the intervention repeats it exactly. Press Reset to change it.</p>}
        <label className="row">
          <span>Engine</span>
          <select value={cfg.engine} onChange={(e) => changeEngine(e.target.value as Engine)}>
            {(["numba-port", "brian2-reference", "synthetic"] as Engine[]).map((e) => (
              <option key={e} value={e} disabled={!status?.engines[e]?.available}>
                {e === "numba-port" ? "Upstream model (Numba port, validated)" : e === "brian2-reference" ? "Upstream model.py on Brian2 (reference, slow)" : "SYNTHETIC DEMO (not biological)"}
              </option>
            ))}
          </select>
        </label>
        <p className="fine muted">{eng?.label}</p>

        <div className="row">
          <span>Target</span>
          <span>
            {cfg.engine === "synthetic" ? "12 synthetic sensory neurons" : "21 labellar sugar GRNs"} <CategoryTag cat="data" compact />
          </span>
        </div>
        {cfg.engine !== "synthetic" && <p className="fine muted">IDs from upstream example.ipynb / figures.ipynb Fig. 1 (FlyWire v630).</p>}

        <label className="row">
          <span>
            Poisson rate <span className="muted">(upstream r_poi)</span>
          </span>
          <span className="inline">
            <input type="range" min={0} max={200} step={5} value={cfg.stimulus.rate_hz} onChange={(e) => setStim({ rate_hz: Number(e.target.value) })} aria-label="Stimulation rate in hertz" />
            <input type="number" min={0} max={200} step={1} className="num" value={cfg.stimulus.rate_hz} onChange={(e) => setStim({ rate_hz: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} aria-label="Stimulation rate value" />
            Hz
          </span>
        </label>
        <p className="fine muted">Bounded to 0–200 Hz (paper Fig. 1d range 10–200 Hz for sugar GRNs; 0 Hz = no-stimulus control).</p>

        <label className="row">
          <span>Simulated duration</span>
          <select value={cfg.duration_ms} onChange={(e) => {
            const d = Number(e.target.value);
            setCfg({ ...cfg, duration_ms: d, stimulus: { ...cfg.stimulus, offset_ms: cfg.stimulus.offset_ms == null ? null : Math.min(cfg.stimulus.offset_ms, d), onset_ms: Math.min(cfg.stimulus.onset_ms, d - 50) }, rate_window_ms: null });
          }}>
            {DURATIONS.filter((d) => d <= (eng?.max_duration_ms ?? 2000)).map((d) => (
              <option key={d} value={d}>
                {d} ms{d === 1000 ? " (upstream trial length)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="row">
          <span>Schedule</span>
          <label className="inline">
            <input type="checkbox" checked={wholeTrial} disabled={cfg.engine === "brian2-reference"} onChange={(e) => setStim(e.target.checked ? { onset_ms: 0, offset_ms: null } : { onset_ms: Math.round(cfg.duration_ms * 0.2), offset_ms: Math.round(cfg.duration_ms * 0.8) })} />
            whole trial (upstream protocol)
          </label>
        </div>
        {!wholeTrial && (
          <div className="row">
            <span>
              Window <CategoryTag cat="app" compact />
            </span>
            <span className="inline">
              on <input type="number" className="num" min={0} max={cfg.duration_ms - 5} step={5} value={cfg.stimulus.onset_ms} onChange={(e) => setStim({ onset_ms: Number(e.target.value) || 0 })} aria-label="Stimulation onset in ms" />
              off <input type="number" className="num" min={5} max={cfg.duration_ms} step={5} value={cfg.stimulus.offset_ms ?? cfg.duration_ms} onChange={(e) => setStim({ offset_ms: Number(e.target.value) || cfg.duration_ms })} aria-label="Stimulation offset in ms" />
              ms
            </span>
          </div>
        )}
        {!wholeTrial && <p className="fine muted">Gating the same Poisson mechanism in time is an application extension; upstream always stimulates for the whole trial.</p>}

        <label className="row">
          <span>Rate window</span>
          <select
            value={cfg.rate_window_ms == null ? "trial" : "stim"}
            onChange={(e) => set({ rate_window_ms: e.target.value === "trial" ? null : [cfg.stimulus.onset_ms, cfg.stimulus.offset_ms ?? cfg.duration_ms] })}
          >
            <option value="trial">whole trial (upstream get_rate)</option>
            <option value="stim" disabled={wholeTrial}>
              stimulation window only
            </option>
          </select>
        </label>

        <label className="row">
          <span>Trials (seeds)</span>
          <span className="inline">
            <input type="number" className="num" min={1} max={eng?.max_trials ?? 30} value={cfg.n_trials} onChange={(e) => set({ n_trials: Math.max(1, Math.min(eng?.max_trials ?? 30, Number(e.target.value) || 1)) })} />
            <span className="muted">max {eng?.max_trials ?? 30}; upstream used 30</span>
          </span>
        </label>

        <label className="row">
          <span>Random seed</span>
          <span className="inline">
            <input type="number" className="num wide" min={0} max={2147483647} value={cfg.seed} onChange={(e) => set({ seed: Math.max(0, Math.min(2147483647, Math.floor(Number(e.target.value) || 0))) })} />
            <button type="button" className="btn ghost" onClick={() => set({ seed: Math.floor(Math.random() * 2147483647) })} title="Draw a new seed">
              🎲 new
            </button>
          </span>
        </label>
        <p className="fine muted">Same seed ⇒ identical input events and identical results. Trial k uses seed sequence [seed, k].</p>
      </fieldset>

      <div className="btn-row">
        <button type="button" className="btn primary" onClick={props.onBaseline} disabled={busy || !eng?.available || baselineLocked}>
          ▶ Run baseline
        </button>
        <button type="button" className="btn" onClick={props.onReset} disabled={busy && !job}>
          ↺ Reset
        </button>
      </div>
      {est != null && !baselineLocked && (
        <p className="fine muted">
          Estimated wall-clock ≈ {fmt(est, est < 10 ? 1 : 0)} s for {fmt((cfg.n_trials * cfg.duration_ms) / 1000, 2)} s simulated (from the measured benchmark on this machine).
        </p>
      )}
      <JobStatus job={job} onCancel={props.onCancel} />
    </Panel>
  );
}

export function JobStatus({ job, onCancel }: { job: Job | null; onCancel: () => void }) {
  if (!job) return <div aria-live="polite" className="sr-only" />;
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className={`job job-${job.status}`} aria-live="polite">
      <div className="job-line">
        <span>
          {job.kind} · {job.engine} ·{" "}
          <strong>
            {job.status === "queued" ? `queued${job.queue_position ? ` (#${job.queue_position + 1})` : ""}` : job.status}
          </strong>
        </span>
        {active && (
          <button type="button" className="btn danger small" onClick={onCancel}>
            ✕ Cancel
          </button>
        )}
      </div>
      {active && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} aria-label="Simulation progress (fraction of simulated time completed)">
          <div style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
        </div>
      )}
      {job.status === "running" && job.started && <span className="fine muted">Running in the background worker; the page stays responsive. Wall-clock {fmt(Date.now() / 1000 - job.started, 0)} s.</span>}
      {job.status === "error" && <pre className="error">{job.error}</pre>}
      {job.status === "cancelled" && <span className="fine">Cancelled — no partial results are shown.</span>}
    </div>
  );
}

export function SilencePicker(props: {
  cfg: ExperimentConfig;
  groups: { silencing_groups: NeuronGroup[]; all_cell_types: NeuronGroup[]; synthetic_groups: NeuronGroup[] } | null;
  baseline: RunSummary | null;
  silenced: Map<string, string>;
  setSilenced: (m: Map<string, string>) => void;
  onIntervention: () => void;
  busy: boolean;
}) {
  const { cfg, groups, baseline, silenced, setSilenced, busy } = props;
  const [filter, setFilter] = useState("");
  const [idInput, setIdInput] = useState("");
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const synthetic = cfg.engine === "synthetic";
  const verified = synthetic ? groups?.synthetic_groups ?? [] : groups?.silencing_groups ?? [];
  const others = useMemo(() => {
    if (synthetic || !groups) return [];
    const shown = new Set(verified.map((g) => g.key));
    const f = filter.trim().toLowerCase();
    return groups.all_cell_types.filter((g) => !shown.has(g.key) && (!f || g.label.toLowerCase().includes(f)));
  }, [groups, filter, synthetic, verified]);

  const groupState = (g: NeuronGroup) => {
    const n = g.ids.filter((i) => silenced.has(i)).length;
    return n === 0 ? false : n === g.ids.length ? true : "mixed";
  };
  const toggleGroup = (g: NeuronGroup) => {
    const m = new Map(silenced);
    if (groupState(g) === true) g.ids.forEach((i) => m.delete(i));
    else g.ids.forEach((i, k) => m.set(i, `${g.label}${g.ids.length > 1 ? ` #${k + 1}` : ""}`));
    setSilenced(m);
  };
  const toggleOne = (id: string, label: string) => {
    const m = new Map(silenced);
    if (m.has(id)) m.delete(id);
    else m.set(id, label);
    setSilenced(m);
  };
  const addId = async () => {
    const id = idInput.trim();
    setLookupMsg(null);
    if (!/^\d{15,20}$/.test(id)) return setLookupMsg("Enter a FlyWire v630 root ID (18 digits).");
    try {
      const r = await api.lookup(id);
      if (!r.found) return setLookupMsg(`Not in FlyWire v630 as packaged upstream (IDs differ between materializations; v783/MaleCNS IDs are not accepted).`);
      toggleOne(id, r.name ?? r.cell_type ?? `ID ${shortId(id)}`);
      setIdInput("");
    } catch (e) {
      setLookupMsg(String((e as Error).message));
    }
  };

  return (
    <Panel title="2 · Silence" cats={["data", "model"]} id="silence">
      {!baseline ? (
        <p className="empty">Run a baseline first. Silencing then repeats it with the same initial state, schedule and seeds.</p>
      ) : (
        <>
          <p className="fine">
            Upstream <code>silence()</code>: every <em>outgoing</em> synapse weight of a silenced neuron is set to 0. The neuron itself can still fire (e.g. if stimulated) but has no effect downstream.
            (The upstream README says "to and from"; the code and paper Methods — "eliminating all output" — remove output only.)
          </p>
          <h3>Verified groups</h3>
          <ul className="checklist">
            {verified.map((g) => {
              const st = groupState(g);
              return (
                <li key={g.key}>
                  <label>
                    <input type="checkbox" checked={st === true} ref={(el) => { if (el) el.indeterminate = st === "mixed"; }} onChange={() => toggleGroup(g)} disabled={busy} />
                    <strong>{g.label}</strong> <span className="muted">({g.ids.length} neuron{g.ids.length > 1 ? "s" : ""})</span>
                    <span className="fine muted"> · {g.paper_context}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {!synthetic && (
            <details>
              <summary>All {groups?.all_cell_types.length ?? 0} SEZ cell types from upstream (Fig. 2 list)</summary>
              <input type="search" placeholder="Filter cell types…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter cell types" className="search" />
              <ul className="checklist scroll">
                {others.map((g) => (
                  <li key={g.key}>
                    <label>
                      <input type="checkbox" checked={groupState(g) === true} onChange={() => toggleGroup(g)} disabled={busy} /> {g.label} <span className="muted">({g.ids.length})</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <h3>Top responsive neurons in this baseline</h3>
          <p className="fine muted">Ranked by baseline rate (stimulated GRNs excluded) — like the paper's Fig. 1f screen of the top sugar-responsive neurons.</p>
          <ul className="checklist scroll">
            {baseline.top_responsive.map((n) => (
              <li key={n.id}>
                <label>
                  <input type="checkbox" checked={silenced.has(n.id)} onChange={() => toggleOne(n.id, n.name ?? `ID ${shortId(n.id)}`)} disabled={busy} />
                  <span className="mono">{fmt(n.mean_rate_hz, 0)} Hz</span> {n.name ?? <span className="muted">unnamed in upstream files</span>} <span className="mono muted">{shortId(n.id)}</span>
                </label>
              </li>
            ))}
          </ul>
          {!synthetic && (
            <div className="row">
              <label className="inline grow">
                <span className="sr-only">FlyWire v630 ID</span>
                <input type="text" inputMode="numeric" placeholder="Add FlyWire v630 ID…" value={idInput} onChange={(e) => setIdInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addId()} />
              </label>
              <button type="button" className="btn ghost" onClick={addId} disabled={busy}>
                Add
              </button>
            </div>
          )}
          {lookupMsg && <p className="warn">{lookupMsg}</p>}
          <div className="chips" aria-label="Neurons selected for silencing">
            {[...silenced.entries()].map(([id, label]) => (
              <button type="button" key={id} className="chip" onClick={() => toggleOne(id, label)} title={`Remove ${id}`} disabled={busy}>
                {label} <span aria-hidden="true">×</span>
              </button>
            ))}
            {silenced.size === 0 && <span className="muted fine">Nothing selected.</span>}
          </div>
          <div className="btn-row">
            <button type="button" className="btn primary int" onClick={props.onIntervention} disabled={busy || silenced.size === 0 || silenced.size > 200 || baseline.mode === "replay"}>
              ▶ Run intervention ({silenced.size} silenced)
            </button>
          </div>
          {baseline.mode === "replay" && <p className="note">This is a replay: new interventions need a live baseline.</p>}
        </>
      )}
    </Panel>
  );
}
