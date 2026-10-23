import { scaleBand, scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Comparison, Raster, RunSummary } from "../types";
import { CategoryTag, fmt, Panel, PlotExport, shortId, useWidth } from "./Panel";

const BASE = "#60a5fa";
const INT = "#fb923c";

/* ------------------------------------------------------------------ schedule */

export function ScheduleChart({ baseline, intervention }: { baseline: RunSummary | null; intervention: RunSummary | null }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const run = baseline;
  if (!run) {
    return (
      <Panel title="Stimulation schedule" cats={["model"]} id="schedule">
        <p className="empty">Run a baseline to see the stimulation schedule and the measured sensory-neuron response.</p>
      </Panel>
    );
  }
  const s = run.schedule;
  const h = 150;
  const m = { l: 44, r: 12, t: 10, b: 30 };
  const x = scaleLinear().domain([0, s.duration_ms]).range([m.l, w - m.r]);
  const pB = run.stimulated_population.psth;
  const pI = intervention?.stimulated_population.psth;
  const maxY = Math.max(s.rate_hz * 1.2, 10, ...pB.rate_hz);
  const y = scaleLinear().domain([0, maxY]).range([h - m.b, m.t]).nice();
  const mk = (p: typeof pB) =>
    line<number>()
      .x((_, k) => x(p.t_ms[k] + p.bin_ms / 2))
      .y((v) => y(v))(p.rate_hz) ?? "";
  const stepPath = `M${x(0)} ${y(0)} H${x(s.onset_ms)} V${y(s.rate_hz)} H${x(s.offset_ms)} V${y(0)} H${x(s.duration_ms)}`;
  return (
    <Panel title="Stimulation schedule" cats={["model"]} id="schedule" actions={<PlotExport svgRef={svgRef} name="flybrain_schedule" title="Stimulation schedule" />}>
      <p className="fine">
        <strong>{s.target_label}</strong> · {s.rate_hz} Hz Poisson from {s.onset_ms} to {s.offset_ms} ms of a {s.duration_ms} ms trial. {s.mechanism}.
      </p>
      <div ref={ref}>
        <svg ref={svgRef} width={w} height={h} role="img" aria-label={`Stimulation schedule: ${s.rate_hz} hertz from ${s.onset_ms} to ${s.offset_ms} milliseconds`}>
          <g className="grid">
            {y.ticks(3).map((t) => (
              <line key={t} x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <path d={stepPath} fill="none" stroke="#f6c945" strokeWidth={2} />
          <path d={mk(pB)} fill="none" stroke={BASE} strokeWidth={1.2} strokeOpacity={0.8} />
          {pI && <path d={mk(pI)} fill="none" stroke={INT} strokeWidth={1.2} strokeOpacity={0.8} strokeDasharray="5 3" />}
          <g className="axis">
            <line x1={m.l} x2={w - m.r} y1={h - m.b} y2={h - m.b} />
            {x.ticks(6).map((t) => (
              <text key={t} x={x(t)} y={h - m.b + 15} textAnchor="middle" fontSize={11}>
                {t}
              </text>
            ))}
            <text x={(w + m.l) / 2} y={h - 2} textAnchor="middle" fontSize={11}>
              simulated time (ms)
            </text>
            {y.ticks(3).map((t) => (
              <text key={t} x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11}>
                {t}
              </text>
            ))}
            <text transform={`translate(12 ${(h - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11}>
              Hz
            </text>
          </g>
        </svg>
      </div>
      <div className="legend-row">
        <span className="sw stimline" /> commanded Poisson rate per GRN <span className="sw base" /> measured GRN rate, baseline (5 ms bins, mean per neuron)
        {pI && (
          <>
            <span className="sw int" /> intervention
          </>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ raster */

const GROUP_COLOR: Record<string, string> = { output: "#f6c945", silenced: "#f87171", stimulated: "#9fd8ff", responsive: "#c4b5fd" };
const GROUP_LABEL: Record<string, string> = { output: "outputs", silenced: "silenced", stimulated: "stimulated GRNs", responsive: "top responsive" };

export function RasterChart({ baseline, intervention }: { baseline: RunSummary | null; intervention: RunSummary | null }) {
  const [which, setWhich] = useState<"baseline" | "intervention">("baseline");
  const [trial, setTrial] = useState(0);
  const [data, setData] = useState<Raster | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const run = which === "intervention" && intervention ? intervention : baseline;
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (intervention) setWhich("intervention");
  }, [intervention?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTrial(0);
  }, [baseline?.run_id]);
  useEffect(() => {
    if (!run) return setData(null);
    let live = true;
    setErr(null);
    api
      .raster(run.run_id, Math.min(trial, run.config.n_trials - 1))
      .then((r) => live && setData(r))
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [run?.run_id, trial]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowH = 7;
  const m = { l: 118, r: 10, t: 6, b: 30 };
  const n = data?.rows.length ?? 0;
  const h = m.t + m.b + n * rowH;
  const x = scaleLinear().domain([0, data?.duration_ms ?? 1000]).range([m.l, w - m.r]);
  const paths = useMemo(() => {
    if (!data) return [];
    const ps: string[] = data.rows.map(() => "");
    for (const [r, t] of data.spikes) {
      const xx = x(t).toFixed(1);
      ps[r] += `M${xx} ${m.t + r * rowH + 1}v${rowH - 2}`;
    }
    return ps;
  }, [data, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = new Array(n).fill(0);
    data?.spikes.forEach(([r]) => c[r]++);
    return c;
  }, [data, n]);
  const groupStarts = useMemo(() => {
    const out: { group: string; start: number; end: number; labelY: number }[] = [];
    data?.rows.forEach((r, k) => {
      const g = r.group ?? "";
      if (!out.length || out[out.length - 1].group !== g) out.push({ group: g, start: k, end: k, labelY: 0 });
      else out[out.length - 1].end = k;
    });
    let prev = -Infinity;
    for (const g of out) {
      g.labelY = Math.max(m.t + g.start * rowH + 9, prev + 12); // keep labels of short groups apart
      prev = g.labelY;
    }
    return out;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Panel
      title="Spike raster (bounded selection)"
      cats={["model"]}
      id="raster"
      actions={<PlotExport svgRef={svgRef} name={`flybrain_raster_${which}_trial${trial}`} title={`Spike raster, ${which}, trial ${trial}`} />}
    >
      {!run ? (
        <p className="empty">The raster appears after a run. It shows at most 80 neurons for one trial at a time; the backend keeps all spikes.</p>
      ) : (
        <>
          <div className="toolbar">
            <div className="seg" role="radiogroup" aria-label="Raster run">
              <button type="button" role="radio" aria-checked={which === "baseline"} className={which === "baseline" ? "on base" : ""} onClick={() => setWhich("baseline")}>
                Baseline
              </button>
              <button type="button" role="radio" aria-checked={which === "intervention"} className={which === "intervention" ? "on int" : ""} onClick={() => setWhich("intervention")} disabled={!intervention}>
                Intervention
              </button>
            </div>
            <label>
              Trial{" "}
              <input type="number" min={0} max={run.config.n_trials - 1} value={trial} onChange={(e) => setTrial(Math.max(0, Math.min(run.config.n_trials - 1, Number(e.target.value) || 0)))} className="num" />
              <span className="muted"> of 0–{run.config.n_trials - 1} (seed sequence [{run.config.seed}, trial])</span>
            </label>
          </div>
          {err && <p className="error">{err}</p>}
          <div ref={ref} className="raster-wrap">
            <svg ref={svgRef} width={w} height={h} role="img" aria-label={`Spike raster of ${n} selected neurons for trial ${trial}`} onMouseLeave={() => setHover(null)}>
              {groupStarts.map((g) => (
                <g key={g.group + g.start}>
                  <rect x={m.l} y={m.t + g.start * rowH} width={w - m.l - m.r} height={(g.end - g.start + 1) * rowH} fill={GROUP_COLOR[g.group] ?? "#888"} opacity={0.06} />
                  <rect x={m.l - 6} y={m.t + g.start * rowH} width={3} height={(g.end - g.start + 1) * rowH} fill={GROUP_COLOR[g.group] ?? "#888"} />
                  <text x={4} y={g.labelY} fontSize={10} fill={GROUP_COLOR[g.group]}>
                    {GROUP_LABEL[g.group] ?? g.group} ({g.end - g.start + 1})
                  </text>
                </g>
              ))}
              {paths.map((d, r) => (
                <path key={r} d={d} stroke={GROUP_COLOR[data!.rows[r].group ?? ""] ?? "#ddd"} strokeWidth={hover === r ? 2 : 1} />
              ))}
              {data?.rows.map((_, r) => (
                <rect key={r} x={m.l} y={m.t + r * rowH} width={w - m.l - m.r} height={rowH} fill="transparent" onMouseEnter={() => setHover(r)} />
              ))}
              <g className="axis">
                <line x1={m.l} x2={w - m.r} y1={h - m.b} y2={h - m.b} />
                {x.ticks(6).map((t) => (
                  <text key={t} x={x(t)} y={h - m.b + 15} textAnchor="middle" fontSize={11}>
                    {t}
                  </text>
                ))}
                <text x={(w + m.l) / 2} y={h - 2} textAnchor="middle" fontSize={11}>
                  simulated time (ms)
                </text>
              </g>
            </svg>
            <div className="raster-hover" aria-live="polite">
              {hover != null && data ? (
                <>
                  <strong>{data.rows[hover].name ?? "unnamed in upstream files"}</strong> · ID <span className="mono">{data.rows[hover].id}</span> · {GROUP_LABEL[data.rows[hover].group ?? ""]} · {counts[hover]} spikes this trial
                </>
              ) : (
                <span className="muted">Hover a row for its FlyWire v630 ID. {data ? `${data.spikes.length} spikes shown.` : ""}</span>
              )}
            </div>
          </div>
          <details className="fine">
            <summary>Rows as a table (accessible alternative)</summary>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Spikes (trial {trial})</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r, k) => (
                  <tr key={r.id}>
                    <td>{GROUP_LABEL[r.group ?? ""]}</td>
                    <td>{r.name ?? "—"}</td>
                    <td className="mono">{r.id}</td>
                    <td>{counts[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ rates + comparison */

export function OutputRates({ baseline, intervention }: { baseline: RunSummary | null; intervention: RunSummary | null }) {
  if (!baseline) return null;
  const win = baseline.rate_window_ms;
  return (
    <Panel title="Feeding-related output: MN9 firing" cats={["model", "data"]} id="rates">
      <p className="fine">
        Rate = spikes in <strong>[{win[0]}, {win[1]}) ms</strong> ÷ {((win[1] - win[0]) / 1000).toFixed(3)} s, per trial; mean ± SD (ddof = 0, as upstream <code>get_rate</code>) across{" "}
        {baseline.config.n_trials} trial{baseline.config.n_trials > 1 ? "s" : ""}.
      </p>
      <div className="rate-cards">
        {baseline.outputs.map((o, k) => {
          const io = intervention?.outputs[k];
          return (
            <div className="rate-card" key={o.key}>
              <div className="rc-name">
                {o.name} <span className="mono muted">{shortId(o.neuron.id)}</span>
              </div>
              <div className="rc-row base">
                <span>baseline</span>
                <span className="mono big">{fmt(o.stats.mean_rate_hz)} Hz</span>
                <span className="mono">± {fmt(o.stats.sd_rate_hz)} · {fmt(o.stats.mean_count)} spikes/trial</span>
              </div>
              {io && (
                <div className="rc-row int">
                  <span>intervention</span>
                  <span className="mono big">{fmt(io.stats.mean_rate_hz)} Hz</span>
                  <span className="mono">± {fmt(io.stats.sd_rate_hz)} · {fmt(io.stats.mean_count)} spikes/trial</span>
                </div>
              )}
              <div className="fine muted">
                {o.side_note} Source: {o.source}.
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function ComparisonPanel({ comparison }: { comparison: Comparison | null }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  if (!comparison) {
    return (
      <Panel title="Baseline vs intervention" cats={["model"]} id="compare">
        <p className="empty">Select neurons to silence and run the intervention. It repeats the baseline with the same initial state, stimulation schedule and seeds.</p>
      </Panel>
    );
  }
  const outs = comparison.outputs;
  const h = 230;
  const m = { l: 44, r: 12, t: 16, b: 40 };
  const maxY = Math.max(10, ...outs.flatMap((o) => [o.baseline_mean_rate_hz + o.baseline_sd_hz, o.intervention_mean_rate_hz + o.intervention_sd_hz]));
  const y = scaleLinear().domain([0, maxY * 1.1]).range([h - m.b, m.t]).nice();
  const xg = scaleBand<string>().domain(outs.map((o) => o.key)).range([m.l, w - m.r]).padding(0.3);
  const xb = scaleBand<string>().domain(["b", "i"]).range([0, xg.bandwidth()]).padding(0.12);
  return (
    <Panel
      title="Baseline vs intervention"
      cats={["model"]}
      id="compare"
      actions={<PlotExport svgRef={svgRef} name="flybrain_comparison" title="Baseline vs intervention output rates" />}
    >
      <p className="fine">
        Silenced: {comparison.silenced.map((s) => s.name ?? shortId(s.id)).join(", ")}. {comparison.pairing}
      </p>
      <div ref={ref}>
        <svg ref={svgRef} width={w} height={h} role="img" aria-label="Bar chart of output firing rates in baseline and intervention with per-trial points">
          <g className="grid">
            {y.ticks(4).map((t) => (
              <line key={t} x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          {outs.map((o) => {
            const gx = xg(o.key)!;
            const bars: [string, number, number, string][] = [
              ["b", o.baseline_mean_rate_hz, o.baseline_sd_hz, BASE],
              ["i", o.intervention_mean_rate_hz, o.intervention_sd_hz, INT],
            ];
            return (
              <g key={o.key}>
                {bars.map(([k, mean, sd, col]) => {
                  const bx = gx + xb(k)!;
                  const bw = xb.bandwidth();
                  return (
                    <g key={k}>
                      <rect x={bx} width={bw} y={y(mean)} height={y(0) - y(mean)} fill={col} opacity={0.75} />
                      <line x1={bx + bw / 2} x2={bx + bw / 2} y1={y(Math.max(0, mean - sd))} y2={y(mean + sd)} stroke="#e7e9f3" strokeWidth={1.5} />
                      <text x={bx + bw / 2} y={y(mean + sd) - 4} textAnchor="middle" fontSize={11}>
                        {fmt(mean)}
                      </text>
                    </g>
                  );
                })}
                {/* per-trial paired values (trial k of both runs shares seed sequence [seed, k]) */}
                {o.per_trial_baseline_hz.map((b, k) => {
                  const xbC = gx + xb("b")! + xb.bandwidth() / 2;
                  const xiC = gx + xb("i")! + xb.bandwidth() / 2;
                  const iv = o.per_trial_intervention_hz[k];
                  return (
                    <g key={k} opacity={0.55}>
                      <line x1={xbC} x2={xiC} y1={y(b)} y2={y(iv)} stroke="#e7e9f3" strokeWidth={0.6} />
                      <circle cx={xbC} cy={y(b)} r={2.2} fill="#fff" />
                      <circle cx={xiC} cy={y(iv)} r={2.2} fill="#fff" />
                    </g>
                  );
                })}
                <text x={gx + xg.bandwidth() / 2} y={h - m.b + 16} textAnchor="middle" fontSize={11}>
                  {o.name}
                </text>
                <text x={gx + xg.bandwidth() / 2} y={h - m.b + 30} textAnchor="middle" fontSize={11} fill={o.delta_rate_hz < 0 ? "#fca5a5" : "#86efac"}>
                  Δ {fmt(o.delta_rate_hz)} Hz ({o.delta_percent == null ? "n/a" : `${o.delta_percent > 0 ? "+" : ""}${fmt(o.delta_percent, 0)}%`})
                </text>
              </g>
            );
          })}
          <g className="axis">
            <line x1={m.l} x2={w - m.r} y1={h - m.b} y2={h - m.b} />
            {y.ticks(4).map((t) => (
              <text key={t} x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11}>
                {t}
              </text>
            ))}
            <text transform={`translate(12 ${(h - m.b + m.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11}>
              Hz
            </text>
          </g>
        </svg>
      </div>
      <div className="legend-row">
        <span className="sw base" /> baseline mean ± SD <span className="sw int" /> intervention mean ± SD <span className="sw dot" /> per-trial rates, lines join trials with the same seed
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Output</th>
            <th>Baseline (Hz)</th>
            <th>Intervention (Hz)</th>
            <th>Spikes/trial (b → i)</th>
            <th>Δ (Hz)</th>
            <th>Δ vs baseline</th>
            <th>Paired Δ SD / SEM</th>
            <th>Trials ↓ / ↑</th>
          </tr>
        </thead>
        <tbody>
          {outs.map((o) => (
            <tr key={o.key}>
              <td>{o.name}</td>
              <td className="mono">
                {fmt(o.baseline_mean_rate_hz)} ± {fmt(o.baseline_sd_hz)}
              </td>
              <td className="mono">
                {fmt(o.intervention_mean_rate_hz)} ± {fmt(o.intervention_sd_hz)}
              </td>
              <td className="mono">
                {fmt(o.baseline_mean_count)} → {fmt(o.intervention_mean_count)}
              </td>
              <td className="mono">{fmt(o.delta_rate_hz)}</td>
              <td className="mono">{o.delta_percent == null ? "n/a (baseline 0)" : `${fmt(o.delta_percent, 1)}%`}</td>
              <td className="mono">
                {fmt(o.paired_delta_sd_hz)} / {fmt(o.paired_delta_sem_hz)}
              </td>
              <td className="mono">
                {o.trials_decreased} / {o.trials_increased} of {o.n_trials}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {outs[0]?.n_trials === 1 && <p className="warn">Only one trial: no across-seed variability. Increase trials for stochastic effects.</p>}
      <p className="interp">
        <CategoryTag cat="model" compact /> {comparison.interpretation}
      </p>
      {comparison.most_changed.length > 0 && (
        <details className="fine">
          <summary>Neurons whose rate changed most (within this model)</summary>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Baseline</th>
                <th>Intervention</th>
                <th>Δ Hz</th>
              </tr>
            </thead>
            <tbody>
              {comparison.most_changed.map((r) => (
                <tr key={r.id}>
                  <td>{r.name ?? "—"}</td>
                  <td className="mono">{r.id}</td>
                  <td className="mono">{fmt(r.baseline_rate_hz)}</td>
                  <td className="mono">{fmt(r.intervention_rate_hz)}</td>
                  <td className="mono">{fmt(r.delta_hz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Panel>
  );
}
