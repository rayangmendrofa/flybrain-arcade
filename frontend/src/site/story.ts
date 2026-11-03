// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
/**
 * The narrated sequence used for the rendered video (and the page's "guided" mode).
 * A pure function of video time, so every frame can be drawn on its own (deterministic rendering).
 * Simulated time is slowed down; the slow-motion factor is shown on screen.
 */

export type RunKey = "baseline" | "intervention";

export interface StoryFrame {
  run: RunKey;
  simT: number; // ms of simulated time
  view: number; // 0 = whole fly, 1 = inside the head
  stimOn: boolean;
  orbit: number; // extra camera yaw (rad)
  title?: string;
  caption: string;
  sub?: string;
  card?: "title" | "end";
  hud: boolean;
  slowmo?: number;
}

export const SIM_MS = 1000;
export const SLOWMO = 20; // 1 s simulated -> 20 s of video
const RUN_S = (SIM_MS / 1000) * SLOWMO;

interface Seg {
  dur: number;
  frame: (k: number) => StoryFrame; // k in [0, 1)
}

const ease = (k: number) => k * k * (3 - 2 * k);

function runSegment(run: RunKey): Seg {
  return {
    dur: RUN_S,
    frame: (k) => {
      const simT = k * SIM_MS;
      const caption =
        run === "baseline"
          ? simT < 150
            ? "Each flash is one simulated spike. Activity starts at the sugar-taste neurons (blue) in the lower brain."
            : simT < 500
              ? "Spikes spread from the taste neurons to the neurons they connect to, and onwards."
              : "MN9 (pink), a motor neuron that lifts the proboscis, fires about 65 times per second."
          : simT < 400
            ? "Same sugar input, same random seeds, but the two Roundup neurons (grey) are silenced."
            : "MN9 now fires about 25 times per second: 62% less than before.";
      return { run, simT, view: 1, stimOn: true, orbit: 0.35 * Math.sin(k * Math.PI), caption, hud: true, slowmo: SLOWMO };
    },
  };
}

const SEGMENTS: Seg[] = [
  {
    dur: 5,
    frame: (k) => ({ run: "baseline", simT: 0, view: 0, stimOn: false, orbit: -0.5 + 0.5 * ease(k), card: "title", caption: "", hud: false }),
  },
  {
    dur: 5,
    frame: () => ({
      run: "baseline",
      simT: 0,
      view: 0,
      stimOn: true,
      orbit: 0,
      caption: "In a computer model of the fly brain, we switch on 21 sugar-taste neurons: a stand-in for the fly touching sugar.",
      sub: "Model: Shiu et al. 2024, built from the FlyWire wiring map (127,400 neurons).",
      hud: true,
    }),
  },
  {
    dur: 3,
    frame: (k) => ({ run: "baseline", simT: 0, view: ease(k), stimOn: true, orbit: 0, caption: "Let's look inside the head.", hud: true }),
  },
  runSegment("baseline"),
  {
    dur: 4,
    frame: (k) => ({
      run: "baseline",
      simT: SIM_MS,
      view: 1 - ease(Math.min(1, k * 1.4)),
      stimOn: true,
      orbit: 0,
      caption: "The proboscis extends, driven by MN9's firing (the size of the movement is our display choice).",
      hud: true,
    }),
  },
  {
    dur: 4,
    frame: () => ({
      run: "intervention",
      simT: 0,
      view: 0,
      stimOn: true,
      orbit: 0,
      caption: "What if we silence just two of the 127,400 neurons, a cell type called Roundup?",
      hud: true,
    }),
  },
  {
    dur: 3,
    frame: (k) => ({ run: "intervention", simT: 0, view: ease(k), stimOn: true, orbit: 0, caption: "Same experiment, run again.", hud: true }),
  },
  runSegment("intervention"),
  {
    dur: 4,
    frame: (k) => ({
      run: "intervention",
      simT: SIM_MS,
      view: 1 - ease(Math.min(1, k * 1.4)),
      stimOn: true,
      orbit: 0,
      caption: "With Roundup silenced, the proboscis barely moves.",
      hud: true,
    }),
  },
  {
    dur: 8,
    frame: () => ({ run: "intervention", simT: SIM_MS, view: 0, stimOn: false, orbit: 0, card: "end", caption: "", hud: false }),
  },
];

export const STORY_DURATION_S = SEGMENTS.reduce((a, s) => a + s.dur, 0);

export function storyAt(tSec: number): StoryFrame {
  let t = Math.max(0, tSec);
  for (const s of SEGMENTS) {
    if (t < s.dur) return s.frame(t / s.dur);
    t -= s.dur;
  }
  const last = SEGMENTS[SEGMENTS.length - 1];
  return last.frame(0.9999);
}
