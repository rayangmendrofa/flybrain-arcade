# Arena: hybrid embodied demonstration (stage 2)

**Label used everywhere: HYBRID DEMONSTRATION.** The published Shiu et al. model is a
feeding/grooming sensorimotor model. It has no walking, steering, vision, learning or body. In the
arena, walking and steering come from a **handcrafted controller**. The neural model only
contributes MN9 activity, which this app turns into a "stop and feed" signal. Nothing learns.

```
environment ──c──▶ sensory encoder ──r_in──▶ NEURAL MODEL ──MN9 spikes──▶ output decoder ──e──▶ movement ──x,y──▶ environment
   (APP)               (APP map,                (published,                  (APP)               (HANDCRAFTED
                        DATA neuron IDs)          all 127,400 neurons)                             CONTROLLER)
```

All interfaces update every **50 ms of simulated time**. Inside each window the neural model
integrates at dt = 0.1 ms with its full state (v, g, refractory clocks, spikes in flight on 1.8 ms
delays) carried across windows. A test proves that a session advanced in windows produces exactly
the same spikes as one uninterrupted run with the same input.

| Interface | Variables (unit, rate) | Neurons | Mapping | Provenance |
|---|---|---|---|---|
| Environment → encoder | fly position x, y (mm); cue concentration c of the patch under the fly (0–1) — every 50 ms | — | c = patch.amount if the fly's centre is inside a patch (contact cue; taste is contact-based, so no gradient), else 0. While feeding, patch.amount −= 0.08·e·Δt | APP |
| Encoder → model | Poisson rate r_in per stimulated neuron (Hz), held for each 50 ms window | the 21 upstream sugar GRNs (FlyWire v630) | r_in = r_max·c, with r_max chosen by the user (0–200 Hz); delivered through the upstream PoissonInput mechanism (Bernoulli(r_in·dt) per step, 68.75 mV kick) | IDs and mechanism: published; linear map: APP |
| Model | spikes of all neurons, dt = 0.1 ms | all 127,400 (optional upstream silencing) | upstream LIF equations | published model (Numba port, validated) |
| Model → decoder | MN9 spike count n per window → n/Δt (Hz) | MN9 720575940660219265 | s ← s + (n/Δt − s)(1 − e^(−Δt/0.1 s)); e = clamp((s − 5)/(100 − 5), 0, 1) | MN9 as feeding output: published; smoothing/ramp: APP |
| Decoder → movement | speed (mm/s), heading (rad), every 50 ms | none | if e > 0.25: speed = 0 (feeding); else speed = v_walk·(1 − e). Heading = random walk (σ = 1.2 rad/√s) + obstacle avoidance (5 mm look-ahead, ≤ 4 rad/s) | HANDCRAFTED CONTROLLER (APP) |

Notes

* **Controls built in.** The `decoder = none` condition gives a controller-only run with e ≡ 0, so
  the fly never stops. Silencing a verified group (for example Roundup) uses the upstream
  `silence()`. A fixed seed fixes both the Poisson input draws and the controller noise, so
  conditions can be compared like for like.
* **Synthetic option.** The arena can run on the clearly labelled 400-neuron synthetic network
  (outputs SYN-399). It is not the published model.
* **No learning claim.** The trajectory is a seeded random walk. A fly that "finds" food did so by
  chance.
* **Timing.** On the benchmark machine the full model needed 1.2–1.8 s wall-clock per simulated
  second in arena mode. That is not real-time, so episodes are computed in the background worker
  and then played back.
