import { describe, expect, it } from "vitest";
import { footOffset, GAIT, GaitClock, PHASE_OFFSET, stepFrequency } from "./gait";

describe("tripod gait (APP animation)", () => {
  it("alternates two tripods half a cycle apart", () => {
    expect(PHASE_OFFSET.L1).toBe(PHASE_OFFSET.R2);
    expect(PHASE_OFFSET.L1).toBe(PHASE_OFFSET.L3);
    expect(PHASE_OFFSET.R1).toBe(PHASE_OFFSET.L2);
    expect(PHASE_OFFSET.R1 - PHASE_OFFSET.L1).toBe(0.5);
  });

  it("keeps the foot on the ground during stance and lifts it during swing", () => {
    for (let p = 0; p < GAIT.DUTY; p += 0.05) expect(footOffset(p, 0.5).dy).toBe(0);
    expect(footOffset(GAIT.DUTY + (1 - GAIT.DUTY) / 2, 0.5).dy).toBeGreaterThan(0);
  });

  it("is continuous over a cycle and spans one stride", () => {
    const s = 0.4;
    expect(footOffset(0, s).dz).toBeCloseTo(s / 2);
    expect(footOffset(GAIT.DUTY - 1e-9, s).dz).toBeCloseTo(-s / 2);
    expect(footOffset(1 - 1e-9, s).dz).toBeCloseTo(s / 2);
  });

  it("steps faster when walking faster and not at all when stopped", () => {
    expect(stepFrequency(0)).toBe(0);
    expect(stepFrequency(4)).toBeGreaterThan(stepFrequency(2));
  });

  it("stride times frequency equals body speed while walking", () => {
    const g = new GaitClock();
    g.advance(0.01, 3);
    expect(g.stride * stepFrequency(3)).toBeCloseTo(3);
  });
});
