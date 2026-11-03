import { describe, expect, it } from "vitest";
import { simulateLif } from "./LifNeuron";

describe("single-neuron LIF widget", () => {
  it("stays at rest without input", () => {
    const s = simulateLif(0, 25);
    expect(s.spikes.length).toBe(0);
    expect(s.v[s.v.length - 1]).toBeCloseTo(-52, 5);
  });

  it("one weak input does not reach threshold; many strong inputs make it fire", () => {
    expect(simulateLif(10, 1).spikes.length).toBe(0);
    expect(simulateLif(300, 40).spikes.length).toBeGreaterThan(5);
  });

  it("never fires twice within the 2.2 ms refractory period", () => {
    const s = simulateLif(400, 60);
    for (let k = 1; k < s.spikes.length; k++) expect(s.spikes[k] - s.spikes[k - 1]).toBeGreaterThanOrEqual(2.2 - 1e-9);
  });

  it("is reproducible for a fixed seed", () => {
    expect(simulateLif(150, 25).spikes).toEqual(simulateLif(150, 25).spikes);
  });
});
