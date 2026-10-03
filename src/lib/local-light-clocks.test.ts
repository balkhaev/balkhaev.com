import { expect, test } from "bun:test";
import {
  createLocalLightClocks,
  LOCAL_CLOCK_PERIOD_SECONDS,
  skyRimAngle,
} from "./local-light-clocks";

test("the local comparison separates unshifted, blueshifted and rearward rhythms", () => {
  const clocks = createLocalLightClocks();
  const angle = Math.acos(0.5);
  const frame = clocks.advance(LOCAL_CLOCK_PERIOD_SECONDS, 1, angle);
  expect(frame.local).toEqual({ phase: 0, rate: 1, ticks: 1 });
  expect(frame.forward.rate).toBeCloseTo(2, 12);
  expect(frame.forward.ticks + frame.forward.phase).toBeCloseTo(2, 12);
  expect(frame.rear).toEqual({ phase: 0.5, rate: 0.5, ticks: 0 });
});

test("depth and gaze change the illustrated rates without rescaling accumulated phase", () => {
  const clocks = createLocalLightClocks();
  const before = clocks.advance(1.3, 1, Math.acos(0.5));
  const after = clocks.advance(0, 0.02, Math.acos(Math.sqrt(0.02) - 0.01));
  for (const name of ["local", "rim", "forward", "rear"] as const) {
    expect(after[name].phase).toBe(before[name].phase);
    expect(after[name].ticks).toBe(before[name].ticks);
  }
  expect(after.forward.rate).toBeCloseTo(2 / Math.sqrt(0.02), 10);
  expect(after.rear.rate).toBeLessThan(before.rear.rate ?? 1);
  const advanced = clocks.advance(
    0.01,
    0.02,
    Math.acos(Math.sqrt(0.02) - 0.01)
  );
  expect(
    advanced.forward.ticks +
      advanced.forward.phase -
      (after.forward.ticks + after.forward.phase)
  ).toBeCloseTo(
    (0.01 * (after.forward.rate ?? 0)) / LOCAL_CLOCK_PERIOD_SECONDS,
    12
  );
});

test("a captured central direction freezes its phase while local and rear clocks continue", () => {
  const clocks = createLocalLightClocks();
  const before = clocks.advance(1, 1, Math.acos(0.5));
  const captured = clocks.advance(4, 0.25, 0);
  expect(captured.forward.rate).toBeNull();
  expect(captured.forward.phase).toBe(before.forward.phase);
  expect(captured.forward.ticks).toBe(before.forward.ticks);
  expect(captured.local.phase).toBeGreaterThan(before.local.phase);
  expect(captured.rear.phase).toBeGreaterThan(before.rear.phase);
  const visible = clocks.advance(0, 0.25, Math.PI / 2);
  expect(visible.forward.phase).toBe(before.forward.phase);
  expect(visible.forward.rate).toBeCloseTo(1, 12);
});

test("clock integration agrees across frame rates without clipping the physical rate", () => {
  const fast = createLocalLightClocks();
  const slow = createLocalLightClocks();
  const angle = Math.acos(Math.sqrt(0.02) - 0.01);
  let a = fast.advance(0, 0.02, angle);
  let b = slow.advance(0, 0.02, angle);
  for (let i = 0; i < 1440; i += 1) {
    a = fast.advance(1 / 144, 0.02, angle);
  }
  for (let i = 0; i < 300; i += 1) {
    b = slow.advance(1 / 30, 0.02, angle);
  }
  for (const name of ["local", "rim", "forward", "rear"] as const) {
    expect(a[name].phase).toBeCloseTo(b[name].phase, 10);
    expect(a[name].ticks).toBe(b[name].ticks);
  }
  expect(a.forward.rate).toBeGreaterThan(14);
  expect(a.forward.ticks).toBe(17);
});

test("invalid elapsed intervals preserve phase but still refresh the selected geometry", () => {
  const clocks = createLocalLightClocks();
  const before = clocks.advance(1.7, 1, Math.PI / 2);
  for (const elapsed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const after = clocks.advance(elapsed, 0.02, Math.PI);
    for (const name of ["local", "rim", "forward", "rear"] as const) {
      expect(after[name].phase).toBe(before[name].phase);
      expect(after[name].ticks).toBe(before[name].ticks);
    }
    expect(after.forward.rate).toBeCloseTo(1 / (1 + Math.sqrt(50)), 12);
  }
});

test("radial gaze retains a separate exterior rim comparison continuous through the horizon", () => {
  for (const radius of [12.5, 3, 1.001, 1, 0.999, 0.25, 0.02]) {
    const clocks = createLocalLightClocks();
    const frame = clocks.advance(LOCAL_CLOCK_PERIOD_SECONDS, radius, 0);
    expect(frame.forward.rate).toBeNull();
    const expected =
      1 / (1 - Math.cos(skyRimAngle(radius)) / Math.sqrt(radius));
    expect(frame.rim.rate).toBeCloseTo(expected, 12);
    expect(frame.rim.ticks + frame.rim.phase).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(1);
  }
  const clocks = createLocalLightClocks();
  const before = clocks.advance(1, 1.000_01, 0);
  const after = clocks.advance(0, 0.999_99, 0);
  expect(after.rim.phase).toBe(before.rim.phase);
  expect(after.rim.ticks).toBe(before.rim.ticks);
  expect(Math.abs((after.rim.rate ?? 0) - (before.rim.rate ?? 0))).toBeLessThan(
    0.0001
  );
});
