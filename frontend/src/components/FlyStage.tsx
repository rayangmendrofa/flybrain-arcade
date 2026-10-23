import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import { extension, MAPPING, sampleAt, simTimeAt, smooth } from "../lib/mapping";
import type { Mode, RunSummary } from "../types";
import { CategoryTag, fmt, Panel, PlotExport, useWidth } from "./Panel";

type Which = "baseline" | "intervention";
const SPEEDS = [0.1, 0.25, 0.5, 1];

interface Series {
  raw: number[];
  smooth: number[];
  binMs: number;
}

function seriesOf(run: RunSummary | null): Series | null {
  const o = run?.outputs[0];
  if (!o) return null;
  return { raw: o.psth.rate_hz, smooth: smooth(o.psth.rate_hz, o.psth.bin_ms), binMs: o.psth.bin_ms };
}

export function FlyStage(props: { baseline: RunSummary | null; intervention: RunSummary | null; reducedMotion: boolean; mode: Mode | null }) {
  const { baseline, intervention, reducedMotion } = props;
  const [which, setWhich] = useState<Which>("baseline");
  const [playing, setPlaying] = useState(false);
  const [simT, setSimT] = useState(0);
  const [speed, setSpeed] = useState(0.25);
  const run = which === "intervention" && intervention ? intervention : baseline;
  const duration = run?.config.duration_ms ?? 1000;
  const sB = useMemo(() => seriesOf(baseline), [baseline]);
  const sI = useMemo(() => seriesOf(intervention), [intervention]);
  const shown = which === "intervention" && sI ? sI : sB;
  const outName = run?.outputs[0]?.name ?? "MN9";

  // Playback clock: wall-clock -> simulated time. Display only; never touches the simulation.
  const startRef = useRef<{ wall: number; sim: number } | null>(null);
  useEffect(() => {
    if (!playing || reducedMotion) return;
    let raf = 0;
    startRef.current = { wall: performance.now(), sim: simT >= duration ? 0 : simT };
    const tick = (now: number) => {
      const s = startRef.current!;
      const t = s.sim + simTimeAt(now - s.wall, speed, duration, false);
      setSimT(Math.min(t, duration));
      if (t >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, duration, reducedMotion]);

  useEffect(() => {
    setPlaying(false);
    setSimT(reducedMotion ? 0 : 0);
  }, [baseline?.run_id, intervention?.run_id, reducedMotion]);
  useEffect(() => {
    if (intervention) setWhich("intervention");
    else setWhich("baseline");
  }, [intervention?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sm = shown ? sampleAt(shown.smooth, shown.binMs, simT) : 0;
  const raw = shown ? sampleAt(shown.raw, shown.binMs, simT) : 0;
  const e = extension(sm);
  const sched = run?.schedule;
  const stimOn = !!sched && sched.rate_hz > 0 && simT >= sched.onset_ms && simT < sched.offset_ms;

  const onKey = (ev: React.KeyboardEvent) => {
    if (!run) return;
    if (ev.key === " " && !reducedMotion) {
      ev.preventDefault();
      setPlaying((p) => !p);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      setSimT((t) => Math.min(duration, t + (ev.shiftKey ? 50 : 5)));
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      setSimT((t) => Math.max(0, t - (ev.shiftKey ? 50 : 5)));
    }
  };

  return (
    <Panel
      title="The Fly"
      cats={["model", "app"]}
      className="stage-panel"
      id="stage"
    >
      <div className="stage" tabIndex={0} onKeyDown={onKey} aria-label="Fly animation stage. Space plays or pauses, arrow keys step simulated time.">
        <div className="stage-banner">
          <strong>Illustrative readout of simulated neural activity</strong>
          <span>Not a biomechanical reconstruction · not recorded biological data</span>
        </div>
        <FlyCartoon extension={e} stimOn={stimOn} reducedMotion={reducedMotion} empty={!run} />
        <div className="stage-readout" aria-live="off">
          <div>
            <span className="k">Simulated time</span>
            <span className="v mono">{fmt(simT, 0)} / {duration} ms</span>
          </div>
          <div>
            <span className="k">{outName} (5 ms bin)</span>
            <span className="v mono">{fmt(raw, 0)} Hz</span>
          </div>
          <div>
            <span className="k">smoothed (τ = {MAPPING.TAU_MS} ms)</span>
            <span className="v mono">{fmt(sm, 1)} Hz</span>
          </div>
          <div>
            <span className="k">extension (app mapping)</span>
            <span className="v mono">{Math.round(e * 100)}%</span>
          </div>
          <div>
            <span className="k">sugar GRN stimulation</span>
            <span className={`v ${stimOn ? "on" : ""}`}>{stimOn ? `ON · ${sched?.rate_hz} Hz Poisson` : "off"}</span>
          </div>
        </div>
      </div>

      <div className="playback" role="group" aria-label="Playback of computed results">
        <div className="seg" role="radiogroup" aria-label="Which run drives the fly">
          <button type="button" role="radio" aria-checked={which === "baseline"} className={which === "baseline" ? "on base" : ""} onClick={() => setWhich("baseline")} disabled={!baseline}>
            Baseline
          </button>
          <button type="button" role="radio" aria-checked={which === "intervention"} className={which === "intervention" ? "on int" : ""} onClick={() => setWhich("intervention")} disabled={!intervention}>
            Intervention
          </button>
        </div>
        {!reducedMotion ? (
          <button type="button" className="btn" onClick={() => setPlaying((p) => !p)} disabled={!run} aria-pressed={playing}>
            {playing ? "❚❚ Pause" : simT >= duration ? "↺ Replay" : "▶ Play"}
          </button>
        ) : (
          <span className="note">Reduced motion: autoplay off — use the slider or arrow keys.</span>
        )}
        <label className="scrub">
          <span className="sr-only">Simulated time</span>
          <input type="range" min={0} max={duration} step={5} value={simT} onChange={(ev) => { setPlaying(false); setSimT(Number(ev.target.value)); }} disabled={!run} />
        </label>
        <label className="speed">
          Playback
          <select value={speed} onChange={(ev) => setSpeed(Number(ev.target.value))} disabled={reducedMotion}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× ({fmt(1 / s, s < 1 ? 0 : 0)} s wall per simulated s)
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="fine">
        Playback replays results that were already computed in the backend ({props.mode === "replay" ? "precomputed replay" : props.mode === "synthetic" ? "synthetic demo" : "live simulation"}). Playback speed is a display choice;
        {run ? ` this run took ${fmt(run.timing.wall_s, 1)} s wall-clock for ${fmt(run.timing.simulated_s, 2)} s of simulated time (${run.config.n_trials} trial${run.config.n_trials > 1 ? "s" : ""}).` : ""}
      </p>
      <OutputTrace baseline={sB} intervention={sI} duration={duration} simT={simT} schedule={sched ?? null} outName={outName} />
    </Panel>
  );
}

function OutputTrace(props: { baseline: Series | null; intervention: Series | null; duration: number; simT: number; schedule: RunSummary["schedule"] | null; outName: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const h = 190;
  const m = { l: 44, r: 12, t: 12, b: 30 };
  const maxY = Math.max(120, ...(props.baseline?.raw ?? [0]), ...(props.intervention?.raw ?? [0]));
  const x = scaleLinear().domain([0, props.duration]).range([m.l, w - m.r]);
  const y = scaleLinear().domain([0, Math.min(maxY, 400)]).range([h - m.b, m.t]).nice();
  const mk = (s: number[], bin: number) =>
    line<number>()
      .x((_, k) => x(k * bin + bin / 2))
      .y((v) => y(Math.min(v, y.domain()[1])))(s) ?? "";
  return (
    <div className="trace" ref={ref}>
      <div className="trace-head">
        <span>
          What drives the animation: <strong>{props.outName}</strong> trial-averaged rate (thin) and smoothed rate (thick)
        </span>
        <PlotExport svgRef={svgRef} name="flybrain_output_trace" title={`${props.outName} rate trace`} />
      </div>
      <svg ref={svgRef} width={w} height={h} role="img" aria-label={`${props.outName} firing-rate trace over simulated time with application thresholds`}>
        {props.schedule && props.schedule.rate_hz > 0 && (
          <rect x={x(props.schedule.onset_ms)} width={x(props.schedule.offset_ms) - x(props.schedule.onset_ms)} y={m.t} height={h - m.t - m.b} fill="#f6c94512" />
        )}
        <g className="grid">
          {y.ticks(4).map((t) => (
            <line key={t} x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        {[MAPPING.R_THRESHOLD, MAPPING.R_SATURATION].map((v, k) => (
          <g key={v}>
            <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="#f472b6" strokeDasharray="4 4" />
            <text x={w - m.r - 4} y={y(v) - 4} textAnchor="end" fontSize={10} fill="#f9a8d4">
              APP {k === 0 ? "threshold" : "saturation"} {v} Hz
            </text>
          </g>
        ))}
        {props.baseline && (
          <>
            <path d={mk(props.baseline.raw, props.baseline.binMs)} fill="none" stroke="#60a5fa" strokeOpacity={0.35} strokeWidth={1} />
            <path d={mk(props.baseline.smooth, props.baseline.binMs)} fill="none" stroke="#60a5fa" strokeWidth={2.5} />
          </>
        )}
        {props.intervention && (
          <>
            <path d={mk(props.intervention.raw, props.intervention.binMs)} fill="none" stroke="#fb923c" strokeOpacity={0.35} strokeWidth={1} />
            <path d={mk(props.intervention.smooth, props.intervention.binMs)} fill="none" stroke="#fb923c" strokeWidth={2.5} strokeDasharray="7 3" />
          </>
        )}
        <line x1={x(props.simT)} x2={x(props.simT)} y1={m.t} y2={h - m.b} stroke="#e7e9f3" strokeWidth={1.5} />
        <g className="axis">
          <line x1={m.l} x2={w - m.r} y1={h - m.b} y2={h - m.b} />
          {x.ticks(6).map((t) => (
            <text key={t} x={x(t)} y={h - m.b + 16} textAnchor="middle" fontSize={11}>
              {t}
            </text>
          ))}
          <text x={(w + m.l) / 2} y={h - 2} textAnchor="middle" fontSize={11}>
            simulated time (ms)
          </text>
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
      <div className="legend-row">
        <span className="sw base" /> baseline <span className="sw int" /> intervention <span className="sw stim" /> stimulation window
        <CategoryTag cat="model" compact /> rates <CategoryTag cat="app" compact /> smoothing &amp; thresholds
      </div>
    </div>
  );
}

function FlyCartoon({ extension: e, stimOn, reducedMotion, empty }: { extension: number; stimOn: boolean; reducedMotion: boolean; empty: boolean }) {
  // Proboscis: rostrum/haustellum swing from tucked under the head to extended toward the drop.
  const base = { x: 112, y: 168 };
  const tucked = { x: 136, y: 190 };
  const extended = { x: 82, y: 246 };
  const tip = { x: tucked.x + (extended.x - tucked.x) * e, y: tucked.y + (extended.y - tucked.y) * e };
  const mid = { x: (base.x + tip.x) / 2 + 8 * (1 - e), y: (base.y + tip.y) / 2 };
  const angle = (Math.atan2(tip.y - mid.y, tip.x - mid.x) * 180) / Math.PI;
  const tr = reducedMotion ? undefined : { transition: "all 60ms linear" };
  return (
    <svg className="fly" viewBox="0 0 440 290" role="img" aria-label={empty ? "Cartoon fly, waiting for a run" : `Cartoon fly; proboscis extension ${Math.round(e * 100)} percent (application mapping of simulated MN9 rate)`}>
      <defs>
        <radialGradient id="eyeG" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ff8a80" />
          <stop offset="60%" stopColor="#d6333f" />
          <stop offset="100%" stopColor="#7a1220" />
        </radialGradient>
        <radialGradient id="dropG" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#9fd8ff" />
        </radialGradient>
        <pattern id="facets" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.1" fill="#00000026" />
        </pattern>
      </defs>
      {/* ground */}
      <line x1="10" y1="262" x2="430" y2="262" stroke="#3a4170" strokeWidth="3" strokeLinecap="round" />
      {/* sugar drop (cartoon of the stimulated sugar GRN input) */}
      <g>
        {stimOn && <ellipse cx="78" cy="252" rx="34" ry="16" fill="#9fd8ff" opacity="0.25" />}
        <path d="M60 262 Q60 238 78 228 Q96 238 96 262 Z" fill="url(#dropG)" stroke="#cdeaff" strokeWidth="1.5" opacity={stimOn ? 1 : 0.55} />
        <text x="78" y="282" textAnchor="middle" fontSize="11" fill="#9fd8ff">
          sugar GRN input {stimOn ? "ON" : "off"}
        </text>
      </g>
      {/* legs */}
      <g stroke="#2a1d14" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M150 178 L130 214 L118 262" />
        <path d="M170 182 L176 222 L168 262" />
        <path d="M188 178 L214 214 L228 262" />
      </g>
      {/* wings */}
      <ellipse cx="262" cy="96" rx="104" ry="30" transform="rotate(-12 262 96)" fill="#d7e6ff33" stroke="#c7d7f5" strokeWidth="1.5" />
      <path d="M190 102 Q260 84 350 80" stroke="#c7d7f566" fill="none" />
      {/* abdomen */}
      <ellipse cx="270" cy="150" rx="82" ry="46" fill="#e2a33b" />
      {[230, 258, 286, 312].map((x) => (
        <path key={x} d={`M${x} 108 Q${x + 10} 150 ${x} 194`} stroke="#5a3311" strokeWidth="9" fill="none" opacity="0.8" />
      ))}
      {/* thorax */}
      <ellipse cx="172" cy="140" rx="46" ry="40" fill="#b5762e" />
      <ellipse cx="166" cy="124" rx="26" ry="14" fill="#c98d44" opacity="0.7" />
      {/* proboscis (drawn before head so it emerges from beneath) */}
      <g style={tr}>
        <path d={`M${base.x} ${base.y} Q${mid.x} ${mid.y} ${tip.x} ${tip.y}`} stroke="#8a5a2b" strokeWidth="11" strokeLinecap="round" fill="none" />
        <ellipse cx={tip.x} cy={tip.y} rx="11" ry="6.5" transform={`rotate(${angle + 90} ${tip.x} ${tip.y})`} fill="#a86d37" stroke="#5b3a1a" />
      </g>
      {/* head */}
      <circle cx="112" cy="136" r="34" fill="#b5762e" />
      <ellipse cx="104" cy="130" rx="22" ry="25" fill="url(#eyeG)" />
      <ellipse cx="104" cy="130" rx="22" ry="25" fill="url(#facets)" />
      <ellipse cx="96" cy="120" rx="6" ry="4" fill="#ffffff66" />
      {/* antenna + arista */}
      <path d="M88 108 L76 98" stroke="#5b3a1a" strokeWidth="5" strokeLinecap="round" />
      <path d="M76 98 Q66 84 70 74" stroke="#5b3a1a" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
