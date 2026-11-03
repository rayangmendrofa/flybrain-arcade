// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
// This widget uses the upstream model's equations and parameters for a single neuron.

import { useMemo, useState } from "react";

/**
 * One neuron with the model's own equations and parameters (Shiu et al. 2024):
 *   dv/dt = (v0 - v + g) / t_mbr,   dg/dt = -g / tau,   spike when v > v_th, then v = v_rst for t_rfc
 * Each incoming spike adds w_syn x (number of synapses) to g. Exact exponential update per 0.1 ms
 * step, as Brian2's "linear" integrator does. Input spike times are Poisson with a fixed seed.
 */
const P = { v0: -52, vth: -45, vrst: -52, tm: 20, tau: 5, rfc: 2.2, wsyn: 0.275, dt: 0.1 };
const T_MS = 400;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateLif(rateHz: number, synapses: number, seed = 7) {
  const { v0, vth, vrst, tm, tau, rfc, wsyn, dt } = P;
  const c2 = Math.exp(-dt / tau);
  const c8 = v0 - v0 * Math.exp(-dt / tm);
  const c9 = (tau / (tm - tau)) * (-Math.exp(dt / tm) + Math.exp(dt / tau)) * Math.exp(-dt / tm) * Math.exp(-dt / tau);
  const c10 = Math.exp(-dt / tm);
  const rnd = mulberry32(seed);
  const n = Math.round(T_MS / dt);
  const v = new Float32Array(n);
  const inputs: number[] = [];
  const spikes: number[] = [];
  let vv = v0, g = 0, last = -1e9;
  const pIn = (rateHz * dt) / 1000;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    // Brian2 order: state update, threshold, synaptic input, reset. Both v and g are
    // "(unless refractory)", so they freeze while refractory and inputs then are dropped.
    if (t - last >= rfc) {
      const nv = c8 + c9 * g + c10 * vv;
      g = c2 * g;
      vv = nv;
      if (vv > vth) {
        spikes.push(t);
        last = t;
      }
    }
    const refractory = t - last < rfc;
    if (rnd() < pIn) {
      inputs.push(t);
      if (!refractory) g += wsyn * synapses;
    }
    if (last === t) vv = vrst;
    v[i] = vv;
  }
  return { v, inputs, spikes };
}

export function LifNeuron() {
  const [rate, setRate] = useState(150);
  const [syn, setSyn] = useState(25);
  const sim = useMemo(() => simulateLif(rate, syn), [rate, syn]);
  const W = 640, H = 200, top = 26;
  const y = (mv: number) => top + ((-40 - mv) / 16) * (H - top - 10);
  const step = Math.max(1, Math.floor(sim.v.length / W));
  let d = "";
  for (let i = 0; i < sim.v.length; i += step) d += `${i ? "L" : "M"}${((i / sim.v.length) * W).toFixed(1)},${y(sim.v[i]).toFixed(1)}`;
  const x = (t: number) => (t / T_MS) * W;
  return (
    <div className="lif">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Membrane voltage of one model neuron over ${T_MS} ms: ${sim.inputs.length} input spikes, ${sim.spikes.length} output spikes`}>
        {sim.inputs.map((t, k) => (
          <line key={`i${k}`} x1={x(t)} x2={x(t)} y1={4} y2={14} className="in-tick" />
        ))}
        <line x1={0} x2={W} y1={y(P.vth)} y2={y(P.vth)} className="thresh" />
        <text x={W - 4} y={y(P.vth) - 4} textAnchor="end" className="lbl">threshold −45 mV</text>
        <line x1={0} x2={W} y1={y(P.v0)} y2={y(P.v0)} className="rest" />
        <text x={W - 4} y={y(P.v0) - 4} textAnchor="end" className="lbl">rest −52 mV</text>
        <path d={d} className="vtrace" />
        {sim.spikes.map((t, k) => (
          <line key={`s${k}`} x1={x(t)} x2={x(t)} y1={y(P.vth)} y2={top - 6} className="spike" />
        ))}
        <text x={2} y={22} className="lbl">input spikes</text>
      </svg>
      <div className="lif-controls">
        <label>
          Input spikes per second: <strong>{rate}</strong>
          <input type="range" min={0} max={400} step={10} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <label>
          Synapses per connection: <strong>{syn}</strong>
          <input type="range" min={1} max={60} value={syn} onChange={(e) => setSyn(Number(e.target.value))} />
        </label>
        <p className="fine">
          {sim.inputs.length} inputs → <strong>{sim.spikes.length} output spikes</strong> in {T_MS} ms. Same equations and parameters as the full model; in the
          real network each of the 127,400 neurons gets its inputs from the neurons wired to it in FlyWire.
        </p>
      </div>
    </div>
  );
}
