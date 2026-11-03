import { useEffect, useRef, useState } from "react";
import { spikesInWindow, type BrainAtlas } from "../lib/brainData";
import { MAPPING } from "../lib/mapping";
import { ROLE_COLORS } from "../three/brain";
import { FlyScene } from "../three/scene";
import { mn9At, siteData, type SiteComparison, type SiteRun } from "./data";
import { MODEL_URL } from "../lib/sceneHooks";
import { STORY_DURATION_S, storyAt, type RunKey, type StoryFrame } from "./story";

/**
 * Development-only video studio (site/#studio). Renders the story frame by frame at a fixed frame
 * rate, independent of how fast the machine is, and encodes it with WebCodecs (mediabunny).
 * The finished file is posted to the Vite dev server, which saves it into site/public/media.
 */
const W = 1920;
const H = 1080;
const FPS = 30;

export default function Studio() {
  const host = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<FlyScene | null>(null);
  const [data, setData] = useState<{ runs: Record<RunKey, SiteRun>; atlas: BrainAtlas; cmp: SiteComparison } | null>(null);
  const [t, setT] = useState(0);
  const [status, setStatus] = useState("loading…");
  const lastRun = useRef<RunKey | null>(null);

  useEffect(() => {
    const s = new FlyScene(host.current!, { modelUrl: MODEL_URL, reducedMotion: true, preserveDrawingBuffer: true, background: "#0b0f22" });
    s.setSize(W, H);
    s.controls.enabled = false;
    Promise.all([s.loaded, siteData.run("baseline"), siteData.run("intervention"), siteData.atlas(), siteData.comparison()])
      .then(([, b, i, a, c]) => {
        s.setBrain(a);
        setData({ runs: { baseline: b, intervention: i }, atlas: a, cmp: c });
        setScene(s);
        setStatus("ready");
      })
      .catch((e) => setStatus(String(e)));
    return () => s.dispose();
  }, []);

  const draw = (tSec: number) => {
    if (!scene || !data || !out.current) return;
    const f = storyAt(tSec);
    const run = data.runs[f.run];
    if (lastRun.current !== f.run) {
      scene.setActivity(run.activity);
      lastRun.current = f.run;
    }
    scene.setViewProgress(f.view);
    scene.setOrbit(f.orbit);
    scene.setSimTime(f.simT);
    const m = mn9At(run, f.simT);
    scene.setExtension(m.extension);
    scene.setStim(f.stimOn);
    scene.renderNow();
    const ctx = out.current.getContext("2d")!;
    ctx.drawImage(scene.renderer.domElement, 0, 0, W, H);
    drawHud(ctx, f, run, m, data.cmp);
  };

  useEffect(() => draw(t), [t, scene, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const render = async () => {
    if (!scene || !data || !out.current) return;
    const mb = await import("mediabunny");
    const codec = await mb.getFirstEncodableVideoCodec(["avc", "vp9"], { width: W, height: H });
    if (!codec) {
      setStatus("No usable video encoder in this browser.");
      return;
    }
    const mp4 = codec === "avc";
    const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const src = new mb.CanvasSource(out.current, { codec, quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(src, { frameRate: FPS });
    await output.start();
    const n = Math.ceil(STORY_DURATION_S * FPS);
    lastRun.current = null;
    for (let i = 0; i < n; i++) {
      draw(i / FPS);
      await src.add(i / FPS, 1 / FPS);
      if (i % 15 === 0) setStatus(`encoding ${codec}: frame ${i + 1} / ${n}`);
    }
    await output.finalize();
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
    const name = mp4 ? "flybrain-story.mp4" : "flybrain-story.webm";
    setStatus(`saving ${(buf.byteLength / 1e6).toFixed(1)} MB…`);
    const r = await fetch(`/__save-media?name=${name}`, { method: "POST", body: buf });
    // poster: the first frame inside the head
    draw(16);
    const jpg = await new Promise<Blob>((res) => out.current!.toBlob((b) => res(b!), "image/jpeg", 0.88));
    await fetch(`/__save-media?name=flybrain-story-poster.jpg`, { method: "POST", body: jpg });
    setStatus(r.ok ? `saved ${name} (${(buf.byteLength / 1e6).toFixed(1)} MB, ${n} frames)` : `save failed: ${r.status}`);
  };

  return (
    <div className="studio">
      <div ref={host} style={{ position: "absolute", left: -10000, top: 0, width: W, height: H }} />
      <canvas ref={out} width={W} height={H} style={{ width: "100%", maxWidth: 1280, display: "block" }} />
      <div className="studio-bar">
        <input type="range" min={0} max={STORY_DURATION_S} step={1 / FPS} value={t} onChange={(e) => setT(Number(e.target.value))} style={{ width: 600 }} aria-label="Video time" />
        <span>{t.toFixed(2)} s / {STORY_DURATION_S} s</span>
        <button type="button" onClick={render} disabled={!scene}>Render video</button>
        <span id="studio-status">{status}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- overlay drawing

const FONT = '"Segoe UI", "IBM Plex Sans", system-ui, sans-serif';

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, size = 24, align: "left" | "right" | "center" = "left") {
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.1;
  const h = size * 1.7;
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x0, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + size * 0.55, y + h / 2 + 1);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawHud(ctx: CanvasRenderingContext2D, f: StoryFrame, run: SiteRun, m: ReturnType<typeof mn9At>, cmp: SiteComparison) {
  ctx.save();
  if (f.card === "title") {
    ctx.fillStyle = "rgba(8,10,24,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fde68a";
    ctx.font = `600 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("A SIMULATION OF THE WHOLE FRUIT-FLY BRAIN", W / 2, 330);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 76px ${FONT}`;
    ctx.fillText("What happens in a fly's brain", W / 2, 440);
    ctx.fillText("when it tastes sugar?", W / 2, 530);
    ctx.fillStyle = "#c7cbe6";
    ctx.font = `400 32px ${FONT}`;
    ctx.fillText("127,400 simulated neurons wired like the FlyWire connectome (Shiu et al. 2024 model)", W / 2, 620);
    ctx.font = `400 26px ${FONT}`;
    ctx.fillStyle = "#f9a8d4";
    ctx.fillText("Simulated activity, not a recording. Stylised 3D house fly; the brain is a fruit-fly brain.", W / 2, 690);
    ctx.restore();
    return;
  }
  if (f.card === "end") {
    const o = cmp.outputs[0];
    ctx.fillStyle = "rgba(8,10,24,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 60px ${FONT}`;
    ctx.fillText("Silencing 2 of 127,400 neurons", W / 2, 250);
    ctx.font = `400 34px ${FONT}`;
    ctx.fillStyle = "#c7cbe6";
    ctx.fillText(`MN9 firing, average of ${o.n_trials} paired trials`, W / 2, 320);
    ctx.font = `700 96px ${FONT}`;
    ctx.fillStyle = "#60a5fa";
    ctx.fillText(`${o.baseline_mean_rate_hz.toFixed(1)} Hz`, W / 2 - 330, 480);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("→", W / 2, 480);
    ctx.fillStyle = "#fb923c";
    ctx.fillText(`${o.intervention_mean_rate_hz.toFixed(1)} Hz`, W / 2 + 330, 480);
    ctx.font = `400 30px ${FONT}`;
    ctx.fillStyle = "#c7cbe6";
    ctx.fillText(`sugar only  ·  ${o.delta_percent.toFixed(0)}% (lower in ${o.trials_decreased} of ${o.n_trials} trials)  ·  Roundup silenced`, W / 2, 545);
    ctx.font = `400 25px ${FONT}`;
    ctx.fillStyle = "#9aa3c7";
    const lines = [
      "Model: Shiu et al., Nature 634, 210-219 (2024), github.com/philshiu/Drosophila_brain_model (commit 91bdd1e)",
      "Connectome: FlyWire public release v630 · Neuron positions: flywire_annotations v1.1.0 (Schlegel et al. 2024)",
      "Simulated with a validated re-implementation; one simulated second shown 20x slower.",
      "Proboscis movement size and all camera/animation choices are the animator's, not the model's.",
    ];
    lines.forEach((l, k) => ctx.fillText(l, W / 2, 700 + k * 42));
    ctx.fillStyle = "#fde68a";
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText("gelastinta.com", W / 2, 920);
    ctx.restore();
    return;
  }
  // persistent labels
  pill(ctx, 36, 32, "SIMULATION REPLAY · not recorded data", "rgba(244,114,182,0.18)", "#f9a8d4", 22);
  pill(ctx, W / 2, 32, f.run === "baseline" ? "Run: sugar neurons on" : "Run: sugar neurons on + Roundup silenced", f.run === "baseline" ? "rgba(96,165,250,0.25)" : "rgba(251,146,60,0.25)", "#ffffff", 24, "center");
  if (f.hud) {
    // readouts
    const x = W - 400, y = 110;
    ctx.fillStyle = "rgba(10,12,30,0.62)";
    ctx.beginPath();
    ctx.roundRect(x, y, 364, 330, 18);
    ctx.fill();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#9aa3c7";
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText("simulated time", x + 24, y + 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(`${Math.round(f.simT)} ms`, x + 24, y + 88);
    ctx.fillStyle = "#9aa3c7";
    ctx.font = `400 19px ${FONT}`;
    ctx.fillText(f.slowmo ? `shown ${f.slowmo}x slower than simulated` : " ", x + 24, y + 116);
    ctx.font = `500 22px ${FONT}`;
    ctx.fillStyle = "#ff8fbd";
    ctx.fillText(`MN9  ${m.smoothed.toFixed(0)} spikes/s`, x + 24, y + 166);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 24, y + 180, 316, 16);
    ctx.fillStyle = ROLE_COLORS.mn9;
    ctx.fillRect(x + 24, y + 180, 316 * Math.min(1, m.smoothed / 110), 16);
    ctx.fillStyle = "#f6c945";
    ctx.fillText(`proboscis  ${Math.round(m.extension * 100)}%`, x + 24, y + 236);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 24, y + 250, 316, 16);
    ctx.fillStyle = "#f6c945";
    ctx.fillRect(x + 24, y + 250, 316 * m.extension, 16);
    ctx.fillStyle = "#9aa3c7";
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText(`spikes in last 10 ms (all neurons): ${spikesInWindow(run.activity, f.simT, 10)}`, x + 24, y + 300);
    if (f.view > 0.5) {
      // legend
      const lx = W - 400, ly = 460;
      ctx.fillStyle = "rgba(10,12,30,0.62)";
      ctx.beginPath();
      ctx.roundRect(lx, ly, 364, 172, 18);
      ctx.fill();
      const items: [string, string][] = [
        [ROLE_COLORS.spike, "a neuron spiking"],
        [ROLE_COLORS.sugar, "21 sugar-taste neurons (input)"],
        [ROLE_COLORS.mn9, "MN9 motor neurons (output)"],
        ...(f.run === "intervention" ? ([[ROLE_COLORS.silenced, "silenced Roundup neurons"]] as [string, string][]) : []),
      ];
      ctx.font = `400 21px ${FONT}`;
      items.forEach(([c, label], k) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(lx + 34, ly + 36 + k * 36, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e7e9f3";
        ctx.fillText(label, lx + 56, ly + 43 + k * 36);
      });
    }
    // caption
    ctx.font = `500 36px ${FONT}`;
    const lines = wrap(ctx, f.caption, 1300);
    const subLines = f.sub ? 1 : 0;
    const boxH = 40 + lines.length * 48 + subLines * 40;
    ctx.fillStyle = "rgba(8,10,24,0.72)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - 700, H - 60 - boxH, 1400, boxH, 20);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    lines.forEach((l, k) => ctx.fillText(l, W / 2, H - 60 - boxH + 58 + k * 48));
    if (f.sub) {
      ctx.font = `400 24px ${FONT}`;
      ctx.fillStyle = "#9aa3c7";
      ctx.fillText(f.sub, W / 2, H - 60 - 26);
    }
  }
  ctx.textAlign = "left";
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = "rgba(200,205,230,0.6)";
  ctx.fillText(`Shiu et al. 2024 model · FlyWire v630 · extension mapping: ${MAPPING.R_THRESHOLD}-${MAPPING.R_SATURATION} Hz (display choice)`, 36, H - 22);
  ctx.restore();
}
