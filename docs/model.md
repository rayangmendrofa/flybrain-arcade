# The model, and what was verified upstream

## In one paragraph

Shiu et al. (Nature 2024) turned the FlyWire connectome of an adult female *Drosophila* brain
(public materialization **v630**, 127,400 proofread neurons) into a network of leaky
integrate-and-fire (LIF) neurons. Each connection's weight is its synapse count × ±1 (sign from the
predicted neurotransmitter of the presynaptic neuron: GABA and glutamate count as inhibitory) ×
one free parameter, `w_syn = 0.275 mV`. Every neuron has the same membrane parameters, and no
neuron fires spontaneously. "Activating" neurons means giving them Poisson input. "Silencing" a
neuron removes all its output synapses. With the 21 labellar sugar gustatory receptor neurons
(GRNs) activated, the model drives proboscis motor neurons, including **MN9**, which "controls
rostrum lifting during proboscis extension". The paper used the model to predict which neurons are
sufficient for or required by this sugar → MN9 pathway and tested some predictions in flies.

The paper is explicit about limits. The model has no gap junctions, neuromodulation or
neuropeptides, no morphology and no receptor dynamics. Neurotransmitter predictions may be wrong.
Because the baseline rate is 0 Hz, inhibition onto an inactive neuron has no effect. For these
reasons "absolute firing rates of the model are unlikely to be accurate". The authors interpret
broad differences between conditions instead. FlyBrain Arcade presents its numbers the same way:
**results within this model, not predictions validated in a living fly**.

## Equations and units (from upstream `model.py`)

```
dv/dt = (v_0 − v + g) / t_mbr      (unless refractory)
dg/dt = −g / tau                    (unless refractory)
spike when v > v_th  →  v = v_rst, g = 0
presynaptic spike  →  after t_dly:  g_post += w,  w = (Excitatory × Connectivity) · w_syn
```

| Parameter | Value | Source given upstream |
|---|---|---|
| v_0 (rest), v_rst (reset) | −52 mV | Kakaria & de Bivort 2017 |
| v_th (threshold) | −45 mV | Kakaria & de Bivort 2017 |
| t_mbr (membrane time constant) | 20 ms | Kakaria & de Bivort 2017 |
| tau (synaptic decay) | 5 ms | Jürgensen et al. |
| t_rfc (refractory) | 2.2 ms | Lazar et al. |
| t_dly (synaptic delay) | 1.8 ms | Paul et al. 2015 |
| w_syn | 0.275 mV per synapse | free parameter (chosen so 100 Hz sugar input gives ≈ 80 % of maximal MN9 firing) |
| r_poi (default Poisson rate) | 150 Hz | default in `model.py` |
| f_poi | 250 → Poisson kick w_syn·f_poi = 68.75 mV | "sufficient to cause spiking" |
| dt | 0.1 ms | **not set upstream or in the paper**: Brian2's default clock applies |
| t_run × n_run | 1000 ms × 30 trials | `model.py` defaults, paper Methods |

Integration: Brian2 `method='linear'` (exact). Schedule: Brian2 default
(groups → thresholds → synapses → resets).

The app never re-types these numbers. `flybrain/upstream.py` imports the upstream
`model.default_params` and strips units, and a test asserts the values above.

## Stimulation and silencing (upstream mechanisms, used unchanged)

* **Activation** — `poi()`: one `PoissonInput(target_var='v', N=1, rate=r_poi, weight=w_syn·f_poi)`
  per target neuron, and the target's refractory period is set to 0. Each step has probability
  `r_poi·dt` of a 68.75 mV kick to `v`, which makes the neuron fire on the next step.
* **Silencing** — `silence()`: `syn.w[i == silenced] = 0`, i.e. **outgoing** synapses only. The
  upstream README says "to and from those neurons", but the code and the paper Methods
  ("eliminating all output of that neuron") remove output only. The app follows the code. A
  silenced neuron can still fire, for example if it is stimulated, but affects nothing downstream.

## Identifiers used (all FlyWire v630 root IDs from upstream files)

| Role | IDs | Upstream source |
|---|---|---|
| Stimulated sugar GRNs | 21 IDs | `example.ipynb` `neu_sugar`; `figures.ipynb` Fig. 1D |
| Feeding output: MN9 (Fig. 1 readout) | 720575940660219265 | `example.ipynb` `id_mn9`; `figures.ipynb` Fig. 1E/F |
| MN9 (other hemisphere) | 720575940645521262 | `figures.ipynb` Fig. 2 `ids_mn9` ("left and right") |
| Silencing groups | Fig. 1b cell types with IDs (G2N-1, Rattle, Usnea, FMIn, Bract, Fdg, Roundup, Clavicle), Phantom, all 106 SEZ types | `sez_neurons.pickle` (Fig. 2) |

Fig. 1b of the paper also draws Sternum, Roundtree, Rounddown and Zorro. The upstream files
contain no IDs for them, so the app does not offer them.

**Hemisphere naming.** The upstream code comments call the 21 GRNs "right hemisphere". The paper
Methods say left-hemisphere activation was used for all simulations except Extended Data Fig. 1d,
and that MN9 readouts refer to the MN9 contralateral to the activated GRNs. The app does not
resolve this naming difference. It labels `…219265` as "MN9 (Fig. 1 readout)" and the other ID as
"MN9 (other hemisphere)". The "ipsilateral" description of the second MN9 is an inference from the
Fig. 2 pair.

## Data and versions

* Upstream repository <https://github.com/philshiu/Drosophila_brain_model>, commit
  `91bdd1e7dcf193f3e7ca5a8933497fcef63b7960` (2024-09-14), MIT licence.
* Data: `2023_03_23_completeness_630_final.csv` (127,400 neurons, SHA-256 `479ed718…`) and
  `2023_03_23_connectivity_630_final.parquet` (14,687,178 connections, 52,793,639 synapses,
  SHA-256 `94db8c65…`). They are verified at start-up and stamped into every provenance record.
* The repository also ships v783 files (`Completeness_783.csv`, `Connectivity_783.parquet`).
  They are **not used**: root IDs change between materializations. One of the 21 sugar-GRN IDs and
  the second MN9 ID do not exist in v783, so mixing versions would silently break the experiment.
  MaleCNS is a different specimen and ID system and is not used either.
* Upstream dependencies (`environment.yml`): Python 3.10, Brian2 2.5.1, numpy 1.24, pandas,
  joblib, pyarrow. The app was verified with Python 3.14.7 and Brian2 2.10.1 (see validation).

## Other upstream observations

* `example.ipynb` says "By default, the neurons are excited at 200 Hz", but `model.py` has always
  defaulted to 150 Hz (git history). The bundled `results/example/sugarR.parquet` was evidently
  produced at **200 Hz**: its mean GRN rate is 196.8 Hz, which matches 200·(1 − 200·dt) once the
  reset rule below is taken into account. The app uses it as a 200 Hz reference.
* **Refractory inputs are discarded.** Brian2 makes variables flagged `(unless refractory)`
  *conditional-write*. Synaptic `g += w` and Poisson `v += kick` therefore have no effect on a
  neuron that is refractory, or that spiked in the current step. This is implicit in upstream
  behaviour. It is consistent with the paper's "cannot change for the duration of the refractory
  time period", and it matters quantitatively: without it, contralateral MN9 at 100 Hz is about
  81 Hz instead of 67 Hz.
* The reset string `'v = v_rst; w = 0; g = 0 * mV'` assigns a temporary `w`. In Brian2 that is a
  no-op, confirmed in the generated code.

## Two engines

| Engine | What it is | Use |
|---|---|---|
| `brian2-reference` | Upstream `create_model`, `poi`, `silence` executed by Brian2 2.10.1 (NumPy runtime target, because no C++ compiler is present) | Validation; short live runs (≤ 3 trials) |
| `numba-port` (default) | Numba re-implementation of the exact per-step operations Brian2 executes for this model, including the generated `linear` update constants and the conditional-write rule | Interactive runs (≤ 30 trials) and the arena |

The port is validated spike-for-spike against Brian2 (see [validation.md](validation.md)). Both
simulate the whole 127,400-neuron network. Nothing is pruned.
