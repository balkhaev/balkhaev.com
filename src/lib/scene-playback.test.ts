import { expect, test } from "bun:test";
import { createFlight, END_RADIUS, MODEL_END_PROGRESS } from "./flight";
import { CLOCK_RATE } from "./scene-geometry";
import { scenePreview, sceneTimeStep } from "./scene-playback";

test("preview stages select depth without implicitly freezing animation", () => {
  expect(scenePreview("127.0.0.1", "?preview-stage=0")).toEqual({
    phase: 0,
    still: false,
  });
  expect(scenePreview("localhost", "?preview-stage=3")).toEqual({
    phase: 3,
    still: false,
  });
  expect(scenePreview("localhost", "?preview-stage=3&preview-still=1")).toEqual(
    { phase: 3, still: true }
  );
  expect(
    scenePreview("balkhaev.com", "?preview-stage=3&preview-still=1")
  ).toEqual({ phase: null, still: false });
  for (const search of [
    "",
    "?preview-stage=oops",
    "?preview-stage=-1",
    "?preview-stage=21",
  ]) {
    expect(scenePreview("localhost", search)).toEqual({
      phase: null,
      still: false,
    });
  }
});

test("source time advances without input at idle, paused and final depths", () => {
  const flight = createFlight();
  expect(sceneTimeStep(1)).toBe(CLOCK_RATE);
  flight.travel(2, true, false);
  const held = flight.journey;
  flight.advance(1 / 60);
  expect(sceneTimeStep(1)).toBe(CLOCK_RATE);
  expect(flight.journey).toEqual(held);
  flight.travel(20, true, false);
  expect(flight.radius).toBeCloseTo(END_RADIUS, 12);
  flight.advance(1 / 60);
  expect(sceneTimeStep(1)).toBe(CLOCK_RATE);
});

test("inward and outward depth gestures never rewind or jump the source epoch", () => {
  const flight = createFlight();
  let epoch = 0;
  for (const depth of [3, 0, 4, MODEL_END_PROGRESS + 1, 2, 20, 0]) {
    const previous = epoch;
    flight.travel(depth - flight.journey.phase, true, false);
    epoch += sceneTimeStep(1 / 60);
    expect(epoch).toBeGreaterThan(previous);
    expect(epoch - previous).toBeCloseTo(CLOCK_RATE / 60, 12);
  }
  expect(epoch).toBeCloseTo((7 * CLOCK_RATE) / 60, 12);
});

test("explicit playback and pauses keep one clock across the horizon and model endpoint", () => {
  const flight = createFlight();
  flight.resume();
  let epoch = 0;
  let properClockMovedBack = false;
  let previousWorldlineClock = flight.journey.clock;
  for (let i = 0; i < 2400; i += 1) {
    if (i === 300 || i === 1800) {
      flight.pause();
    }
    if (i === 420 || i === 1900) {
      flight.resume();
    }
    if (i === 1000) {
      flight.travel(-0.3, false, false);
    }
    if (i === 1120) {
      flight.travel(MODEL_END_PROGRESS + 1, true, false);
      flight.resume();
    }
    if (i === 2200) {
      flight.travel(-20, true, false);
    }
    flight.advance(1 / 30);
    properClockMovedBack ||= flight.journey.clock < previousWorldlineClock;
    previousWorldlineClock = flight.journey.clock;
    const previousEpoch = epoch;
    epoch += sceneTimeStep(1 / 30);
    expect(epoch).toBeGreaterThan(previousEpoch);
    expect(epoch - previousEpoch).toBeCloseTo(CLOCK_RATE / 30, 12);
  }
  expect(properClockMovedBack).toBe(true);
  expect(epoch).toBeCloseTo(80 * CLOCK_RATE, 8);
});

test("the scene clock depends only on elapsed time and ignores invalid intervals", () => {
  const intervals = [1 / 30, 1 / 144, 0.1, 0.007, 0.005];
  expect(
    intervals.reduce((sum, seconds) => sum + sceneTimeStep(seconds), 0)
  ).toBeCloseTo(
    sceneTimeStep(intervals.reduce((sum, seconds) => sum + seconds, 0)),
    12
  );
  for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(sceneTimeStep(seconds)).toBe(0);
  }
});
