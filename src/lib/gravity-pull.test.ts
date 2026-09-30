import { expect, test } from "bun:test";

import { gravityPullAt } from "./gravity-pull";

test("attraction points toward the hole and has no singularity at its center", () => {
  expect(gravityPullAt(0, 0)).toEqual({ x: 0, y: 0 });
  const force = gravityPullAt(-120, 240);
  expect(force.x).toBeLessThan(0);
  expect(force.y).toBeGreaterThan(0);
  expect(force.y / force.x).toBeCloseTo(-2);
});

test("controls stay within eight pixels of their layout position at every distance", () => {
  for (let distance = 0; distance <= 4000; distance += 5) {
    const force = gravityPullAt(distance * 0.6, distance * 0.8);
    expect(Math.hypot(force.x, force.y)).toBeLessThan(8);
  }
  expect(gravityPullAt(2000, 0).x).toBeLessThan(1);
});
