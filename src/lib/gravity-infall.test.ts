import { expect, test } from "bun:test";

import { infallField, infallImage } from "./gravity-infall";

test("the lens stays finite at the center and within the displacement texture's range", () => {
  const source = { radius: 124, x: 720, y: 440 };
  expect(infallField(720, 440, source, 0)).toEqual({ x: 0, y: 0 });
  for (let i = 0; i < 300; i += 1) {
    const field = infallField(i * 7, i * 3, source, i / 9);
    expect(Math.hypot(field.x, field.y)).toBeLessThan(40);
  }
});

test("images keep approaching the horizon and reset only while invisible", () => {
  let previous = 600;
  for (let i = 0; i <= 100; i += 1) {
    const image = infallImage(i / 100, 600, 124);
    expect(image.distance).toBeLessThanOrEqual(previous);
    expect(image.scale).toBeGreaterThan(0);
    previous = image.distance;
  }
  expect(infallImage(0, 600, 124).opacity).toBe(0);
  expect(infallImage(1, 600, 124).opacity).toBeCloseTo(0);
  expect(previous).toBeLessThan(124);
});

test("the field follows a dragged source without depending on absolute screen coordinates", () => {
  const initial = infallField(200, 300, { radius: 80, x: 100, y: 120 }, 2);
  const moved = infallField(440, 400, { radius: 80, x: 340, y: 220 }, 2);
  expect(moved).toEqual(initial);
});
