import { expect, test } from "bun:test";
import { END_RADIUS } from "./flight";
import { createObserverLook, guidedLookAt } from "./observer-look";

test("directed gaze keeps the approach radial and reveals the peripheral interior sky", () => {
  expect(guidedLookAt(12.5)).toEqual({ pitch: 0, yaw: 0 });
  expect(guidedLookAt(3)).toEqual({ pitch: 0, yaw: 0 });
  expect(guidedLookAt(END_RADIUS).yaw).toBe(78);
  expect(
    Math.abs(guidedLookAt(1.000_01).yaw - guidedLookAt(0.999_99).yaw)
  ).toBeLessThan(0.001);
});

test("the imagined gaze continues smoothly while the physical radius holds", () => {
  const boundary = guidedLookAt(END_RADIUS);
  expect(guidedLookAt(END_RADIUS, 0)).toEqual(boundary);
  expect(guidedLookAt(END_RADIUS, 0.000_01).yaw - boundary.yaw).toBeLessThan(
    1e-9
  );
  expect(guidedLookAt(END_RADIUS, 1).yaw).toBe(100);
  expect(guidedLookAt(END_RADIUS, 1).pitch).toBeCloseTo(-4, 12);
  const look = createObserverLook();
  look.advance(END_RADIUS, 0, true, 0.8);
  look.turn(8, 2, true);
  const manual = look.advance(END_RADIUS, 0);
  expect(look.advance(END_RADIUS, 10, false, 1)).toEqual(manual);
});

test("manual takeover retains the visible direction and stays independent of flight", () => {
  const look = createObserverLook();
  const before = look.advance(0.15, 0, true);
  look.turn(6, 3);
  expect(look.guided).toBe(false);
  expect(look.advance(0.1, 0)).toEqual(before);
  const after = look.advance(0.02, 2);
  expect(after.yaw).toBeCloseTo(before.yaw + 6, 6);
  expect(after.pitch).toBeCloseTo(before.pitch + 3, 6);
});

test("look damping gives the same stationary target at different frame rates", () => {
  const fast = createObserverLook();
  const slow = createObserverLook();
  let a = fast.advance(0.05, 0);
  let b = slow.advance(0.05, 0);
  for (let step = 0; step < 60; step += 1) {
    a = fast.advance(0.05, 1 / 60);
  }
  for (let step = 0; step < 30; step += 1) {
    b = slow.advance(0.05, 1 / 30);
  }
  expect(a.yaw).toBeCloseTo(b.yaw, 8);
  expect(a.pitch).toBeCloseTo(b.pitch, 8);
});

test("returning to directed gaze takes the short turn after looking around", () => {
  const look = createObserverLook();
  look.turn(355, 0, true);
  look.setGuided(true);
  const halfway = look.advance(12.5, 0.1);
  expect(halfway.yaw).toBeGreaterThan(355);
  expect(halfway.yaw).toBeLessThan(360);
});
