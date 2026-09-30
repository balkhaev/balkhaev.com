import { expect, test } from "bun:test";
import { orbitalState, orbitSpeed, projectOrbit } from "./gravity-orbits";

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

test("the far-side image is lifted over the shadow while the near side stays in the disk plane", () => {
  const eccentric = Math.acos(0.12);
  const phase = eccentric - 0.12 * Math.sin(eccentric);
  const back = projectOrbit(phase, 100, 0);
  const front = projectOrbit(-phase, 100, 0);
  expect(back.y).toBeLessThan(-100);
  expect(front.y).toBeGreaterThan(0);
  expect(front.y).toBeLessThan(50);
  expect(front.scale).toBeGreaterThan(1);
  expect(back.scale).toBeLessThan(1);
  expect(orbitSpeed(0) / orbitSpeed(1)).toBeCloseTo((4.15 / 3.25) ** 1.5, 8);
});

test("projection remains continuous through both disk crossings and the orbital seam", () => {
  for (let phase = -Math.PI; phase < Math.PI; phase += 0.01) {
    const a = projectOrbit(phase, 124, 0);
    const b = projectOrbit(phase + 0.0001, 124, 0);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.5);
  }
});
