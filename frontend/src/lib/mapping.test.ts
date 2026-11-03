// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { describe, expect, it } from "vitest";
import { extension, MAPPING, sampleAt, simTimeAt, smooth } from "./mapping";

describe("animation mapping (application-defined)", () => {
  it("smoothing is causal and converges to a step input", () => {
    const r = [0, 0, ...new Array(200).fill(80)];
    const s = smooth(r, 5);
    expect(s[0]).toBe(0);
    expect(s[1]).toBe(0);
    expect(s[2]).toBeCloseTo(80 * (1 - Math.exp(-5 / MAPPING.TAU_MS)), 10);
    // after ~one time constant (10 bins of 5 ms) about 63% of the step
    expect(s[11] / 80).toBeCloseTo(1 - Math.exp(-50 / 50), 2);
    expect(s[s.length - 1]).toBeCloseTo(80, 3);
  });

  it("extension is a clamped linear map between threshold and saturation", () => {
    expect(extension(0)).toBe(0);
    expect(extension(MAPPING.R_THRESHOLD)).toBe(0);
    expect(extension(MAPPING.R_SATURATION)).toBe(1);
    expect(extension(500)).toBe(1);
    expect(extension((MAPPING.R_THRESHOLD + MAPPING.R_SATURATION) / 2)).toBeCloseTo(0.5);
    expect(extension(Number.NaN)).toBe(0);
  });

  it("frame timing changes only which precomputed sample is shown", () => {
    const series = [1, 2, 3, 4];
    expect(sampleAt(series, 5, 0)).toBe(1);
    expect(sampleAt(series, 5, 7.4)).toBe(2);
    expect(sampleAt(series, 5, 1e9)).toBe(4);
    // 60 fps vs 13 fps sampling of the same playback reach identical values at identical sim times
    const at = (fps: number, wallMs: number) => sampleAt(series, 5, simTimeAt(Math.floor(wallMs / (1000 / fps)) * (1000 / fps), 0.25, 20, false));
    expect(at(60, 0)).toBe(at(13, 0));
  });

  it("playback clock separates simulated from wall-clock time", () => {
    expect(simTimeAt(4000, 0.25, 1000, false)).toBe(1000);
    expect(simTimeAt(8000, 0.25, 1000, false)).toBe(1000);
    expect(simTimeAt(5000, 0.25, 1000, true)).toBe(250);
  });
});
