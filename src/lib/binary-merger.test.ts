import { describe, expect, test } from "bun:test";
import {
  holesAt,
  MERGE_SEPARATION,
  MERGE_TIME,
  massAt,
  mergerStageAt,
  orbitalPhaseAt,
  PLUNGE_TIME,
  REMNANT_MASS,
  RINGDOWN_ANGULAR_FREQUENCY,
  RINGDOWN_DAMPING_TIME,
  SEQUENCE_END,
  START_SEPARATION,
  separationAt,
  waveAt,
} from "./binary-merger";
import { mergerDuration, mergerRate } from "./merger-playback";

describe("binary merger", () => {
  test("separation shrinks monotonically to the horizon contact", () => {
    expect(separationAt(0)).toBeCloseTo(START_SEPARATION, 9);
    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= MERGE_TIME; t += MERGE_TIME / 200) {
      const a = separationAt(t);
      expect(a).toBeLessThan(previous);
      previous = a;
    }
    expect(separationAt(MERGE_TIME)).toBeCloseTo(MERGE_SEPARATION, 6);
  });

  test("Peters law: da/dt = -(64/5) m1 m2 M / a^3", () => {
    const t = 300;
    const dt = 1e-3;
    const rate = (separationAt(t + dt) - separationAt(t - dt)) / (2 * dt);
    const a = separationAt(t);
    expect(rate).toBeCloseTo((-(64 / 5) * 0.25) / a ** 3, 6);
  });

  test("orbital phase advances at the Kepler frequency", () => {
    const t = 400;
    const dt = 1e-3;
    const omega = (orbitalPhaseAt(t + dt) - orbitalPhaseAt(t - dt)) / (2 * dt);
    expect(omega).toBeCloseTo(Math.sqrt(1 / separationAt(t) ** 3), 6);
    // About four and a half visible orbits before the horizons meet.
    const orbits = orbitalPhaseAt(MERGE_TIME) / (2 * Math.PI);
    expect(orbits).toBeGreaterThan(4);
    expect(orbits).toBeLessThan(6);
  });

  test("the wave chirps, peaks at merger and rings down", () => {
    expect(waveAt(400).amplitude).toBeGreaterThan(waveAt(100).amplitude);
    expect(waveAt(400).angularFrequency).toBeGreaterThan(
      waveAt(100).angularFrequency
    );
    const peak = waveAt(MERGE_TIME + 1).amplitude;
    expect(peak).toBeGreaterThan(waveAt(MERGE_TIME - 5).amplitude);
    const settled = waveAt(MERGE_TIME + 6).amplitude;
    const later = waveAt(MERGE_TIME + 6 + RINGDOWN_DAMPING_TIME).amplitude;
    expect(later / settled).toBeCloseTo(Math.exp(-1), 2);
    expect(waveAt(SEQUENCE_END).angularFrequency).toBeCloseTo(
      RINGDOWN_ANGULAR_FREQUENCY,
      6
    );
  });

  test("wave phase and frequency are continuous through the merger", () => {
    const before = waveAt(MERGE_TIME - 1e-6);
    const after = waveAt(MERGE_TIME + 1e-6);
    expect(after.phase).toBeCloseTo(before.phase, 4);
    expect(after.angularFrequency).toBeCloseTo(before.angularFrequency, 4);
    expect(after.amplitude).toBeCloseTo(before.amplitude, 4);
  });

  test("remnant QNM matches the Kerr fit for spin 0.686", () => {
    // M ω ≈ 0.53 and quality ≈ 3.2 for the l = m = 2 mode (Berti et al.).
    expect(RINGDOWN_ANGULAR_FREQUENCY * REMNANT_MASS).toBeCloseTo(0.529, 2);
    expect(
      (RINGDOWN_ANGULAR_FREQUENCY * RINGDOWN_DAMPING_TIME) / 2
    ).toBeCloseTo(3.23, 1);
  });

  test("holes orbit the centre of mass and fall into one remnant", () => {
    const { positions } = holesAt(200);
    const [a = [0, 0, 0], b = [0, 0, 0]] = positions;
    expect(a[0] + b[0]).toBeCloseTo(0, 9);
    expect(a[2] + b[2]).toBeCloseTo(0, 9);
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeCloseTo(
      separationAt(200),
      9
    );
    const end = holesAt(MERGE_TIME + PLUNGE_TIME);
    expect(end.merged).toBe(true);
    expect(Math.hypot(...(end.positions[0] ?? [1, 1, 1]))).toBeCloseTo(0, 9);
    expect(massAt(SEQUENCE_END)).toBeCloseTo(REMNANT_MASS, 3);
  });

  test("stages follow the sequence", () => {
    expect(mergerStageAt(0)).toBe("inspiral");
    expect(mergerStageAt(MERGE_TIME - 1)).toBe("plunge");
    expect(mergerStageAt(MERGE_TIME + PLUNGE_TIME + 1)).toBe("ringdown");
    expect(mergerStageAt(SEQUENCE_END)).toBe("settled");
  });

  test("playback slows into the merger and lasts under half a minute", () => {
    expect(mergerRate(0)).toBeGreaterThan(mergerRate(MERGE_TIME - 1));
    const seconds = mergerDuration();
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(30);
  });
});
