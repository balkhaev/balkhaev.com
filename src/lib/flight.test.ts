import { expect, test } from "bun:test";
import {
  createFlight,
  END_RADIUS,
  flightRadius,
  HORIZON_TIME,
  START_RADIUS,
} from "./flight";

test("radial worldline is timelike and crosses the horizon at finite proper time", () => {
  expect(flightRadius(HORIZON_TIME)).toBeCloseTo(1, 10);
  for (const tau of [0.1, HORIZON_TIME - 0.1, HORIZON_TIME + 0.1]) {
    const r = flightRadius(tau);
    const velocity =
      (flightRadius(tau + 1e-5) - flightRadius(tau - 1e-5)) / 2e-5;
    expect(velocity).toBeCloseTo(-1 / Math.sqrt(r), 7);
    expect(
      -(1 - 1 / r) + (2 * velocity) / Math.sqrt(r) + velocity ** 2
    ).toBeCloseTo(-1, 7);
  }
});

test("scroll can cross the horizon, reversing cannot escape, restart restores the disk approach", () => {
  const flight = createFlight();
  expect(flight.radius).toBe(START_RADIUS);
  flight.travel(3, true);
  expect(flight.radius).toBeLessThan(1);
  expect(flight.crossed).toBe(true);
  const inside = flight.radius;
  flight.travel(-100, true);
  expect(flight.radius).toBe(inside);
  flight.travel(100, true);
  expect(flight.radius).toBeCloseTo(END_RADIUS, 12);
  expect(flight.ended).toBe(true);
  flight.reset();
  expect(flight.radius).toBe(START_RADIUS);
  expect(flight.crossed).toBe(false);
  expect(flight.active).toBe(false);
});

test("manual reduced-motion travel is immediate and has no autonomous drift", () => {
  const flight = createFlight();
  flight.travel(1, true);
  const { radius } = flight;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.radius).toBe(radius);
});
