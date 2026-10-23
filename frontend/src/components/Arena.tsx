import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, waitForJob } from "../api";
import type { Job, NeuronGroup, Status } from "../types";
import { JobStatus } from "./Controls";
import { CategoryTag, fmt, Panel, PlotExport, useWidth, type Category } from "./Panel";

interface ArenaConfig {
  engine: "numba-port" | "synthetic";
  layout: "two_patches" | "obstacle_course" | "single_patch";
  duration_s: number;
  seed: number;
  grn_max_rate_hz: number;
  decoder: "mn9" | "none";
  walk_speed_mm_s: number;
  silenced_ids: string[];
}
interface Interface {
  name: string;
  from: string;
  to: string;
  variables: { name: string; unit: string; rate: string }[];
  neurons: string;
  equations: string;
  provenance: string;
}
interface Episode {
  episode_id: string;
  mode: "live" | "synthetic";
  label: string;
  config: ArenaConfig;
  arena: { width_mm: number; height_mm: number; patches: { x: number; y: number; r: number; amount: number }[]; obstacles: { x: number; y: number; w: number; h: number }[]; start: number[] };
  record: {
    t_s: number[]; x: number[]; y: number[]; heading: number[]; patch: number[]; concentration: number[]; grn_rate_cmd_hz: number[];
    grn_spikes: number[]; out_spikes: number[]; out_rate_hz: number[]; out_smoothed_hz: number[]; extension: number[]; speed: number[];
    feeding: boolean[]; noise_turn: number[]; avoid_turn: number[]; collided: boolean[]; amounts: number[][];
  };
  control_dt_s: number;
  output_neuron_id: string;
  interfaces: Interface[];
  constants: Record<string, number>;
  timing: { wall_s: number; neural_wall_s: number; simulated_s: number; wall_per_simulated_s: number };
  summary: { time_feeding_s: number; time_on_patch_s: number; path_length_mm: number; mean_out_rate_on_patch_hz: number | null };
}

const DEFAULT: ArenaConfig = { engine: "numba-port", layout: "two_patches", duration_s: 15, seed: 1, grn_max_rate_hz: 100, decoder: "mn9", walk_speed_mm_s: 12, silenced_ids: [] };
const PIPE_CAT: Category[] = ["app", "app", "model", "app", "app"];

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail ?? r.statusText));
  }
  return r.json();
}

export default function Arena({ status, reducedMotion }: { status: Status | null; reducedMotion: boolean }) {
  const [cfg, setCfg] = useState<ArenaConfig>(DEFAULT);
  const [groups, setGroups] = useState<NeuronGroup[]>([]);
  const [silenceKey, setSilenceKey] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [ep, setEp] = useState<Episode | null>(null);
  const [history, setHistory] = useState<Episode[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0); // index into record
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const stop = useRef({ stopped: false });
  const busy = !!job && (job.status === "queued" || job.status === "running");
  const dataOk = status?.upstream.available ?? false;

  useEffect(() => {
    api.groups().then((g) => setGroups(g.silencing_groups.filter((x) => x.key.startsWith("type:")))).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (status && !status.upstream.available) setCfg((c) => ({ ...c, engine: "synthetic" }));
  }, [status]);

  const run = async () => {
    setErr(null);
    stop.current = { stopped: false };
    const g = groups.find((x) => x.key === silenceKey);
    const body = { ...cfg, silenced_ids: cfg.engine === "synthetic" || !g ? [] : g.ids };
    try {
      const j = await getJSON<Job>("/api/arena/episodes", { method: "POST", body: JSON.stringify(body) });
      setJob(j);
      const done = await waitForJob(j.id, setJob, stop.current);
      if (done.status === "done" && done.run_id) {
        const e = await getJSON<Episode>(`/api/arena/episodes/${done.run_id}`);
        setEp(e);
        setHistory((h) => [e, ...h].slice(0, 8));
        setT(0);
        setPlaying(!reducedMotion);
      }
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  // playback of the computed episode (display only)
  const n = ep?.record.t_s.length ?? 0;
  useEffect(() => {
    if (!playing || !ep || reducedMotion) return;
    let raf = 0;
    const t0 = performance.now();
    const k0 = t >= n - 1 ? 0 : t;
    const tick = (now: number) => {
      const k = k0 + Math.floor(((now - t0) / 1000) * speed / ep.control_dt_s);
      if (k >= n - 1) {
        setT(n - 1);
        setPlaying(false);
        return;
      }
      setT(k);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ep, speed, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = Math.min(t, Math.max(0, n - 1));
  return (
    <main className="layout">
      <aside className="side">
        <Panel title="Arena setup" cats={["app"]} id="arena-controls">
          <div className="banner synth-banner" role="note" style={{ margin: "0 0 8px" }}>
            HYBRID DEMONSTRATION. Walking and steering come from a handcrafted controller. The published brain model supplies only MN9 activity, which this app uses to gate stopping and feeding. Nothing learns.
          </div>
          <fieldset disabled={busy} className="ctl">
            <label className="row">
              <span>Neural model</span>
              <select value={cfg.engine} onChange={(e) => setCfg({ ...cfg, engine: e.target.value as ArenaConfig["engine"] })}>
                <option value="numba-port" disabled={!dataOk}>
                  Upstream model (FlyWire v630, Numba port)
                </option>
                <option value="synthetic">SYNTHETIC DEMO network</option>
              </select>
            </label>
            <label className="row">
              <span>Layout</span>
              <select value={cfg.layout} onChange={(e) => setCfg({ ...cfg, layout: e.target.value as ArenaConfig["layout"] })}>
                <option value="two_patches">Two food-cue patches</option>
                <option value="obstacle_course">Obstacle course</option>
                <option value="single_patch">Single patch</option>
              </select>
            </label>
            <label className="row">
              <span>Decoder</span>
              <select value={cfg.decoder} onChange={(e) => setCfg({ ...cfg, decoder: e.target.value as ArenaConfig["decoder"] })}>
                <option value="mn9">MN9 activity gates feeding</option>
                <option value="none">Controller only (no neural input) — control</option>
              </select>
            </label>
            <label className="row">
              <span>Silence</span>
              <select value={silenceKey} onChange={(e) => setSilenceKey(e.target.value)} disabled={cfg.engine === "synthetic"}>
                <option value="">nothing</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label} ({g.ids.length})
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <span>Max GRN rate at c = 1</span>
              <span className="inline">
                <input type="number" className="num" min={0} max={200} value={cfg.grn_max_rate_hz} onChange={(e) => setCfg({ ...cfg, grn_max_rate_hz: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} /> Hz
              </span>
            </label>
            <label className="row">
              <span>Walking speed</span>
              <span className="inline">
                <input type="number" className="num" min={1} max={30} value={cfg.walk_speed_mm_s} onChange={(e) => setCfg({ ...cfg, walk_speed_mm_s: Math.max(1, Math.min(30, Number(e.target.value) || 12)) })} /> mm/s
              </span>
            </label>
            <label className="row">
              <span>Simulated duration</span>
              <span className="inline">
                <input type="number" className="num" min={1} max={30} value={cfg.duration_s} onChange={(e) => setCfg({ ...cfg, duration_s: Math.max(1, Math.min(30, Number(e.target.value) || 10)) })} /> s
              </span>
            </label>
            <label className="row">
              <span>Seed</span>
              <span className="inline">
                <input type="number" className="num wide" min={0} value={cfg.seed} onChange={(e) => setCfg({ ...cfg, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                <button type="button" className="btn ghost" onClick={() => setCfg({ ...cfg, seed: Math.floor(Math.random() * 1e6) })}>
                  🎲
                </button>
              </span>
            </label>
            <p className="fine muted">The seed fixes the Poisson input draws and the controller's turning noise, so changing only the decoder or silencing gives a matched comparison.</p>
          </fieldset>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={run} disabled={busy}>
              ▶ Run episode
            </button>
          </div>
          <p className="fine muted">The episode is computed in the background worker, then played back here. It is not real-time: on this machine the full model needed 1.2–1.8 s of wall-clock per simulated second (the exact figure is reported after each run).</p>
          <JobStatus job={job} onCancel={() => job && api.cancel(job.id).then(setJob)} />
          {err && <p className="error">{err}</p>}
        </Panel>
        {history.length > 0 && (
          <Panel title="Episode history" cats={["model", "app"]}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Seed</th>
                  <th>Condition</th>
                  <th>On patch</th>
                  <th>Feeding</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.episode_id} className={h === ep ? "sel" : ""} onClick={() => { setEp(h); setT(0); }} style={{ cursor: "pointer" }}>
                    <td>{h.config.seed}</td>
                    <td>
                      {h.config.decoder === "none" ? "controller only" : "MN9 gate"}
                      {h.config.silenced_ids.length ? ` · ${h.config.silenced_ids.length} silenced` : ""}
                      {h.mode === "synthetic" ? " · SYNTH" : ""}
                    </td>
                    <td className="mono">{fmt(h.summary.time_on_patch_s, 1)} s</td>
                    <td className="mono">{fmt(h.summary.time_feeding_s, 1)} s</td>
                    <td className="mono">{fmt(h.summary.path_length_mm, 0)} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </aside>
      <div className="main">
        <Panel title="Top-down arena" cats={["app", "model"]} id="arena-view" actions={ep && <a className="btn ghost" href={`/api/arena/episodes/${ep.episode_id}/export.json`} download>Export episode JSON</a>}>
          {!ep ? (
            <p className="empty">Run an episode to see the trajectory.</p>
          ) : (
            <>
              <div className={`mode mode-${ep.mode === "synthetic" ? "synthetic" : "live"}`} style={{ display: "inline-block", marginBottom: 6 }}>
                {ep.label} · {ep.mode === "synthetic" ? "synthetic network" : "live: upstream model"}
              </div>
              <ArenaView ep={ep} k={k} />
              <div className="playback">
                {!reducedMotion ? (
                  <button type="button" className="btn" onClick={() => setPlaying((p) => !p)}>
                    {playing ? "❚❚ Pause" : k >= n - 1 ? "↺ Replay" : "▶ Play"}
                  </button>
                ) : (
                  <span className="note">Reduced motion: use the slider.</span>
                )}
                <label className="scrub">
                  <span className="sr-only">Simulated time</span>
                  <input type="range" min={0} max={n - 1} value={k} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
                </label>
                <span className="mono">t = {fmt(ep.record.t_s[k], 2)} s</span>
                <label className="speed">
                  Playback
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </label>
              </div>
              <p className="fine">
                Computed in {fmt(ep.timing.wall_s, 1)} s wall-clock for {fmt(ep.timing.simulated_s, 1)} s simulated ({fmt(ep.timing.wall_per_simulated_s, 2)} s per simulated s; neural model {fmt(ep.timing.neural_wall_s, 1)} s). Playback speed is
                independent of the computation.
              </p>
            </>
          )}
        </Panel>
        {ep && <Pipeline ep={ep} k={k} />}
        {ep && <ArenaTraces ep={ep} k={k} />}
        {ep && <InterfacesTable ep={ep} />}
      </div>
    </main>
  );
}

function ArenaView({ ep, k }: { ep: Episode; k: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const { width_mm: W, height_mm: H } = ep.arena;
  const s = w / W;
  const h = H * s;
  const r = ep.record;
  const segs = useMemo(() => {
    const out: { d: string; feeding: boolean }[] = [];
    let cur: { pts: string[]; feeding: boolean } | null = null;
    for (let i = 0; i <= k; i++) {
      const p = `${(r.x[i] * s).toFixed(1)},${(r.y[i] * s).toFixed(1)}`;
      if (!cur || cur.feeding !== r.feeding[i]) {
        if (cur) out.push({ d: "M" + cur.pts.join("L"), feeding: cur.feeding });
        cur = { pts: cur ? [cur.pts[cur.pts.length - 1], p] : [`${(ep.arena.start[0] * s).toFixed(1)},${(ep.arena.start[1] * s).toFixed(1)}`, p], feeding: r.feeding[i] };
      } else cur.pts.push(p);
    }
    if (cur) out.push({ d: "M" + cur.pts.join("L"), feeding: cur.feeding });
    return out;
  }, [ep, k, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const amounts = r.amounts[k] ?? ep.arena.patches.map((p) => p.amount);
  const deg = (r.heading[k] * 180) / Math.PI;
  const e = r.extension[k] ?? 0;
  return (
    <div ref={ref}>
      <div className="trace-head">
        <span>
          <CategoryTag cat="app" compact /> arena, cue patches, obstacles and movement · <CategoryTag cat="model" compact /> MN9 activity (proboscis line)
        </span>
        <PlotExport svgRef={svgRef} name={`flybrain_arena_${ep.episode_id}`} title="Arena trajectory" />
      </div>
      <svg ref={svgRef} width={w} height={h} role="img" aria-label={`Arena, fly at ${fmt(r.x[k], 0)}, ${fmt(r.y[k], 0)} millimetres, ${r.feeding[k] ? "feeding" : "walking"}`} style={{ background: "#0f1330", borderRadius: 10 }}>
        <rect x={1} y={1} width={w - 2} height={h - 2} fill="none" stroke="#3a4170" strokeWidth={2} rx={8} />
        {ep.arena.patches.map((p, i) => (
          <g key={i}>
            <circle cx={p.x * s} cy={p.y * s} r={p.r * s} fill="#9fd8ff" opacity={0.12 + 0.6 * amounts[i]} stroke="#cdeaff" strokeDasharray="4 3" />
            <text x={p.x * s} y={(p.y + p.r) * s + 14} textAnchor="middle" fontSize={11} fill="#9fd8ff">
              food cue {i + 1}: c = {fmt(amounts[i], 2)}
            </text>
          </g>
        ))}
        {ep.arena.obstacles.map((o, i) => (
          <rect key={i} x={o.x * s} y={o.y * s} width={o.w * s} height={o.h * s} fill="#4b5280" rx={3} />
        ))}
        {segs.map((sg, i) => (
          <path key={i} d={sg.d} fill="none" stroke={sg.feeding ? "#f472b6" : "#e7e9f3"} strokeOpacity={sg.feeding ? 1 : 0.55} strokeWidth={sg.feeding ? 3 : 1.5} />
        ))}
        {r.feeding[k] && <circle cx={r.x[k] * s} cy={r.y[k] * s} r={16} fill="none" stroke="#f472b6" strokeWidth={2.5} strokeDasharray="5 3" />}
        <g transform={`translate(${r.x[k] * s} ${r.y[k] * s}) rotate(${deg})`}>
          <ellipse cx={-4} cy={0} rx={9} ry={5} fill="#e2a33b" />
          <ellipse cx={-6} cy={-5} rx={7} ry={3} fill="#d7e6ff66" transform="rotate(-20)" />
          <ellipse cx={-6} cy={5} rx={7} ry={3} fill="#d7e6ff66" transform="rotate(20)" />
          <circle cx={6} cy={0} r={4.5} fill="#b5762e" />
          <circle cx={7} cy={-2.5} r={2} fill="#d6333f" />
          <circle cx={7} cy={2.5} r={2} fill="#d6333f" />
          <line x1={10} y1={0} x2={10 + 10 * e} y2={0} stroke="#f472b6" strokeWidth={2.5} strokeLinecap="round" />
        </g>
      </svg>
      <div className="legend-row">
        <span className="sw" style={{ background: "#e7e9f3" }} /> walking (controller) <span className="sw" style={{ background: "#f472b6" }} /> stopped to feed (MN9 gate; dashed ring while feeding) · pink line on the fly = extension e
      </div>
    </div>
  );
}

function Pipeline({ ep, k }: { ep: Episode; k: number }) {
  const r = ep.record;
  const vals = [
    `c = ${fmt(r.concentration[k], 2)}${r.patch[k] >= 0 ? ` (patch ${r.patch[k] + 1})` : " (no contact)"}`,
    `r_in = ${fmt(r.grn_rate_cmd_hz[k], 0)} Hz → ${r.grn_spikes[k]} GRN spikes / 50 ms`,
    `MN9: ${r.out_spikes[k]} spikes / 50 ms`,
    `rate ${fmt(r.out_rate_hz[k], 0)} Hz, smoothed ${fmt(r.out_smoothed_hz[k], 1)} Hz → e = ${fmt(r.extension[k], 2)}`,
    `${r.feeding[k] ? "STOP · feeding" : "walk"} · ${fmt(r.speed[k], 1)} mm/s · turn ${fmt(r.noise_turn[k] + r.avoid_turn[k], 2)} rad`,
  ];
  return (
    <Panel title="Closed loop at this instant" cats={["data", "model", "app"]} id="pipeline">
      <ol className="pipeline">
        {ep.interfaces.map((itf, i) => (
          <li key={itf.name} className={`pipe pipe-${PIPE_CAT[i]}`}>
            <div className="pipe-head">
              <strong>{itf.name}</strong> <CategoryTag cat={PIPE_CAT[i]} compact />
            </div>
            <div className="mono small">{vals[i]}</div>
            <div className="fine muted">{itf.provenance}</div>
          </li>
        ))}
      </ol>
      <p className="fine">
        Only the <strong>Neural model</strong> step is the published Shiu et al. model ({ep.mode === "synthetic" ? "here replaced by the SYNTHETIC network" : "all 127,400 neurons, dt = 0.1 ms, state carried across 50 ms windows"}). The model has no walking, steering or vision; those come from the
        handcrafted controller.
      </p>
    </Panel>
  );
}

function ArenaTraces({ ep, k }: { ep: Episode; k: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const r = ep.record;
  const rows: { label: string; data: number[]; max: number; color: string; cat: Category }[] = [
    { label: "encoder: GRN input rate r_in (Hz)", data: r.grn_rate_cmd_hz, max: Math.max(10, ep.config.grn_max_rate_hz), color: "#9fd8ff", cat: "app" },
    { label: "model: MN9 rate per 50 ms window (Hz)", data: r.out_rate_hz, max: Math.max(100, ...r.out_rate_hz), color: "#f6c945", cat: "model" },
    { label: "decoder: extension e", data: r.extension, max: 1, color: "#f472b6", cat: "app" },
    { label: "controller: speed (mm/s)", data: r.speed, max: Math.max(1, ep.config.walk_speed_mm_s), color: "#e7e9f3", cat: "app" },
  ];
  const rowH = 62;
  const m = { l: 10, r: 10, t: 18 };
  const x = scaleLinear().domain([0, ep.config.duration_s]).range([m.l, w - m.r]);
  return (
    <Panel title="Interface signals over time" cats={["model", "app"]} id="arena-traces" actions={<PlotExport svgRef={svgRef} name={`flybrain_arena_signals_${ep.episode_id}`} title="Arena interface signals" />}>
      <div ref={ref}>
        <svg ref={svgRef} width={w} height={rows.length * rowH + 24} role="img" aria-label="Encoder input, MN9 rate, extension and speed over simulated time">
          {rows.map((row, i) => {
            const y = scaleLinear().domain([0, row.max]).range([m.t + i * rowH + rowH - 22, m.t + i * rowH]);
            const d = line<number>().x((_, j) => x(r.t_s[j])).y((v) => y(v))(row.data) ?? "";
            return (
              <g key={row.label}>
                <text x={m.l} y={m.t + i * rowH - 4} fontSize={11} fill={row.color}>
                  {row.label}
                </text>
                <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="#3a4170" />
                <path d={d} fill="none" stroke={row.color} strokeWidth={1.5} />
              </g>
            );
          })}
          <line x1={x(r.t_s[k])} x2={x(r.t_s[k])} y1={10} y2={rows.length * rowH + 4} stroke="#fff" strokeOpacity={0.7} />
          <text x={w - m.r} y={rows.length * rowH + 20} textAnchor="end" fontSize={11}>
            simulated time 0–{ep.config.duration_s} s · one sample per {ep.control_dt_s * 1000} ms window
          </text>
        </svg>
      </div>
    </Panel>
  );
}

function InterfacesTable({ ep }: { ep: Episode }) {
  return (
    <Panel title="Interfaces (what is passed, units, rates, neurons, equations, provenance)" cats={["data", "model", "app"]} id="interfaces">
      <table className="tbl">
        <thead>
          <tr>
            <th>Interface</th>
            <th>Variables · unit · update rate</th>
            <th>Neurons</th>
            <th>Mapping</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {ep.interfaces.map((itf) => (
            <tr key={itf.name}>
              <td>
                <strong>{itf.name}</strong>
                <div className="fine muted">
                  {itf.from} → {itf.to}
                </div>
              </td>
              <td>
                {itf.variables.map((v) => (
                  <div key={v.name}>
                    {v.name} · <em>{v.unit}</em> · {v.rate}
                  </div>
                ))}
              </td>
              <td>{itf.neurons}</td>
              <td className="small">{itf.equations}</td>
              <td className="small">{itf.provenance}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">No learning mechanism is implemented. The fly does not "learn to navigate"; its path is a seeded random walk with obstacle avoidance that stops while the MN9 signal is high.</p>
    </Panel>
  );
}
