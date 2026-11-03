// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { useEffect, useMemo, useRef, useState } from "react";
import { spikesInWindow, type BrainAtlas } from "../lib/brainData";
import { MAPPING } from "../lib/mapping";
import { mn9At, siteData, smoothedSeries, type SiteRun } from "./data";
import { useFlyScene, usePlayback } from "../lib/sceneHooks";

type RunKey = "baseline" | "intervention";

/** Interactive replay viewer: whole fly or inside the head, either run, any moment. */
export function Explorer({ runs, reducedMotion }: { runs: Record<RunKey, SiteRun>; reducedMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const { scene, state } = useFlyScene(host, reducedMotion);
  const [which, setWhich] = useState<RunKey>("baseline");
  const [view, setView] = useState<"fly" | "brain">("brain");
  const [overlay, setOverlay] = useState(false);
  const [speed, setSpeed] = useState(0.1);
  const [atlas, setAtlas] = useState<BrainAtlas | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = runs[which];
  const dur = run.config.duration_ms;
  const { t, setT, playing, setPlaying } = usePlayback(dur, speed);
  const m = mn9At(run, t);

  useEffect(() => {
    siteData.atlas().then(setAtlas).catch((e) => setErr(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    if (!scene) return;
    scene.setBrain(atlas);
    scene.setActivity(run.activity);
    scene.setSimTime(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, atlas, run]);
  useEffect(() => {
    scene?.setSimTime(t);
    scene?.setExtension(m.extension);
    scene?.setStim(run.schedule.rate_hz > 0 && t >= run.schedule.onset_ms && t < run.schedule.offset_ms);
  }, [scene, t, m.extension, run]);
  useEffect(() => scene?.setView(view), [scene, view]);
  useEffect(() => scene?.setDriverOverlay(overlay), [scene, overlay]);

  const recent = spikesInWindow(run.activity, t, 10);
  return (
    <div className="explorer">
      <div className="viewer">
        <div className="canvas-host" ref={host} role="img" aria-label={view === "brain" ? `Brain view at ${Math.round(t)} ms: ${recent} simulated spikes in the last 10 ms` : `Fly with proboscis ${Math.round(m.extension * 100)}% extended`}>
          {state !== "ready" && <div className="canvas-msg">{state === "error" ? "3D view unavailable on this device (WebGL)." : "Loading the 3D fly…"}</div>}
          <span className="badge replay">REPLAY · simulated, not recorded</span>
        </div>
        <div className="hud">
          <div className="seg" role="radiogroup" aria-label="Which run">
            <button type="button" role="radio" aria-checked={which === "baseline"} className={which === "baseline" ? "on base" : ""} onClick={() => setWhich("baseline")}>
              Sugar
            </button>
            <button type="button" role="radio" aria-checked={which === "intervention"} className={which === "intervention" ? "on int" : ""} onClick={() => setWhich("intervention")}>
              Sugar + Roundup silenced
            </button>
          </div>
          <div className="seg" role="radiogroup" aria-label="Camera">
            <button type="button" role="radio" aria-checked={view === "fly"} className={view === "fly" ? "on" : ""} onClick={() => setView("fly")}>
              Whole fly
            </button>
            <button type="button" role="radio" aria-checked={view === "brain"} className={view === "brain" ? "on" : ""} onClick={() => setView("brain")}>
              Inside the head
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Who&rsquo;s driving?
          </label>
        </div>
        <div className="transport">
          <button type="button" className="btn" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
            {playing ? "❚❚ Pause" : t >= dur ? "↺ Replay" : "▶ Play"}
          </button>
          <input
            type="range"
            min={0}
            max={dur}
            step={1}
            value={t}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            aria-label="Simulated time (ms)"
          />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
            <option value={0.02}>50× slower</option>
            <option value={0.05}>20× slower</option>
            <option value={0.1}>10× slower</option>
            <option value={0.25}>4× slower</option>
          </select>
        </div>
      </div>
      <aside className="readout">
        <Stat k="Simulated time" v={`${Math.round(t)} / ${dur} ms`} />
        <Stat k="Spikes in the last 10 ms" v={view === "brain" ? String(recent) : "(open the head)"} hint="all neurons, trial 1" />
        <Stat k="MN9 firing rate" v={`${m.smoothed.toFixed(0)} Hz`} hint={`smoothed over ${MAPPING.TAU_MS} ms, average of ${run.config.n_trials} trials`} tone="model" />
        <Stat k="Proboscis extension" v={`${Math.round(m.extension * 100)}%`} hint={`app mapping: 0% below ${MAPPING.R_THRESHOLD} Hz, 100% at ${MAPPING.R_SATURATION} Hz`} tone="app" />
        <Mn9Trace runs={runs} which={which} t={t} />
        {err && <p className="error">{err}</p>}
        {overlay && (
          <p className="fine">
            <span className="sw" style={{ background: "#f6c945" }} /> The proboscis is the only body part the brain model moves here (via MN9). The rest of the fly is a static
            3D model.
          </p>
        )}
      </aside>
    </div>
  );
}

function Stat({ k, v, hint, tone }: { k: string; v: string; hint?: string; tone?: "model" | "app" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Mn9Trace({ runs, which, t }: { runs: Record<RunKey, SiteRun>; which: RunKey; t: number }) {
  const w = 300;
  const h = 110;
  const paths = useMemo(() => {
    const mk = (r: SiteRun) => {
      const s = smoothedSeries(r);
      const bin = r.mn9.psth.bin_ms;
      const dur = r.config.duration_ms;
      return s.map((v, k) => `${k ? "L" : "M"}${(((k + 0.5) * bin) / dur) * w},${h - (Math.min(v, 110) / 110) * (h - 8)}`).join("");
    };
    return { baseline: mk(runs.baseline), intervention: mk(runs.intervention) };
  }, [runs]);
  const x = (t / runs[which].config.duration_ms) * w;
  return (
    <figure className="trace">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Smoothed MN9 firing rate over simulated time for both runs">
        <path d={paths.baseline} className="line base" opacity={which === "baseline" ? 1 : 0.35} />
        <path d={paths.intervention} className="line int" opacity={which === "intervention" ? 1 : 0.35} />
        <line x1={x} x2={x} y1={0} y2={h} className="cursor" />
      </svg>
      <figcaption>
        MN9 rate, 0&ndash;1000 ms · <span className="base-t">sugar</span> vs <span className="int-t">Roundup silenced</span>
      </figcaption>
    </figure>
  );
}
