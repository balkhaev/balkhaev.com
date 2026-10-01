import { expect, test } from "bun:test";
import {
  createFlight,
  END_RADIUS,
  EXIT_VELOCITY,
  flightRadius,
  HORIZON_TIME,
  journeyAt,
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

test("crossing is one-way and continued scroll reaches the white-hole exterior without a reset", () => {
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
  expect(flight.journey.stage).toBe("По ту сторону");
  const { clock, passage } = flight.journey;
  const [, , outwardDistance] = passage;
  flight.travel(-100, true);
  expect(flight.journey.clock).toBe(clock);
  expect(flight.journey.passage[2]).toBe(outwardDistance);
  flight.travel(1, true);
  expect(flight.journey.clock).toBeGreaterThan(clock);
  expect(flight.journey.passage[2]).toBeGreaterThan(outwardDistance ?? 0);
});

test("large scroll gestures still reveal each interior stage during animated travel", () => {
  const flight = createFlight();
  flight.travel(30);
  const stages = new Set<string>();
  for (let i = 0; i < 800; i += 1) {
    flight.advance(1 / 30);
    stages.add(flight.journey.stage);
  }
  expect([...stages]).toEqual([
    "Погружение",
    "За горизонтом событий",
    "Переход",
    "Белая дыра",
    "По ту сторону",
  ]);
});

test("the camera, clock and visual passage remain continuous at phase boundaries", () => {
  for (const boundary of [
    Math.log(12.5),
    2.7,
    3.7,
    Math.log(12.5 / 0.2),
    5.6,
    5.85,
    6.4,
    6.5,
    8.2,
    8.5,
  ]) {
    const a = journeyAt(boundary - 1e-7);
    const b = journeyAt(boundary + 1e-7);
    expect(b.clock).toBeGreaterThan(a.clock);
    expect(b.clock - a.clock).toBeLessThan(0.0001);
    expect(Math.abs(b.cameraYaw - a.cameraYaw)).toBeLessThan(0.0001);
    for (let i = 0; i < 4; i += 1) {
      expect(Math.abs((b.passage[i] ?? 0) - (a.passage[i] ?? 0))).toBeLessThan(
        0.0001
      );
    }
  }
});

test("manual reduced-motion travel is immediate and has no autonomous drift", () => {
  const flight = createFlight();
  flight.travel(1, true);
  const { radius } = flight;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.radius).toBe(radius);
});

test("the authored exterior observer is timelike and matches the optical velocity", () => {
  for (const progress of [6.8, 8.5, 12]) {
    const a = journeyAt(progress - 0.01);
    const b = journeyAt(progress + 0.01);
    const elapsed = b.clock - a.clock;
    const displacement = (b.passage[2] ?? 0) - (a.passage[2] ?? 0);
    const velocity = displacement / elapsed;
    expect(velocity).toBeCloseTo(EXIT_VELOCITY, 4);
    expect(-1 + velocity * velocity).toBeLessThan(0);
  }
});
