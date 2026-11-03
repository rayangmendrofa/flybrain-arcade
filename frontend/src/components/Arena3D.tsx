import { useEffect, useRef, useState } from "react";
import { useFlyScene, usePlayback } from "../lib/sceneHooks";
import { arenaPose, type ArenaEpisode } from "../three/arenaWorld";
import "./arena3d.css";

export interface Arena3DEpisode {
  key: string;
  label: string;
  tone?: "base" | "int";
  ep: ArenaEpisode;
}

/**
 * 3D view of an arena episode (HYBRID DEMONSTRATION). The published brain model decides feeding
 * (via MN9); a handcrafted controller does the walking; the legs follow an APP tripod gait.
 */
export default function Arena3D({ episodes, reducedMotion }: { episodes: Arena3DEpisode[]; reducedMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const { scene, state } = useFlyScene(host, reducedMotion);
  const [which, setWhich] = useState(0);
  const [modelOnly, setModelOnly] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [speed, setSpeed] = useState(0.5);
  const cur = episodes[Math.min(which, episodes.length - 1)];
  const ep = cur?.ep;
  const durMs = (ep?.config.duration_s ?? 15) * 1000;
  const { t, setT, playing, setPlaying } = usePlayback(durMs, speed);

  useEffect(() => {
    if (!scene || !ep) return;
    scene.setArena(ep);
    scene.setArenaTime(t / 1000, true, modelOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, ep, state]);
  useEffect(() => {
    scene?.setArenaTime(t / 1000, false, modelOnly);
  }, [scene, t, modelOnly]);
  useEffect(() => scene?.setDriverOverlay(overlay), [scene, overlay, ep, state]);

  const pose = ep ? arenaPose(ep, t / 1000) : null;
  const feedS = ep && pose ? ep.record.feeding.slice(0, pose.k + 1).filter(Boolean).length * ep.control_dt_s : 0;
  return (
    <div className="a3d">
      <div className="a3d-viewer">
        <div className="a3d-canvas" ref={host} role="img" aria-label="3D arena: the fly walks between sugar patches; feeding stops depend on the simulated MN9 output">
          {state !== "ready" && <div className="a3d-msg">{state === "error" ? "3D view unavailable (WebGL)." : "Loading the 3D arena…"}</div>}
          <span className="a3d-badge">HYBRID DEMO · walking is not from the brain model</span>
        </div>
        <div className="a3d-row">
          {episodes.length > 1 && (
            <div className="seg" role="radiogroup" aria-label="Which episode">
              {episodes.map((e, i) => (
                <button key={e.key} type="button" role="radio" aria-checked={which === i} className={which === i ? `on ${e.tone ?? ""}` : ""} onClick={() => setWhich(i)}>
                  {e.label}
                </button>
              ))}
            </div>
          )}
          <label className="a3d-check">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Colour by who drives what
          </label>
          <label className="a3d-check">
            <input type="checkbox" checked={modelOnly} onChange={(e) => setModelOnly(e.target.checked)} /> Show only what the brain model decides
          </label>
        </div>
        <div className="a3d-row">
          {!reducedMotion ? (
            <button type="button" className="btn" onClick={() => setPlaying(!playing)} aria-pressed={playing} disabled={!ep}>
              {playing ? "❚❚ Pause" : t >= durMs ? "↺ Replay" : "▶ Play"}
            </button>
          ) : (
            <span className="a3d-note">Reduced motion: use the slider.</span>
          )}
          <input className="a3d-scrub" type="range" min={0} max={durMs} step={10} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Simulated time (ms)" />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed" disabled={reducedMotion}>
            <option value={0.25}>4× slower</option>
            <option value={0.5}>2× slower</option>
            <option value={1}>real time</option>
          </select>
        </div>
      </div>
      <aside className="a3d-readout">
        <div className="a3d-stat"><span className="k">Simulated time</span><span className="v">{(t / 1000).toFixed(2)} / {durMs / 1000} s</span></div>
        <div className="a3d-stat a3d-model"><span className="k">MN9 rate (model)</span><span className="v">{pose ? pose.outSmoothed.toFixed(0) : "–"} Hz</span><span className="h">smoothed over 100 ms</span></div>
        <div className="a3d-stat a3d-app"><span className="k">Proboscis extension</span><span className="v">{pose ? Math.round(pose.extension * 100) : 0}%</span><span className="h">app mapping 5–100 Hz</span></div>
        <div className="a3d-stat a3d-app"><span className="k">Controller</span><span className="v">{pose ? (pose.feeding ? "stopped to feed" : pose.speedBl > 0.05 ? "walking" : "standing") : "–"}</span><span className="h">stops when extension &gt; 25%</span></div>
        <div className="a3d-stat"><span className="k">Time feeding so far</span><span className="v">{feedS.toFixed(1)} s</span>{ep && <span className="h">whole episode: {ep.summary.time_feeding_s.toFixed(1)} s of {ep.config.duration_s} s</span>}</div>
        <ul className="a3d-legend">
          <li><span className="sw" style={{ background: "#f6c945" }} /> proboscis: brain model (MN9) + app mapping</li>
          <li><span className="sw" style={{ background: "#f472b6" }} /> legs, walking, turning: handcrafted controller + tripod gait (app)</li>
          <li><span className="sw" style={{ background: "#9fd8ff" }} /> sugar patches: touching one switches on the sugar neurons; they shrink while the fly feeds (app)</li>
        </ul>
      </aside>
    </div>
  );
}
