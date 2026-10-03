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
  MODEL_END_PROGRESS,
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

test("depth navigation revisits falling frames across the horizon", () => {
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
    "Под внутренним краем",
    "Сфера света",
    "Перед горизонтом",
    "За горизонтом событий",
    "Внешнее небо",
    "Граница расчёта",
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

test("manual forward travel settles at the selected depth without autonomous infall", () => {
  const flight = createFlight();
  flight.travel(0.6, false, false);
  expect(flight.active).toBe(true);
  expect(flight.playback).toBe("paused");
  expect(flight.journey.phase).toBe(0);
  expect(flight.advance(1 / 30)).toBeGreaterThan(0);
  for (let i = 0; i < 300; i += 1) {
    flight.advance(1 / 30);
  }
  expect(flight.journey.phase).toBeCloseTo(0.6, 12);
  const settled = flight.journey;
  for (let i = 0; i < 300; i += 1) {
    expect(flight.advance(1 / 30)).toBe(0);
  }
  expect(flight.journey).toEqual(settled);
  expect(flight.resume()).toBe(true);
  expect(flight.advance(1 / 30)).toBeGreaterThan(0);
});

test("manual distance navigation has no velocity discontinuity at the horizon", () => {
  const increments = [-0.001, 0.001].map((offset) => {
    const flight = createFlight();
    flight.travel(HORIZON_PROGRESS + offset, true, false);
    const before = flight.journey.phase;
    flight.travel(0.5, false, false);
    flight.advance(1 / 120);
    expect(flight.playback).toBe("paused");
    return flight.journey.phase - before;
  });
  expect(increments[0]).toBeGreaterThan(0);
  expect(increments[1]).toBeGreaterThan(0);
  expect(
    Math.abs((increments[0] ?? 0) / (increments[1] ?? 1) - 1)
  ).toBeLessThan(0.002);
});

test("manual direction changes cancel autonomous infall and respect pause", () => {
  const flight = createFlight();
  flight.travel(3, true);
  flight.resume();
  flight.advance(1 / 30);
  const visible = flight.journey.phase;
  flight.travel(-0.3, false, false);
  expect(flight.playback).toBe("rewinding");
  expect(flight.advance(1 / 30)).toBeLessThan(0);
  const reversed = flight.journey.phase;
  flight.travel(0.1, false, false);
  expect(flight.playback).toBe("paused");
  for (let i = 0; i < 300; i += 1) {
    flight.advance(1 / 30);
  }
  expect(flight.journey.phase).toBeCloseTo(reversed + 0.1, 12);
  expect(flight.journey.phase).toBeLessThan(visible + 0.1);
  flight.travel(1, false, false);
  flight.pause();
  const paused = flight.journey;
  expect(flight.advance(1 / 30)).toBe(0);
  expect(flight.journey).toEqual(paused);
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
  for (const boundary of [HORIZON_PROGRESS, MODEL_END_PROGRESS]) {
    const a = journeyAt(boundary - 1e-7);
    const b = journeyAt(boundary + 1e-7);
    expect(b.clock).toBeGreaterThan(a.clock);
    expect(b.clock - a.clock).toBeLessThan(0.0001);
    expect(Math.abs(b.radius - a.radius)).toBeLessThan(0.0001);
  }
  expect(journeyAt(100)).toEqual(journeyAt(END_PROGRESS));
  expect(journeyAt(-100)).toEqual(journeyAt(0));
});

test("navigation finishes exactly at the finite physical model boundary", () => {
  const boundary = journeyAt(MODEL_END_PROGRESS);
  expect(MODEL_END_PROGRESS).toBe(END_PROGRESS);
  expect(boundary.finished).toBe(true);
  expect(boundary.radius).toBe(END_RADIUS);
  expect(boundary.clock).toBe(END_TIME);
  expect(boundary.completion).toBe(1);
  expect(boundary.stageId).toBe("end");
  expect(boundary.stage).toBe("Граница расчёта");
  for (const extraDepth of [0.001, 1, 2.8, 100]) {
    expect(journeyAt(END_PROGRESS + extraDepth)).toEqual(boundary);
  }
  const before = journeyAt(END_PROGRESS - 0.01);
  expect(before.finished).toBe(false);
  expect(before.radius).toBeGreaterThan(END_RADIUS);
  expect(before.clock).toBeLessThan(END_TIME);
  expect(before.completion).toBeLessThan(1);
});

test("manual travel holds the model boundary and selects earlier physical radii", () => {
  const flight = createFlight();
  flight.travel(END_PROGRESS + 1, true, false);
  const visible = flight.journey;
  expect(visible.stageId).toBe("end");
  expect(flight.playback).toBe("ended");
  expect(flight.advance(1 / 30)).toBe(0);
  expect(flight.journey).toEqual(visible);
  expect(flight.travel(-2, true, false)).toBeLessThan(0);
  expect(flight.journey.finished).toBe(false);
  expect(flight.radius).toBeGreaterThan(END_RADIUS);
  expect(flight.journey.clock).toBeLessThan(END_TIME);
  flight.travel(1.5, false, false);
  for (let i = 0; i < 300; i += 1) {
    flight.advance(1 / 30);
  }
  expect(flight.journey.phase).toBeCloseTo(END_PROGRESS - 0.5, 12);
  expect(flight.journey.finished).toBe(false);
  const settled = flight.journey;
  expect(flight.advance(1 / 30)).toBe(0);
  expect(flight.journey).toEqual(settled);
});

test("manual reduced-motion travel is immediate and has no autonomous drift", () => {
  const flight = createFlight();
  flight.travel(3, true);
  const inside = flight.journey;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.journey).toEqual(inside);
});

test("playback controls start the journey, freeze queued motion and never reset its final frame", () => {
  const flight = createFlight();
  expect(flight.resume()).toBe(true);
  expect(flight.active).toBe(true);
  expect(flight.playback).toBe("playing");
  for (let i = 0; i < 60; i += 1) {
    flight.advance(1 / 30);
  }
  expect(flight.journey.phase).toBeGreaterThan(0);
  flight.travel(1000);
  flight.pause();
  const paused = flight.journey;
  expect(flight.playback).toBe("paused");
  expect(flight.advance(60)).toBe(0);
  expect(flight.journey).toEqual(paused);
  expect(flight.togglePlayback()).toBe(true);
  expect(flight.advance(1 / 30)).toBeGreaterThan(0);
  expect(flight.togglePlayback()).toBe(false);
  flight.travel(1000, true);
  const ended = flight.journey;
  expect(flight.resume()).toBe(false);
  expect(flight.togglePlayback()).toBe(false);
  expect(flight.advance(60)).toBe(0);
  expect(flight.journey).toEqual(ended);
});

test("cinematic playback visits the physical landmarks and holds its model boundary", () => {
  const flight = createFlight();
  flight.resume();
  const chapters: string[] = [];
  let horizonFrames = 0;
  let finishedAt = 0;
  for (let i = 0; i < 1800; i += 1) {
    flight.advance(1 / 30);
    const { journey } = flight;
    if (chapters.at(-1) !== journey.stageId) {
      chapters.push(journey.stageId);
    }
    if (journey.stageId === "horizon") {
      horizonFrames += 1;
    }
    if (journey.finished && finishedAt === 0) {
      finishedAt = (i + 1) / 30;
    }
    expect(flightRadius(journey.clock)).toBeCloseTo(journey.radius, 9);
    expect(journey.completion).toBeGreaterThanOrEqual(0);
    expect(journey.completion).toBeLessThanOrEqual(1);
    expect(journey.remainingProperTime).toBeGreaterThanOrEqual(0);
  }
  expect(chapters).toEqual([
    "approach",
    "isco",
    "photon-sphere",
    "horizon",
    "interior",
    "deep-interior",
    "end",
  ]);
  // The horizon gets enough display time to perceive its smooth crossing.
  expect(horizonFrames).toBeGreaterThan(60);
  expect(finishedAt).toBeGreaterThan(50);
  expect(finishedAt).toBeLessThan(56);
  expect(flight.playback).toBe("ended");
  expect(flight.journey.completion).toBe(1);
  expect(flight.journey.remainingProperTime).toBe(0);
});

test("presentation pacing is independent of refresh rate and stale frames stay bounded", () => {
  const slow = createFlight();
  const fast = createFlight();
  slow.resume();
  fast.resume();
  for (let i = 0; i < 20 * 30; i += 1) {
    slow.advance(1 / 30);
  }
  for (let i = 0; i < 20 * 144; i += 1) {
    fast.advance(1 / 144);
  }
  expect(slow.journey.phase).toBeCloseTo(fast.journey.phase, 3);
  const visible = slow.journey.phase;
  slow.advance(60);
  expect(slow.journey.phase - visible).toBeLessThanOrEqual(0.6 * 0.1);
});

test("reduced-motion preference suppresses pending and automatic motion", () => {
  const flight = createFlight();
  flight.resume();
  flight.travel(1);
  const visible = flight.journey;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.journey).toEqual(visible);
  flight.travel(0.24, true);
  expect(flight.journey.phase).toBeGreaterThan(visible.phase);
  expect(flight.advance(60, true)).toBe(0);
});
