import { expect, test } from "bun:test";
import {
  createStellarOrbit,
  STAR_APOAPSIS,
  STAR_PERIAPSIS,
  STAR_RADIUS,
  stellarState,
} from "./stellar-orbit";

const orbit = createStellarOrbit();

test("eccentric geodesic conserves independent Schwarzschild energy and angular momentum", () => {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = 0;
  const energies: number[] = [];
  const momenta: number[] = [];
  for (let k = 0; k <= 1000; k += 1) {
    const state = stellarState(orbit, (k * orbit.period) / 1000 - orbit.offset);
    const lapse = 1 - 1 / state.radius;
    const properRate = Math.sqrt(
      lapse - state.radial ** 2 / lapse - (state.radius * state.angular) ** 2
    );
    energies.push(lapse / properRate);
    momenta.push((state.radius ** 2 * state.angular) / properRate);
    minimum = Math.min(minimum, state.radius);
    maximum = Math.max(maximum, state.radius);
  }
  expect(Math.max(...energies) - Math.min(...energies)).toBeLessThan(0.000_002);
  expect(Math.max(...momenta) - Math.min(...momenta)).toBeLessThan(0.000_05);
  expect(minimum).toBeCloseTo(STAR_PERIAPSIS, 5);
  expect(maximum).toBeCloseTo(STAR_APOAPSIS, 5);
  expect(minimum - STAR_RADIUS).toBeGreaterThan(11);
});

test("inbound star accelerates and the precessing orbit has no loop seam", () => {
  const start = stellarState(orbit, 0);
  const closest = stellarState(orbit, orbit.period - orbit.offset);
  expect(start.radial).toBeLessThan(0);
  expect(Math.hypot(closest.vx, closest.vz)).toBeGreaterThan(
    Math.hypot(start.vx, start.vz)
  );
  expect(orbit.advance).toBeGreaterThan(2 * Math.PI);
  const before = stellarState(orbit, orbit.period - orbit.offset - 0.001);
  const after = stellarState(orbit, orbit.period - orbit.offset + 0.001);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(
    0.001
  );
  expect(Math.hypot(after.vx - before.vx, after.vz - before.vz)).toBeLessThan(
    0.0001
  );
});
