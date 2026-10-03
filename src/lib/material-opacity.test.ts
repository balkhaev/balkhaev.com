import { expect, test } from "bun:test";
import {
  emitterIncidence,
  MATERIAL_GRAZING_RATIO,
  materialOpacity,
} from "./material-opacity";
import { PLUNGE_KICK, plungeVelocity } from "./plunging-flow";

test("the normal incidence agrees with an independent full Lorentz boost into the plunging emitter frame", () => {
  const directions = [
    [0.95, 0.12, 0.27],
    [-0.95, -0.12, 0.27],
    [0.2, 0.93, -0.31],
    [-0.2, -0.93, -0.31],
    [0.0, 0.0, 1.0],
    [0.7, 0.7, 0.000_001],
  ];
  for (const r of [3, 2.4, 1.001, 1, 0.999, 0.4, 0.08, 0.02]) {
    for (const spin of [-1, 1]) {
      const fluid = plungeVelocity(r, spin);
      // Orthonormal PG rain coordinates: radial, azimuthal, disk normal.
      const velocity = [
        fluid.radial / fluid.time + 1 / Math.sqrt(r),
        (r * fluid.angular) / fluid.time,
        0,
      ];
      const betaSquared = velocity.reduce((sum, value) => sum + value ** 2, 0);
      const gamma = 1 / Math.sqrt(1 - betaSquared);
      for (const direction of directions) {
        const length = Math.hypot(...direction);
        const n = direction.map((value) => value / length);
        const dot = velocity.reduce(
          (sum, value, i) => sum + value * (n[i] ?? 0),
          0
        );
        const frequency = gamma * (1 - dot);
        const photon = n.map(
          (value, i) =>
            value +
            (((gamma - 1) * dot) / betaSquared - gamma) * (velocity[i] ?? 0)
        );
        expect(Math.hypot(...photon)).toBeCloseTo(frequency, 7);
        const expected = Math.abs(photon[2] ?? 0) / frequency;
        const angular = r * Math.hypot(n[1] ?? 0, n[2] ?? 0);
        const lambda = -r * (n[1] ?? 0);
        const actual = emitterIncidence(r, angular, lambda, 1 / frequency);
        expect(actual).toBeCloseTo(expected, 7);
        expect(actual).toBeGreaterThanOrEqual(0);
        expect(actual).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("finite slab opacity increases with proper column and grazing incidence without a divergent edge", () => {
  for (const cosine of [0, 0.000_001, 0.03, 0.1, 0.5, 1]) {
    let previous = -1;
    for (const depth of [0, 0.001, 0.01, 0.1, 0.9, 10, 1000]) {
      const alpha = materialOpacity(depth, cosine);
      expect(Number.isFinite(alpha)).toBe(true);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      expect(alpha).toBeGreaterThanOrEqual(previous);
      previous = alpha;
    }
  }
  for (const depth of [0.001, 0.01, 0.1, 0.9]) {
    let previous = 2;
    for (const cosine of [0, 0.03, 0.1, 0.5, 1]) {
      const alpha = materialOpacity(depth, cosine);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
    expect(materialOpacity(depth, 0)).toBeCloseTo(
      1 - Math.exp(-depth / MATERIAL_GRAZING_RATIO),
      12
    );
  }
});

test("advected column and slab attenuation stay continuous through the horizon", () => {
  function absorption(r: number) {
    const fluid = plungeVelocity(r);
    const nr = -0.4;
    const nphi = 0.7;
    const normal = Math.sqrt(1 - nr ** 2 - nphi ** 2);
    const frequency =
      fluid.time *
      (1 -
        (fluid.radial / fluid.time + 1 / Math.sqrt(r)) * nr -
        ((r * fluid.angular) / fluid.time) * nphi);
    const incidence = emitterIncidence(
      r,
      r * Math.hypot(nphi, normal),
      -r * nphi,
      1 / frequency
    );
    const column = (3 * PLUNGE_KICK) / (-r * fluid.radial);
    return materialOpacity(0.9 * column, incidence);
  }
  expect(absorption(1)).toBeGreaterThan(0);
  expect(Math.abs(absorption(1.000_001) - absorption(0.999_999))).toBeLessThan(
    0.000_001
  );
  for (const r of [3, 1.01, 1, 0.99, 0.5, 0.1, 0.02]) {
    expect(Number.isFinite(absorption(r))).toBe(true);
    expect(absorption(r)).toBeGreaterThan(0);
    expect(absorption(r)).toBeLessThan(1);
  }
});

test("the ISCO feed shares the initial column and the small kick bounds its inherited incidence seam", () => {
  const r = 3;
  const plunge = plungeVelocity(r);
  const column = (3 * PLUNGE_KICK) / (-r * plunge.radial);
  expect(column).toBeCloseTo(1, 11);
  for (const azimuth of [-0.75, -0.3, 0.3, 0.75]) {
    for (const radial of [-0.5, 0.5]) {
      const normal = Math.sqrt(1 - radial ** 2 - azimuth ** 2);
      const angular = r * Math.hypot(azimuth, normal);
      const lambda = -r * azimuth;
      const circularTime = 1 / Math.sqrt(1 - 1.5 / r);
      const circularAngular = Math.sqrt(0.5 / r ** 3) * circularTime;
      const circularFrequency =
        circularTime * (1 - radial / Math.sqrt(r)) -
        r * circularAngular * azimuth;
      const plungeFrequency =
        plunge.time *
        (1 -
          (plunge.radial / plunge.time + 1 / Math.sqrt(r)) * radial -
          ((r * plunge.angular) / plunge.time) * azimuth);
      const feedIncidence = emitterIncidence(
        r,
        angular,
        lambda,
        1 / circularFrequency
      );
      const plungeIncidence = emitterIncidence(
        r,
        angular,
        lambda,
        1 / plungeFrequency
      );
      for (const density of [0.05, 0.2, 1, 2]) {
        const feedAlpha = materialOpacity(0.9 * density, feedIncidence);
        const plungeAlpha = materialOpacity(
          0.9 * density * column,
          plungeIncidence
        );
        expect(Math.abs(feedAlpha - plungeAlpha) / feedAlpha).toBeLessThan(
          0.06
        );
      }
    }
  }
});
