import { expect, test } from "bun:test";

import { lensingField } from "./gravity-infall";

test("the lens stays finite at the center and within the displacement texture's range", () => {
  const source = { radius: 124, x: 720, y: 440 };
  expect(lensingField(720, 440, source)).toEqual({ x: 0, y: 0 });
  for (let i = 0; i < 300; i += 1) {
    const field = lensingField(i * 7, i * 3, source);
    expect(Math.hypot(field.x, field.y)).toBeLessThanOrEqual(150);
  }
});

test("the field follows a dragged source without depending on absolute screen coordinates", () => {
  const initial = lensingField(200, 300, { radius: 80, x: 100, y: 120 });
  const moved = lensingField(440, 400, { radius: 80, x: 340, y: 220 });
  expect(moved).toEqual(initial);
});

test("the inverse map bends light inward without twisting or moving distant space", () => {
  const source = { radius: 100, x: 0, y: 0 };
  const near = lensingField(120, 90, source);
  expect(near.x).toBeLessThan(0);
  expect(near.y).toBeLessThan(0);
  expect(near.x * 90 - near.y * 120).toBeCloseTo(0);
  const far = lensingField(600, 100, source);
  expect(Math.hypot(far.x, far.y)).toBe(0);
});
