// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { lazy, Suspense, useEffect, useState } from "react";
import { webglAvailable } from "../lib/webgl";
import { ArenaDemo } from "./ArenaDemo";
import { siteData, type Manifest, type SiteComparison, type SiteRun } from "./data";
import { Explorer } from "./Explorer";
import { useReducedMotion } from "../lib/sceneHooks";
import { LifNeuron } from "./LifNeuron";

const Studio = import.meta.env.DEV ? lazy(() => import("./Studio")) : null;
const VIDEO = `${import.meta.env.BASE_URL}media/flybrain-story.mp4`;
const POSTER = `${import.meta.env.BASE_URL}media/flybrain-story-poster.jpg`;

export default function Site() {
  const reduced = useReducedMotion();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [runs, setRuns] = useState<{ baseline: SiteRun; intervention: SiteRun } | null>(null);
  const [cmp, setCmp] = useState<SiteComparison | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gl] = useState(webglAvailable);

  useEffect(() => {
    Promise.all([siteData.manifest(), siteData.run("baseline"), siteData.run("intervention"), siteData.comparison()])
      .then(([m, b, i, c]) => {
        setManifest(m);
        setRuns({ baseline: b, intervention: i });
        setCmp(c);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  if (Studio && location.hash === "#studio") {
    return (
      <Suspense fallback={<p>Loading studio…</p>}>
        <Studio />
      </Suspense>
    );
  }

  const mn9 = cmp?.outputs[0];
  return (
    <main className="site">
      <header className="hero">
        <p className="kicker">A hobby project · gelastinta</p>
        <h1>What happens in a fly&rsquo;s brain when it tastes sugar?</h1>
        <p className="lede">
          Scientists have mapped every neuron and connection in a fruit-fly brain. A published computer model turns that map into a brain that can be
          &ldquo;switched on&rdquo;. Here we feed it sugar, watch the spikes, and silence two neurons to see what changes.
        </p>
        <figure className="video">
          <video src={VIDEO} poster={POSTER} controls preload="metadata" playsInline aria-label="Narrated animation: simulated brain activity during sugar stimulation, then with Roundup neurons silenced" />
          <figcaption>
            Animation of <strong>simulated</strong> activity (Shiu et al. 2024 model), slowed 20×. Not a recording from a real fly. The fly is a stylised
            3D house fly; the brain is the fruit-fly (<em>Drosophila</em>) brain the model is built from.
          </figcaption>
        </figure>
        <ul className="legend-cats">
          <li><span className="cat data">DATA</span> measured wiring and neuron positions</li>
          <li><span className="cat model">MODEL</span> simulated activity, under the model&rsquo;s assumptions</li>
          <li><span className="cat app">APP</span> choices made for this page (animation, mappings, walking)</li>
        </ul>
      </header>

      {err && <p className="error">Could not load the data: {err}</p>}

      <section className="chapter">
        <h2><span className="cat data">DATA</span> 1 · The map</h2>
        <div className="cols">
          <div>
            <p>
              The <a href="https://flywire.ai">FlyWire</a> project reconstructed the whole brain of one adult female fruit fly from electron-microscope images: every
              neuron and every synapse between them. The version used here (v630) contains <strong>127,400 neurons</strong> joined by about{" "}
              <strong>14.7 million connections</strong> (52.8 million synapses).
            </p>
            <p>
              Each dot you will see inside the head is one of those neurons, placed where it sits in the real brain (positions from Schlegel et al. 2024, matched by
              neuron ID). {manifest && <>{manifest.positions.n_with_position.toLocaleString()} of {manifest.positions.n_neurons.toLocaleString()} have a known position.</>}
            </p>
          </div>
          <dl className="facts">
            <div><dt>Neurons</dt><dd>127,400</dd></div>
            <div><dt>Connections</dt><dd>14.7 M</dd></div>
            <div><dt>Synapses</dt><dd>52.8 M</dd></div>
            <div><dt>Brain width</dt><dd>~0.8 mm</dd></div>
          </dl>
        </div>
      </section>

      <section className="chapter">
        <h2><span className="cat model">MODEL</span> 2 · Turning the map into a brain</h2>
        <p>
          Shiu et al. (Nature, 2024) gave every neuron the same simple rule: it is a <em>leaky bucket</em>. Incoming spikes add charge, the charge leaks away, and if
          it rises past a threshold the neuron fires a spike of its own and resets. How strongly one neuron pushes another depends only on how many synapses
          connect them, and whether its transmitter excites or inhibits. That is the whole model: no learning, no chemistry beyond that. Try one neuron:
        </p>
        <LifNeuron />
      </section>

      <section className="chapter">
        <h2><span className="cat model">MODEL</span> 3 · Sugar in, spikes out</h2>
        <p>
          We switch on the 21 sugar-taste neurons from the paper (random spikes at 100 per second each) for one simulated second and record every spike in the
          brain. The paper used the same test, and the readout is <strong>MN9</strong>: a motor neuron that lifts the proboscis, the fly&rsquo;s feeding tube.
          Open the head, press play, and switch between the two runs.
        </p>
        {runs && gl ? <Explorer runs={runs} reducedMotion={reduced} /> : !gl ? <p className="note">This part needs WebGL, which is not available in this browser.</p> : <p className="note">Loading…</p>}
      </section>

      <section className="chapter">
        <h2><span className="cat model">MODEL</span> 4 · Silence two neurons</h2>
        <p>
          The model can switch any neuron off. We silenced <strong>Roundup</strong>, a cell type the paper places in the sugar-to-feeding pathway (two neurons, one
          per side), and repeated the exact same 10 trials with the same random input.
        </p>
        {mn9 && <TrialBars c={mn9} />}
        {cmp && <p className="fine">{cmp.interpretation}</p>}
      </section>

      <section className="chapter">
        <h2><span className="cat app">APP</span> 5 · From brain to behaviour (hybrid demo)</h2>
        <p>
          The brain model only produces spikes. To see what that could mean for a fly, we connected it to a simple, <strong>hand-written</strong> walking
          controller: the fly wanders, and when it stands on sugar the sugar neurons switch on. If MN9 then drives the proboscis out far enough, the controller
          stops it to feed. The walking, turning and leg movements are ours, not the model&rsquo;s. Only the decision to stop and feed comes from the simulated brain.
        </p>
        {gl ? <ArenaDemo reducedMotion={reduced} /> : <p className="note">This part needs WebGL.</p>}
      </section>

      <section className="chapter honest">
        <h2>What this does and doesn&rsquo;t show</h2>
        <ul>
          <li>Everything moving here is computed from a model. None of it is a recording from a living fly.</li>
          <li>The model leaves out a lot: neuromodulators, electrical synapses, neuron shapes, the body, learning. It has no spontaneous activity.</li>
          <li>Absolute firing rates are uncertain. The paper tested the model mainly on whether activating or silencing neurons changes the output in the right direction.</li>
          <li>How strongly MN9 moves the proboscis is not known. The extension shown is a display choice (0% below 5 Hz, 100% at 100 Hz).</li>
          <li>The 3D fly is a stylised house fly (an AI-generated model), not an anatomical reconstruction. The brain inside it is a fruit-fly brain.</li>
          <li>The leg gait is a generic insect tripod pattern, drawn by this page. The brain map used here has no nerve cord, so the model cannot make legs move.</li>
          <li>Nothing here learns. The arena fly does not &ldquo;know&rdquo; where food is; it only stops when the model&rsquo;s feeding output is high.</li>
        </ul>
      </section>

      <footer className="credits">
        <h2>Sources and credits</h2>
        <ul>
          <li>Model: Shiu, P.K., Sterne, G.R., Spiller, N. et al. <em>A Drosophila computational brain model reveals sensorimotor processing.</em> Nature 634, 210–219 (2024). Code: <a href="https://github.com/philshiu/Drosophila_brain_model">philshiu/Drosophila_brain_model</a> (MIT), commit {manifest?.model.commit.slice(0, 7) ?? "…"}.</li>
          <li>Connectome: FlyWire, public release v630 (Dorkenwald et al. 2024; Schlegel et al. 2024, Nature 634).</li>
          <li>Neuron positions: <a href="https://github.com/flyconnectome/flywire_annotations">flyconnectome/flywire_annotations</a> {manifest?.positions.tag ?? ""} (Schlegel et al. 2024).</li>
          <li>Simulation: a Numba re-implementation of the published model, checked spike-for-spike against the original Brian2 code. Precomputed on a laptop{manifest ? `, ${manifest.replay.computed_at}` : ""}.</li>
          <li>3D fly: house-fly model generated with Tripo AI, simplified for the web.</li>
        </ul>
        {manifest && <p className="fine">Data files generated {manifest.generated}{manifest.project_commit ? ` from project commit ${manifest.project_commit.slice(0, 7)}` : ""}.</p>}
      </footer>
    </main>
  );
}

function TrialBars({ c }: { c: SiteComparison["outputs"][number] }) {
  const max = Math.max(...c.per_trial_baseline_hz, ...c.per_trial_intervention_hz, 1);
  const W = 640, H = 220, pad = 34, bw = (W - pad) / c.n_trials;
  const y = (v: number) => H - 24 - (v / max) * (H - 50);
  return (
    <figure className="bars">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`MN9 firing rate in each of ${c.n_trials} trials: sugar only versus Roundup silenced. It dropped in ${c.trials_decreased} of ${c.n_trials} trials.`}>
        {[0, 25, 50, 75].filter((v) => v <= max).map((v) => (
          <g key={v}>
            <line x1={pad} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad - 6} y={y(v) + 4} textAnchor="end" className="lbl">{v}</text>
          </g>
        ))}
        {c.per_trial_baseline_hz.map((b, k) => {
          const i = c.per_trial_intervention_hz[k];
          const x0 = pad + k * bw + bw * 0.12;
          const w = bw * 0.36;
          return (
            <g key={k}>
              <rect x={x0} y={y(b)} width={w} height={y(0) - y(b)} className="bar base" />
              <rect x={x0 + w + 2} y={y(i)} width={w} height={y(0) - y(i)} className="bar int" />
              <text x={x0 + w} y={H - 8} textAnchor="middle" className="lbl">{k + 1}</text>
            </g>
          );
        })}
        <text x={pad} y={14} className="lbl">MN9 spikes per second, per trial (trial number below)</text>
      </svg>
      <figcaption>
        <span className="base-t">Sugar</span>: {c.baseline_mean_rate_hz.toFixed(1)} Hz on average · <span className="int-t">Roundup silenced</span>:{" "}
        {c.intervention_mean_rate_hz.toFixed(1)} Hz · change {c.delta_rate_hz.toFixed(1)} Hz ({c.delta_percent.toFixed(0)}%), lower in {c.trials_decreased} of {c.n_trials}{" "}
        paired trials.
      </figcaption>
    </figure>
  );
}
