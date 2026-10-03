import { expect, test } from "bun:test";
import { END_RADIUS, HORIZON_PROGRESS, START_RADIUS } from "./flight";
import { shadowAngle } from "./infall-geodesics";
import { createObserverLook, guidedLookAt } from "./observer-look";
import { skyShiftAt } from "./relativity";

test("directed gaze keeps the approach radial and reveals the peripheral interior sky", () => {
  expect(guidedLookAt(12.5)).toEqual({ pitch: 0, yaw: 0 });
  expect(guidedLookAt(3)).toEqual({ pitch: 0, yaw: 0 });
  expect(guidedLookAt(END_RADIUS).yaw).toBeGreaterThan(82);
  expect(guidedLookAt(END_RADIUS).yaw).toBeLessThan(90);
  expect(
    Math.abs(guidedLookAt(1.000_01).yaw - guidedLookAt(0.999_99).yaw)
  ).toBeLessThan(0.001);
});

test("the guided interior sightline follows a growing but finite blueshift on an escaping ray", () => {
  let previousYaw = 0;
  let previousShift = 0;
  for (const radius of [1, 0.75, 0.5, 0.25, 0.1, 0.06, END_RADIUS]) {
    const gaze = guidedLookAt(radius);
    const angle = (gaze.yaw * Math.PI) / 180;
    expect(angle).toBeGreaterThan(shadowAngle(radius));
    const shift = skyShiftAt(radius, angle);
    expect(shift).toBeCloseTo(2 / Math.sqrt(radius), 10);
    expect(shift).toBeGreaterThan(previousShift);
    expect(gaze.pitch).toBe(0);
    expect(gaze.yaw).toBeGreaterThan(previousYaw);
    expect(gaze.yaw).toBeLessThan(90);
    previousYaw = gaze.yaw;
    previousShift = shift ?? 0;
  }
  expect(guidedLookAt(1).yaw).toBeCloseTo(60, 12);
  expect(guidedLookAt(END_RADIUS / 2)).toEqual(guidedLookAt(END_RADIUS));
});

test("the sky guide enters smoothly before the horizon and has no horizon jump", () => {
  const phaseAtStart = 1.65;
  const start = guidedLookAt(START_RADIUS * Math.exp(-phaseAtStart));
  const afterStart = guidedLookAt(
    START_RADIUS * Math.exp(-phaseAtStart - 1e-5)
  );
  expect(start.yaw).toBe(0);
  expect(afterStart.yaw - start.yaw).toBeLessThan(1e-9);
  const beforeHorizon = guidedLookAt(
    START_RADIUS * Math.exp(-HORIZON_PROGRESS + 1e-5)
  );
  const atHorizon = guidedLookAt(1);
  const afterHorizon = guidedLookAt(
    START_RADIUS * Math.exp(-HORIZON_PROGRESS - 1e-5)
  );
  expect(atHorizon.yaw - beforeHorizon.yaw).toBeLessThan(0.001);
  expect(afterHorizon.yaw - atHorizon.yaw).toBeLessThan(0.001);
  expect(atHorizon.yaw - beforeHorizon.yaw).toBeCloseTo(
    afterHorizon.yaw - atHorizon.yaw,
    6
  );
});

test("a held radius gives a fixed sightline target with no post-end decorative motion", () => {
  const look = createObserverLook();
  const endpoint = look.advance(END_RADIUS, 0, true);
  expect(look.advance(END_RADIUS, 10)).toEqual(endpoint);
  look.turn(8, 2, true);
  const manual = look.advance(END_RADIUS, 0);
  expect(look.advance(END_RADIUS, 10)).toEqual(manual);
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
