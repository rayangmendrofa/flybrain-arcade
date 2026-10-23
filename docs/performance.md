# Performance

Measured with `python scripts/benchmark.py` on 2026-10-23. Each row runs in a fresh process.
Wall-clock includes loading the network and building the model. It excludes interpreter start-up
and Numba JIT, which is compiled once and cached on disk. Raw data: [benchmark.json](benchmark.json).

**Hardware/backend:** Intel Core Ultra 7 258V (8 cores), 31.5 GiB RAM, Windows 11, Python 3.14.7.
No C++ compiler is installed, so Brian2 uses its NumPy runtime target.
**Model size:** 127,400 neurons, 14,687,178 connections, 52,793,639 synapses (FlyWire v630). Nothing is pruned.

| Engine | Simulated | Input | Wall-clock | Wall s per simulated s | Peak memory |
|---|---|---|---|---|---|
| numba-port | 1 × 1000 ms | 100 Hz | 2.33 s | 2.33 | 0.50 GB |
| numba-port | 10 × 1000 ms | 100 Hz | 4.48 s | 0.45 | 0.54 GB |
| numba-port | 30 × 1000 ms | 100 Hz | 9.07 s | 0.30 | 0.61 GB |
| numba-port | 30 × 1000 ms | 200 Hz | 9.12 s | 0.30 | 0.62 GB |
| brian2-reference | 1 × 1000 ms | 100 Hz | 20.75 s | 20.75 | 3.06 GB |
| arena (numba, 1 continuous trial, 50 ms control windows) | 15 s | contact-dependent | 17.4–27 s | 1.2–1.8 | ≈ 0.6 GB |

For comparison, the paper reports "approximately 5 min per 1,000 ms trial per CPU thread" on its
2023 setup.

**Not real-time.** A single trial of the full model runs slower than simulated time on this
laptop with either engine. Trials run in parallel threads, so batches of seeds are cheap.
Simulated time and wall-clock time are always reported separately in the UI.

**Defaults chosen from these numbers:** Numba port, 10 trials × 1000 ms (≈ 4.5 s, enough for
across-seed SD), up to 30 trials (the upstream protocol). Brian2 is capped at 3 trials × 1000 ms
(≈ 1 min) and is labelled slow.

**In the app:** the worker keeps the network loaded, so the first-run load (~1 s) is paid once at
start-up during warm-up. A 10-trial run took 3.2 s in the browser test.
