import { expect, test } from "bun:test";
import { DRUM_STRIKES, observedScore } from "./drum-score";
import {
  CHAMBER_START,
  createFlight,
  DRUM_START,
  EJECTION_START,
  flightRadius,
  HORIZON_TIME,
  journeyAt,
  LOOP_CLOCK,
  LOOP_LENGTH,
  PORTAL_EXIT,
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

test("the horizon cannot be reversed, but the drummer returns the route to a new infall", () => {
  const flight = createFlight();
  flight.travel(3, true);
  expect(flight.radius).toBeLessThan(1);
  expect(flight.crossed).toBe(true);
  const inside = flight.radius;
  const firstClock = flight.journey.clock;
  flight.travel(-100, true);
  expect(flight.radius).toBe(inside);
  flight.travel(LOOP_LENGTH - 3, true);
  expect(flight.radius).toBeCloseTo(START_RADIUS, 12);
  expect(flight.journey.cycle).toBe(1);
  expect(flight.journey.stage).toBe("Погружение");
  expect(flight.journey.clock).toBeGreaterThan(firstClock);
  expect(flight.crossed).toBe(false);
  flight.travel(3, true);
  expect(flight.radius).toBeCloseTo(inside, 12);
  expect(flight.journey.clock).toBeCloseTo(firstClock + LOOP_CLOCK, 10);
  flight.travel(-3, true);
  expect(flight.journey.cycle).toBe(1);
  expect(flight.crossed).toBe(true);
});

test("large scroll gestures reveal every stage before crossing the cycle seam", () => {
  const flight = createFlight();
  flight.travel(30);
  const stages: string[] = [];
  let chamberFrames = 0;
  for (let i = 0; i < 850; i += 1) {
    flight.advance(1 / 30);
    const { stage } = flight.journey;
    if (stages.at(-1) !== stage) {
      stages.push(stage);
    }
    if (stage === "Внутри") {
      chamberFrames += 1;
    }
  }
  expect(stages.slice(0, 6)).toEqual([
    "Погружение",
    "За горизонтом событий",
    "Внутри",
    "Выход наружу",
    "Новый виток",
    "Погружение",
  ]);
  expect(chamberFrames).toBeGreaterThan(180);
});

test("visible geometry and the world clock are continuous at all phase boundaries", () => {
  for (const cycle of [0, 1, 7]) {
    for (const boundary of [
      Math.log(12.5),
      CHAMBER_START,
      3.55,
      DRUM_START,
      4.15,
      4.7,
      EJECTION_START,
      EJECTION_START + 0.22,
      EJECTION_START + 0.35,
      PORTAL_EXIT,
      7.8,
      8.4,
      8.95,
      LOOP_LENGTH,
    ]) {
      const at = cycle * LOOP_LENGTH + boundary;
      const a = journeyAt(at - 1e-7);
      const b = journeyAt(at + 1e-7);
      expect(b.clock).toBeGreaterThan(a.clock);
      expect(b.clock - a.clock).toBeLessThan(0.0001);
      expect(Math.abs(b.radius - a.radius)).toBeLessThan(0.0001);
      expect(b.cameraYaw).toBe(a.cameraYaw);
      expect(Math.abs((b.passage[0] ?? 0) - (a.passage[0] ?? 0))).toBeLessThan(
        0.0001
      );
      // The authored camera/beat reset occurs only after their image is fully invisible.
      if (boundary === LOOP_LENGTH) {
        expect(a.passage[0]).toBe(0);
        expect(b.passage[0]).toBe(0);
      } else {
        for (let i = 1; i < 4; i += 1) {
          expect(
            Math.abs((b.passage[i] ?? 0) - (a.passage[i] ?? 0))
          ).toBeLessThan(0.0001);
        }
        for (let i = 0; i < 4; i += 1) {
          expect(
            Math.abs((b.camera[i] ?? 0) - (a.camera[i] ?? 0))
          ).toBeLessThan(0.0001);
        }
      }
    }
  }
});

test("ejection begins exactly on a drum contact after several visible beats", () => {
  const journey = journeyAt(EJECTION_START);
  expect(observedScore(journey.beatClock, journey.camera)).toBeCloseTo(
    DRUM_STRIKES[3],
    6
  );
  expect(journeyAt(DRUM_START).beatClock).toBe(0);
});

test("manual reduced-motion travel is immediate and has no autonomous drift", () => {
  const flight = createFlight();
  flight.travel(4.7, true);
  const { clock, radius, beatClock } = flight.journey;
  expect(flight.advance(60, true)).toBe(0);
  expect(flight.radius).toBe(radius);
  expect(flight.journey.clock).toBe(clock);
  expect(flight.journey.beatClock).toBe(beatClock);
});

test("each cycle preserves classical infall optics and never rewinds emission time", () => {
  for (const cycle of [0, 1, 100]) {
    const start = journeyAt(cycle * LOOP_LENGTH);
    const falling = journeyAt(cycle * LOOP_LENGTH + 2);
    expect(start.radius).toBeCloseTo(START_RADIUS, 10);
    expect(falling.radius).toBeCloseTo(START_RADIUS * Math.exp(-2), 10);
    expect(falling.clock).toBeGreaterThan(start.clock);
    expect(falling.passage[0]).toBe(0);
  }
});

test("the authored outgoing camera remains slower than light", () => {
  for (let phase = 3.6; phase < 8.9; phase += 0.02) {
    const a = journeyAt(phase - 0.01);
    const b = journeyAt(phase + 0.01);
    const speed =
      ((b.passage[1] ?? 0) - (a.passage[1] ?? 0)) / (b.clock - a.clock);
    const cameraSpeed =
      Math.hypot(
        ...Array.from(
          b.camera.slice(0, 3),
          (value, i) => value - (a.camera[i] ?? 0)
        )
      ) /
      (b.clock - a.clock);
    expect(cameraSpeed).toBeLessThan(1);
    expect(speed).toBeLessThan(1);
    expect(journeyAt(phase).exitVelocity).toBeCloseTo(speed, 4);
  }
});
