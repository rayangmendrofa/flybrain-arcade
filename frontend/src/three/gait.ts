// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
/**
 * APP: tripod-gait leg animation for the arena's hybrid demonstration.
 *
 * Nothing here comes from the brain model. The model's only influence on walking in the arena is
 * that the handcrafted controller stops the fly while the MN9-driven proboscis extension is high.
 * This module turns the controller's body speed into a leg-stepping pattern that resembles how
 * flies walk: two alternating tripods (front + hind leg of one side with the middle leg of the
 * other), with step frequency rising with speed (qualitatively as described for Drosophila by
 * Wosnitza et al. 2013, J Exp Biol 216:480; Mendes et al. 2013, eLife 2:e00231). The constants
 * are presentation choices, not fitted values.
 */

export type LegId = "L1" | "L2" | "L3" | "R1" | "R2" | "R3";
export const LEGS: LegId[] = ["L1", "L2", "L3", "R1", "R2", "R3"];

export const GAIT = {
  /** step frequency (Hz) = F0 + F1 * speed (body lengths / s) */
  F0: 1.5,
  F1: 1.4,
  /** fraction of each cycle a foot is on the ground */
  DUTY: 0.55,
  /** foot lift during swing, body lengths */
  LIFT: 0.045,
  /** below this speed the legs settle to rest */
  MIN_SPEED: 0.05,
} as const;

/** tripod A = L1, R2, L3 (phase 0); tripod B = R1, L2, R3 (phase 0.5) */
export const PHASE_OFFSET: Record<LegId, number> = { L1: 0, R2: 0, L3: 0, R1: 0.5, L2: 0.5, R3: 0.5 };

export function stepFrequency(speedBlS: number): number {
  return speedBlS < GAIT.MIN_SPEED ? 0 : GAIT.F0 + GAIT.F1 * speedBlS;
}

/** Foot offset relative to its rest position: dz (forward, body lengths) and dy (lift). */
export function footOffset(phase: number, stride: number): { dz: number; dy: number } {
  const p = ((phase % 1) + 1) % 1;
  if (p < GAIT.DUTY) {
    // stance: foot planted, moves backwards relative to the body
    const k = p / GAIT.DUTY;
    return { dz: stride * (0.5 - k), dy: 0 };
  }
  // swing: foot lifts and travels forwards
  const k = (p - GAIT.DUTY) / (1 - GAIT.DUTY);
  const s = k * k * (3 - 2 * k);
  return { dz: stride * (-0.5 + s), dy: GAIT.LIFT * Math.sin(Math.PI * k) * Math.min(1, stride * 8) };
}

/** Integrates the gait clock; feed it the controller speed every frame. */
export class GaitClock {
  phase = 0;
  stride = 0;

  /** dt in simulated seconds, speed in body lengths per simulated second */
  advance(dt: number, speedBlS: number): void {
    const f = stepFrequency(speedBlS);
    if (f > 0) {
      this.phase = (this.phase + f * dt) % 1;
      this.stride = speedBlS / f;
    } else {
      this.stride *= Math.exp(-dt / 0.08); // settle
    }
  }

  offsets(): Record<LegId, { dz: number; dy: number }> {
    const out = {} as Record<LegId, { dz: number; dy: number }>;
    for (const l of LEGS) out[l] = footOffset(this.phase + PHASE_OFFSET[l], this.stride);
    return out;
  }
}
