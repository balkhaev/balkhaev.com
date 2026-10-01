import { expect, test } from "bun:test";
import {
  createPlungingFlow,
  PLUNGE_E,
  PLUNGE_KICK,
  PLUNGE_L,
  plungeShift,
  plungeVelocity,
  samplePlungingFlow,
} from "./plunging-flow";

test("plunging matter conserves Killing energy, angular momentum and timelike normalization across the horizon", () => {
  for (const r of [3, 2.4, 1.001, 1, 0.999, 0.4, 0.08, 0.02]) {
    for (const spin of [-1, 1]) {
      const v = plungeVelocity(r, spin);
      const flow = 1 / Math.sqrt(r);
      const norm =
        -(v.time ** 2) + (v.radial + flow * v.time) ** 2 + (r * v.angular) ** 2;
      expect(norm).toBeCloseTo(-1, 6);
      expect((1 - 1 / r) * v.time - flow * v.radial).toBeCloseTo(PLUNGE_E, 9);
      expect(r * r * v.angular).toBeCloseTo(-spin * PLUNGE_L, 10);
      expect(v.radial).toBeLessThan(0);
      expect(v.time).toBeGreaterThan(0);
      const speed = Math.hypot(
        v.radial / v.time + flow,
        (r * v.angular) / v.time
      );
      expect(speed).toBeLessThan(1);
    }
  }
  expect(-plungeVelocity(3).radial).toBeCloseTo(PLUNGE_KICK, 10);
  expect(
    Math.abs(plungeVelocity(1.000_01).time - plungeVelocity(0.999_99).time)
  ).toBeLessThan(0.0001);
});

function integrate(to: number) {
  const steps = 40_000;
  const h = (3 - to) / steps;
  const total = [0, 0, 0];
  for (let i = 0; i <= steps; i += 1) {
    const r = to + i * h;
    // Independent closed form of the ISCO radial first integral with the launch kick.
    const speed = Math.sqrt(PLUNGE_KICK ** 2 + (3 / r - 1) ** 3 / 9);
    const pgTime =
      (PLUNGE_E ** 2 + (1 + 3 / r ** 2) / r) /
      (PLUNGE_E + speed / Math.sqrt(r));
    const values = [pgTime / speed, Math.sqrt(3) / (r * r * speed), 1 / speed];
    const interiorWeight = i % 2 === 0 ? 2 : 4;
    const weight = i === 0 || i === steps ? 1 : interiorWeight;
    for (let axis = 0; axis < 3; axis += 1) {
      total[axis] = (total[axis] ?? 0) + ((values[axis] ?? 0) * weight * h) / 3;
    }
  }
  return total;
}

test("material winding and PG/proper ages match independent quadrature at interior and exterior radii", () => {
  const data = createPlungingFlow();
  expect(samplePlungingFlow(data, 3).slice(0, 3)).toEqual([0, 0, 0]);
  for (const r of [2.991, 2.6, 1, 0.7, 0.083, 0.02]) {
    const state = samplePlungingFlow(data, r);
    const expected = integrate(r);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs((state[axis] ?? 0) - (expected[axis] ?? 0))).toBeLessThan(
        0.0005
      );
    }
  }
});

test("the emitting frequency matches an independent Lorentz contraction in the local rain frame, including negative Killing energies", () => {
  for (const r of [3, 1.001, 1, 0.999, 0.2, 0.02]) {
    const v = plungeVelocity(r);
    for (const angle of [0.3, 1.4, 2.8]) {
      const localFrequency = 0.7;
      const nr = Math.cos(angle);
      const nphi = Math.sin(angle);
      const energy = localFrequency * (1 - nr / Math.sqrt(r));
      const angular = r * localFrequency * Math.sin(angle);
      const slope = (localFrequency * (nr - 1 / Math.sqrt(r))) / angular;
      const lambda = -r * localFrequency * nphi;
      const expected =
        localFrequency *
        v.time *
        (1 -
          (v.radial / v.time + 1 / Math.sqrt(r)) * nr -
          ((r * v.angular) / v.time) * nphi);
      expect(expected).toBeGreaterThan(0);
      expect(1 / plungeShift(r, angular, energy, slope, lambda)).toBeCloseTo(
        expected,
        6
      );
    }
  }
});

test("injection labels are advected on a single fluid worldline instead of rotating arbitrary screen particles", () => {
  const data = createPlungingFlow();
  for (const spin of [-1, 1]) {
    for (const r of [2.8, 1.5, 1, 0.4, 0.025]) {
      const step = r * 0.005;
      const before = samplePlungingFlow(data, r - step);
      const after = samplePlungingFlow(data, r + step);
      const ageDerivative = ((after[0] ?? 0) - (before[0] ?? 0)) / (2 * step);
      const windingDerivative =
        ((after[1] ?? 0) - (before[1] ?? 0)) / (2 * step);
      const v = plungeVelocity(r, spin);
      // Material derivatives vanish using the independently computed local four-velocity.
      expect(Math.abs(v.time - ageDerivative * v.radial) / v.time).toBeLessThan(
        0.005
      );
      expect(
        Math.abs(v.angular + spin * windingDerivative * v.radial) /
          Math.abs(v.angular)
      ).toBeLessThan(0.005);
      const column = (3 * PLUNGE_KICK) / (-r * plungeVelocity(r).radial);
      expect(-r * column * plungeVelocity(r).radial).toBeCloseTo(
        3 * PLUNGE_KICK,
        12
      );
    }
  }
});
