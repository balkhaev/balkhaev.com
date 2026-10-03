import { expect, test } from "bun:test";
import { createObserverLook, guidedLookAt } from "./observer-look";

test("the default inward gaze stays fixed while the route advances or holds", () => {
  const look = createObserverLook();
  const inward = { pitch: 0, yaw: 0 };
  expect(guidedLookAt()).toEqual(inward);
  // Orientation receives elapsed time only: depth navigation cannot turn it.
  for (const seconds of [0, 0.016, 0.1, 2, 30, 0, 60]) {
    expect(look.advance(seconds)).toEqual(inward);
  }
  expect(look.advance(0, true)).toEqual(inward);
});

test("manual takeover keeps the visible direction until the user explicitly recenters", () => {
  const look = createObserverLook();
  const before = look.advance(0);
  look.turn(6, 3);
  expect(look.guided).toBe(false);
  expect(look.advance(0)).toEqual(before);
  const after = look.advance(2);
  expect(after.yaw).toBeCloseTo(6, 6);
  expect(after.pitch).toBeCloseTo(3, 6);
  for (const seconds of [0, 0.016, 5, 60]) {
    const held = look.advance(seconds);
    expect(held.yaw).toBeCloseTo(6, 6);
    expect(held.pitch).toBeCloseTo(3, 6);
  }
});

test("explicit inward recenter takes the short turn and levels pitch", () => {
  const look = createObserverLook();
  look.turn(355, 20, true);
  look.setGuided(true);
  expect(look.guided).toBe(true);
  expect(look.advance(0)).toEqual({ pitch: 20, yaw: 355 });
  const halfway = look.advance(0.1);
  expect(halfway.yaw).toBeGreaterThan(355);
  expect(halfway.yaw).toBeLessThan(360);
  expect(halfway.pitch).toBeGreaterThan(0);
  expect(halfway.pitch).toBeLessThan(20);
  const centered = look.advance(10);
  expect(centered.yaw).toBeCloseTo(360, 10);
  expect(centered.pitch).toBeCloseTo(0, 10);
});

test("disabling inward recenter holds its current visible orientation", () => {
  const look = createObserverLook();
  look.turn(80, -25, true);
  look.setGuided(true);
  const halfway = look.advance(0.1);
  look.setGuided(false);
  expect(look.advance(60)).toEqual(halfway);
});

test("recenter damping agrees at different frame rates", () => {
  const fast = createObserverLook();
  const slow = createObserverLook();
  for (const look of [fast, slow]) {
    look.turn(120, 30, true);
    look.setGuided(true);
  }
  let a = fast.advance(0);
  let b = slow.advance(0);
  for (let step = 0; step < 60; step += 1) {
    a = fast.advance(1 / 60);
  }
  for (let step = 0; step < 30; step += 1) {
    b = slow.advance(1 / 30);
  }
  expect(a.yaw).toBeCloseTo(b.yaw, 8);
  expect(a.pitch).toBeCloseTo(b.pitch, 8);
});
