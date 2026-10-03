import { expect, test } from "bun:test";
import { END_RADIUS, START_RADIUS } from "./flight";
import { CRITICAL_B } from "./geodesics";
import { shadowAngle } from "./infall-geodesics";
import { relativityAt, skyShiftAt } from "./relativity";

test("rain-frame frequency shifts agree with independent static gravity and Lorentz boosts", () => {
  let escapedSamples = 0;
  for (const radius of [START_RADIUS, 5, 3, 1.5, 1.1, 1.0001]) {
    const lapse = Math.sqrt(1 - 1 / radius);
    const beta = Math.sqrt(1 / radius);
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    for (const staticCosine of [-1, -0.8, -0.4, 0, 0.4, 0.8]) {
      // Aberrate an independently selected static-frame photon direction into
      // the rain frame, then compose its gravitational and SR frequency shifts.
      const rainCosine = (staticCosine + beta) / (1 + beta * staticCosine);
      const angle = Math.acos(Math.max(-1, Math.min(1, rainCosine)));
      const observed = skyShiftAt(radius, angle);
      if (observed === null) {
        continue;
      }
      escapedSamples += 1;
      const gravitationalShift = 1 / lapse;
      const dopplerShift = gamma * (1 + beta * staticCosine);
      expect(observed).toBeCloseTo(gravitationalShift * dopplerShift, 7);
    }
  }
  expect(escapedSamples).toBeGreaterThan(20);
});

test("directional shifts equal the apparent tick rate of distant clocks", () => {
  for (const radius of [START_RADIUS, 2, 1, 0.25, END_RADIUS]) {
    const rear = skyShiftAt(radius, Math.PI);
    expect(rear).not.toBeNull();
    // Along the rain worldline, radial incoming null rays have
    // dT_emit/dtau = 1 / (1 + sqrt(1/r)); the PG rain clock has dT/dtau = 1.
    const drDtau = -Math.sqrt(1 / radius);
    const incomingLightDtDr = -1 / (1 + Math.sqrt(1 / radius));
    const emittedTicksPerLocalTick = 1 - incomingLightDtDr * drDtau;
    expect(rear).toBeCloseTo(emittedTicksPerLocalTick, 12);
    const localPeriod = 2 / (rear ?? 1);
    expect(2 / localPeriod).toBeCloseTo(rear ?? 0, 12);
    expect(skyShiftAt(radius, Math.PI / 2)).toBeCloseTo(1, 12);
  }
});

test("captured and nonpositive-energy directions never acquire a distant clock", () => {
  for (const radius of [START_RADIUS, 1.5, 1, 0.25, END_RADIUS]) {
    const boundary = shadowAngle(radius);
    expect(skyShiftAt(radius, 0)).toBeNull();
    expect(skyShiftAt(radius, boundary)).toBeNull();
    expect(skyShiftAt(radius, boundary - 1e-7)).toBeNull();
    expect(skyShiftAt(radius, boundary + 1e-7)).toBeGreaterThan(0);
    expect(relativityAt(radius).shadowAngle).toBe(boundary);
  }
  for (const radius of [0.9, 0.25, END_RADIUS]) {
    const energyBoundary = Math.acos(Math.sqrt(radius));
    expect(skyShiftAt(radius, energyBoundary - 1e-7)).toBeNull();
  }
  for (const angle of [Number.NaN, Number.POSITIVE_INFINITY, -1, Math.PI + 1]) {
    expect(skyShiftAt(2, angle)).toBeNull();
  }
});

test("the escape boundary matches the critical null orbit impact parameter", () => {
  for (const radius of [START_RADIUS, 3, 1.5, 1, 0.25, END_RADIUS]) {
    const angle = relativityAt(radius).shadowAngle;
    const angularMomentum = radius * Math.sin(angle);
    const killingEnergy = 1 - Math.sqrt(1 / radius) * Math.cos(angle);
    expect(angularMomentum / killingEnergy).toBeCloseTo(CRITICAL_B, 9);
  }
});

test("local rain-frame metrics remain regular through the horizon without assigning a static interior speed", () => {
  const outside = relativityAt(1 + 1e-7, Math.PI / 2);
  const horizon = relativityAt(1, Math.PI / 2);
  const inside = relativityAt(1 - 1e-7, Math.PI / 2);
  expect(outside.staticSpeed).toBeLessThan(1);
  expect(relativityAt(1 + Number.EPSILON).staticSpeed).toBeLessThan(1);
  expect(outside.staticLapse).toBeGreaterThan(0);
  expect(outside.insideHorizon).toBe(false);
  for (const frame of [horizon, inside, relativityAt(END_RADIUS)]) {
    expect(frame.staticSpeed).toBeNull();
    expect(frame.staticLapse).toBeNull();
    expect(frame.insideHorizon).toBe(true);
  }
  for (const key of ["forwardShift", "rearShift", "sideShift"] as const) {
    expect(outside[key]).toBeCloseTo(inside[key] ?? 0, 6);
    expect(horizon[key]).toBeCloseTo(inside[key] ?? 0, 6);
  }
  expect(outside.shadowAngle).toBeCloseTo(inside.shadowAngle, 6);
  expect(outside.tidalRatio).toBeCloseTo(inside.tidalRatio, 2);
});

test("static lapse is a stationary clock ratio and the tidal gradient scales with inverse radius cubed", () => {
  for (const radius of [START_RADIUS, 4, 2, 1.1]) {
    const frame = relativityAt(radius);
    const staticDt = 10;
    const properIntervalSquared = (1 - 1 / radius) * staticDt ** 2;
    expect((frame.staticLapse ?? 0) * staticDt).toBeCloseTo(
      Math.sqrt(properIntervalSquared),
      12
    );
  }
  const radialTidalGradient = (radius: number) => {
    const h = radius * 1e-5;
    const acceleration = (r: number) => -0.5 / r ** 2;
    return (acceleration(radius + h) - acceleration(radius - h)) / (2 * h);
  };
  for (const radius of [START_RADIUS, 3, 1, 0.25, END_RADIUS]) {
    const independentRatio =
      radialTidalGradient(radius) / radialTidalGradient(START_RADIUS);
    expect(relativityAt(radius).tidalRatio / independentRatio).toBeCloseTo(
      1,
      9
    );
  }
  expect(relativityAt(START_RADIUS).tidalRatio).toBe(1);
});

test("gaze samples the physical frame and readouts respect the model endpoint", () => {
  const radius = 0.25;
  const frame = relativityAt(radius, Math.PI * 0.6);
  expect(frame.forwardShift).toBe(skyShiftAt(radius, Math.PI * 0.6));
  expect(frame.rearShift).toBe(skyShiftAt(radius, Math.PI * 0.4));
  expect(frame.sideShift).toBe(skyShiftAt(radius, Math.PI / 2));
  expect(relativityAt(END_RADIUS / 2)).toEqual(relativityAt(END_RADIUS));
  for (const invalidRadius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(relativityAt(invalidRadius)).toEqual(relativityAt(START_RADIUS));
  }
});
