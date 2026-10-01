import { expect, test } from "bun:test";
import {
  createFlight,
  END_PROGRESS,
  END_RADIUS,
  END_TIME,
  flightRadius,
  HORIZON_PROGRESS,
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

test("display time can rewind through the horizon along the same falling worldline", () => {
  const flight = createFlight();
  flight.travel(1, true);
  flight.travel(-1, true);
  expect(flight.radius).toBe(START_RADIUS);
  flight.travel(3, true);
  expect(flight.radius).toBeLessThan(1);
  expect(flight.crossed).toBe(true);
  const { clock } = flight.journey;
  expect(flight.travel(-100, true)).toBeCloseTo(-clock, 12);
  expect(flight.radius).toBe(START_RADIUS);
  expect(flight.crossed).toBe(false);
  expect(flight.playback).toBe("paused");
  expect(flight.advance(60)).toBe(0);
});

test("forward playback reaches an explicit final frame and holds without a cycle reset", () => {
  const flight = createFlight();
  flight.travel(1000);
  let radius = START_RADIUS;
  let clock = 0;
  const stages: string[] = [];
  for (let i = 0; i < 1000; i += 1) {
    flight.advance(1 / 30);
    const { journey } = flight;
    expect(journey.radius).toBeLessThanOrEqual(radius);
    expect(journey.clock).toBeGreaterThanOrEqual(clock);
    if (stages.at(-1) !== journey.stage) {
      stages.push(journey.stage);
    }
    ({ radius, clock } = journey);
  }
  expect(stages).toEqual([
    "Погружение",
    "За горизонтом событий",
    "Небо сжимается",
    "Последний кадр",
  ]);
  expect(radius).toBeCloseTo(END_RADIUS, 12);
  expect(clock).toBeCloseTo(END_TIME, 12);
  expect(flight.advance(60)).toBe(0);
  expect(flight.travel(1000, true)).toBe(0);
  expect(flight.crossed).toBe(true);
  expect(flight.playback).toBe("ended");
});

test("reverse input cancels queued infall, settles on the requested frame and stays paused", () => {
  const flight = createFlight();
  flight.travel(3, true);
  flight.travel(1000);
  flight.advance(1 / 30);
  const visible = flight.journey;
  flight.travel(-0.3);
  expect(flight.playback).toBe("rewinding");
  let previous = visible;
  for (let i = 0; i < 300; i += 1) {
    const delta = flight.advance(1 / 30);
    expect(delta).toBeLessThanOrEqual(0);
    expect(flight.journey.radius).toBeGreaterThanOrEqual(previous.radius);
    expect(previous.phase - flight.journey.phase).toBeLessThanOrEqual(
      1.2 / 30 + 1e-12
    );
    previous = flight.journey;
  }
  expect(flight.journey.phase).toBeCloseTo(visible.phase - 0.3, 12);
  expect(flight.playback).toBe("paused");
  expect(flight.advance(60)).toBe(0);
  flight.travel(0.05);
  expect(flight.playback).toBe("playing");
  expect(flight.advance(1 / 30)).toBeGreaterThan(0);
});

test("direction changes anchor to the visible frame and can revisit the endpoint", () => {
  const flight = createFlight();
  flight.travel(1000, true);
  flight.travel(-1000);
  flight.advance(1 / 30);
  const visible = flight.journey.phase;
  flight.travel(0.01, true);
  expect(flight.journey.phase).toBeCloseTo(visible + 0.01, 12);
  flight.travel(1000, true);
  expect(flight.playback).toBe("ended");
  expect(flight.journey.finished).toBe(true);
  const { clock } = flight.journey;
  expect(flight.travel(-1000, true)).toBeCloseTo(-clock, 12);
  expect(flight.journey.finished).toBe(false);
  expect(flight.journey.phase).toBe(0);
});

test("invalid gestures and elapsed times preserve the current trajectory frame", () => {
  const flight = createFlight();
  const initial = flight.journey;
  for (const amount of [
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    expect(flight.travel(amount)).toBe(0);
  }
  expect(flight.active).toBe(false);
  for (const seconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(flight.advance(seconds)).toBe(0);
  }
  expect(flight.journey).toEqual(initial);
});

test("radius and proper time remain continuous through the horizon and finite model boundary", () => {
  for (const boundary of [HORIZON_PROGRESS, END_PROGRESS]) {
    const a = journeyAt(boundary - 1e-7);
    const b = journeyAt(boundary + 1e-7);
    expect(b.clock).toBeGreaterThan(a.clock);
    expect(b.clock - a.clock).toBeLessThan(0.0001);
    expect(Math.abs(b.radius - a.radius)).toBeLessThan(0.0001);
  }
  expect(journeyAt(100)).toEqual(journeyAt(END_PROGRESS));
  expect(journeyAt(-100)).toEqual(journeyAt(0));
});

test("manual reduced-motion travel is immediate and has no autonomous drift", () => {
  const flight = createFlight();
  flight.travel(3, true);
  const inside = flight.journey;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.journey).toEqual(inside);
});
