// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { compareExportUrl, exportUrl } from "../api";
import { MAPPING } from "../lib/mapping";
import type { Mode, ReplayMeta, RunSummary, Status } from "../types";
import { CATEGORY, CategoryTag, fmt, Panel, type Category } from "./Panel";

export function ModeBadge({ mode, engine }: { mode: Mode | null; engine: string | null }) {
  if (!mode) return <span className="mode mode-idle">NO RUN YET</span>;
  const label = mode === "live" ? "LIVE SIMULATION" : mode === "replay" ? "REPLAY · precomputed" : "SYNTHETIC DEMO · not biological";
  return (
    <span className={`mode mode-${mode}`} role="status">
      {label}
      {engine && <span className="mode-eng"> · {engine}</span>}
    </span>
  );
}

export function Header(props: { status: Status | null; mode: Mode | null; engine: string | null; reduced: boolean; setReduced: (v: boolean) => void }) {
  const p = props.status?.provenance;
  return (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden="true">🪰</span>
        <div>
          <h1>FlyBrain Arcade</h1>
          <p className="sub">Sugar, Spikes &amp; Silence — stimulate sugar-sensing neurons, watch a feeding motor neuron, silence the circuit.</p>
        </div>
      </div>
      <div className="top-right">
        <ModeBadge mode={props.mode} engine={props.engine} />
        {p && props.mode !== "synthetic" && (
          <a className="prov-chip" href="#provenance" title="Model provenance">
            {p.dataset.id} · commit {p.model.commit_expected.slice(0, 7)}
          </a>
        )}
        {props.mode === "synthetic" && <span className="prov-chip">dataset: synthetic (invented)</span>}
        <label className="inline small">
          <input type="checkbox" checked={props.reduced} onChange={(e) => props.setReduced(e.target.checked)} /> reduce motion
        </label>
      </div>
      <div className="legend" aria-label="What each tag means">
        {(Object.keys(CATEGORY) as Category[]).map((c) => (
          <CategoryTag key={c} cat={c} />
        ))}
      </div>
    </header>
  );
}

export function UnavailableBanner({ status }: { status: Status | null }) {
  if (!status || status.upstream.available) return null;
  return (
    <div className="banner warn-banner" role="alert">
      <strong>The published model's data could not be loaded, so live simulation of the fly brain is unavailable.</strong>
      <ul>
        {status.upstream.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p>
        Fix: run <code>python scripts/fetch_upstream.py</code> (clones the upstream repository at the pinned commit, which contains the FlyWire v630 files). Meanwhile you can use a{" "}
        <strong>REPLAY</strong> of precomputed results or the clearly labelled <strong>SYNTHETIC DEMO</strong> engine.
      </p>
    </div>
  );
}

export function ReplayPicker({ replays, onLoad, busy }: { replays: ReplayMeta[]; onLoad: (name: string) => void; busy: boolean }) {
  if (!replays.length) return null;
  return (
    <Panel title="Replays (precomputed)" cats={["model"]} id="replays">
      <p className="fine">Replays show results computed earlier with the stated engine, parameters and seed. They are labelled REPLAY and are never presented as a live simulation.</p>
      <ul className="checklist">
        {replays.map((r) => (
          <li key={r.name}>
            <button type="button" className="btn ghost" onClick={() => onLoad(r.name)} disabled={busy}>
              Load
            </button>{" "}
            <strong>{r.title}</strong> <span className="fine muted">· {r.description} · computed {r.computed_at} with {r.engine}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ExportPanel({ baseline, intervention }: { baseline: RunSummary | null; intervention: RunSummary | null }) {
  if (!baseline) return null;
  const runs: [string, RunSummary | null][] = [
    ["Baseline", baseline],
    ["Intervention", intervention],
  ];
  return (
    <Panel title="Export & reproduce" cats={["model"]} id="export">
      <table className="tbl">
        <tbody>
          {runs.map(
            ([label, r]) =>
              r && (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>
                    <a href={exportUrl(r.run_id, "config.json")} download>
                      config JSON
                    </a>
                  </td>
                  <td>
                    <a href={exportUrl(r.run_id, "provenance.json")} download>
                      provenance JSON
                    </a>
                  </td>
                  <td>
                    <a href={exportUrl(r.run_id, "rates.csv")} download>
                      rate summary CSV
                    </a>
                  </td>
                  <td>
                    <a href={exportUrl(r.run_id, "spikes.csv")} download>
                      selected spikes CSV
                    </a>
                  </td>
                </tr>
              ),
          )}
          {intervention && (
            <tr>
              <th scope="row">Comparison</th>
              <td colSpan={4}>
                <a href={compareExportUrl(baseline.run_id, intervention.run_id)} download>
                  comparison JSON (with both provenance records)
                </a>{" "}
                · plots: use the SVG / PNG buttons on each chart
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="fine muted">
        The config JSON re-runs the same experiment (POST it to <code>/api/baseline</code>). Spike CSVs contain the bounded raster selection (≤ 80 neurons, all trials); full-network spikes are stored server-side in <code>data/runs/&lt;run&gt;/spikes.parquet</code>.
      </p>
    </Panel>
  );
}

export function ProvenancePanel({ status, run }: { status: Status | null; run: RunSummary | null }) {
  if (!status) return null;
  const p = status.provenance;
  const params = status.params;
  return (
    <Panel title="Model provenance" cats={["data", "model"]} id="provenance">
      <dl className="kv">
        <dt>Model</dt>
        <dd>
          <a href={p.model.repository} target="_blank" rel="noreferrer">
            philshiu/Drosophila_brain_model
          </a>{" "}
          @ <span className="mono">{p.model.commit_expected.slice(0, 12)}</span> ({p.model.commit_date}) · found: <span className="mono">{p.model.commit_found?.slice(0, 12) ?? "—"}</span> · {p.model.licence}
        </dd>
        <dt>Paper</dt>
        <dd>
          {p.model.paper} <span className="muted">({p.model.paper_licence})</span>
        </dd>
        <dt>Dataset</dt>
        <dd>
          {p.dataset.label}. <span className="muted">{p.dataset.neuron_id_system}.</span>
          <ul className="fine">
            {Object.values(p.dataset.files).map((f) => (
              <li key={f.name}>
                <span className="mono">{f.name}</span> · sha256 <span className="mono">{f.sha256.slice(0, 16)}…</span> {status.upstream.files[f.name]?.matches ? "✓ verified" : "✗ not verified"}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Equations</dt>
        <dd className="mono small">
          dv/dt = (v₀ − v + g)/τ_mbr ; dg/dt = −g/τ ; spike v &gt; v_th → v = v_rst, g = 0 ; on presynaptic spike (after t_dly): g += w
        </dd>
        <dt>Parameters (read from upstream model.py)</dt>
        <dd className="mono small">
          {params
            ? `v₀ ${fmt(Number(params.v_0) * 1e3)} mV · v_rst ${fmt(Number(params.v_rst) * 1e3)} mV · v_th ${fmt(Number(params.v_th) * 1e3)} mV · τ_mbr ${fmt(Number(params.t_mbr) * 1e3)} ms · τ ${fmt(Number(params.tau) * 1e3)} ms · t_rfc ${fmt(Number(params.t_rfc) * 1e3)} ms · t_dly ${fmt(Number(params.t_dly) * 1e3)} ms · w_syn ${fmt(Number(params.w_syn) * 1e3, 3)} mV/synapse · Poisson kick w_syn·f_poi = ${fmt(Number(params.w_syn) * Number(params.f_poi) * 1e3, 2)} mV · dt ${fmt(Number(params.dt) * 1e3)} ms (Brian2 default)`
            : "worker starting…"}
        </dd>
        <dt>Feeding output</dt>
        <dd>{status.feeding_output}</dd>
        {run && (
          <>
            <dt>This run</dt>
            <dd className="small">
              <span className="mono">{run.run_id}</span> · {String(run.backend.implementation ?? run.backend.engine)} · seed {run.config.seed} × {run.config.n_trials} trials · {run.network.n_neurons.toLocaleString()} neurons simulated,{" "}
              {run.network.n_active_neurons} fired · {fmt(run.timing.wall_s, 1)} s wall for {fmt(run.timing.simulated_s, 2)} s simulated
            </dd>
          </>
        )}
      </dl>
    </Panel>
  );
}

export function PerformancePanel({ status }: { status: Status | null }) {
  const b = status?.benchmark;
  return (
    <Panel title="Measured performance" cats={["model"]} id="performance">
      {!b ? (
        <p className="empty">No benchmark recorded yet (run scripts/benchmark.py).</p>
      ) : (
        <>
          <p className="fine">
            {b.hardware} · measured {b.measured_at}. Model size: {b.model_size.neurons.toLocaleString()} neurons, {b.model_size.connections.toLocaleString()} connections, {b.model_size.synapses.toLocaleString()} synapses. Nothing here is real-time unless the ratio is ≤ 1.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Engine</th>
                <th>Simulated</th>
                <th>Rate</th>
                <th>Wall-clock</th>
                <th>Wall s / simulated s</th>
                <th>Peak memory</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  <td>{r.engine}</td>
                  <td>
                    {r.trials} × {r.duration_ms} ms
                  </td>
                  <td>{r.rate_hz} Hz</td>
                  <td className="mono">{fmt(r.wall_s, 2)} s</td>
                  <td className="mono">{fmt(r.wall_per_simulated_s, 2)}</td>
                  <td className="mono">{r.peak_memory_gb == null ? "—" : `${fmt(r.peak_memory_gb, 2)} GB`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}

export function AssumptionsPanel() {
  return (
    <Panel title="What is measured, simulated and invented here" cats={["data", "model", "app"]} id="assumptions">
      <div className="three">
        <div>
          <h3>
            <CategoryTag cat="data" />
          </h3>
          <ul>
            <li>FlyWire v630 synapse counts between 127,400 proofread neurons (connectome; automated synapse detection).</li>
            <li>Excitatory/inhibitory sign per neuron from neurotransmitter predictions (GABA &amp; glutamate → inhibitory), as packaged upstream.</li>
            <li>Neuron identities used here: 21 sugar GRNs, two MN9s, SEZ cell types — all copied from upstream files.</li>
          </ul>
        </div>
        <div>
          <h3>
            <CategoryTag cat="model" />
          </h3>
          <ul>
            <li>Leaky integrate-and-fire neurons, identical parameters for all; one free parameter (w_syn).</li>
            <li>No gap junctions, neuromodulation, neuropeptides, morphology or receptor dynamics; baseline rate 0 Hz, so inhibition onto silent neurons has no effect (paper Methods).</li>
            <li>Activation = Poisson input; silencing = removing all output synapses. Results are model outputs, not predictions validated in a living fly; the paper itself says absolute rates are unlikely to be accurate.</li>
            <li>Inputs arriving during the 2.2 ms refractory period are discarded (Brian2 behaviour inherited from upstream).</li>
          </ul>
        </div>
        <div>
          <h3>
            <CategoryTag cat="app" />
          </h3>
          <ul>
            <li>
              Proboscis pose = clamp((s − {MAPPING.R_THRESHOLD} Hz) / ({MAPPING.R_SATURATION} − {MAPPING.R_THRESHOLD}) Hz, 0, 1), s = MN9 rate (5 ms bins, trial-averaged) smoothed causally with τ = {MAPPING.TAU_MS} ms.
            </li>
            <li>The drop glows while the sugar GRNs are stimulated; it is a cartoon of the stimulation, not a food cue.</li>
            <li>Playback speed, colours and the cartoon are display choices. Optional stimulus on/off windows extend the upstream protocol.</li>
            <li>No hunger, intention, emotion or consciousness is modelled or implied.</li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}
