import { expect, test } from "bun:test";
import { captureOrbit, orbitalState } from "./gravity-orbits";

test("bound orbits conserve area rate and accelerate at periapsis", () => {
  const eccentricity = 0.22;
  for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
    const { x, y, vx, vy } = orbitalState(phase, eccentricity);
    expect(x * vy - y * vx).toBeCloseTo(Math.sqrt(1 - eccentricity ** 2), 8);
    expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(1 - eccentricity);
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + eccentricity);
  }
  const near = orbitalState(0);
  const far = orbitalState(Math.PI);
  expect(Math.hypot(near.vx, near.vy)).toBeGreaterThan(
    Math.hypot(far.vx, far.vy)
  );
});

test("an orbit closes continuously instead of fading or resetting position", () => {
  const before = orbitalState(Math.PI * 2 - 0.000_01);
  const after = orbitalState(Math.PI * 2 + 0.000_01);
  expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(
    0.0001
  );
  expect(orbitalState(0)).toEqual(orbitalState(Math.PI * 2 * 20));
});

test("capture starts at the original element and joins with the orbit's velocity", () => {
  const start = { x: 400, y: 900 };
  const end = { x: 600, y: 550 };
  const velocity = { x: -40, y: 12 };
  expect(captureOrbit(start, end, velocity, 0)).toEqual(start);
  expect(captureOrbit(start, end, velocity, 7)).toEqual(end);
  const before = captureOrbit(start, end, velocity, 7 - 0.000_01);
  expect((end.x - before.x) / 0.000_01).toBeCloseTo(velocity.x, 2);
  expect((end.y - before.y) / 0.000_01).toBeCloseTo(velocity.y, 2);
});
