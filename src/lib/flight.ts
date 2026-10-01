import {
  APPROACH_DISTANCE,
  DRUM_CENTER,
  DRUM_STRIKES,
  ease,
} from "./drum-score";

export const START_RADIUS = 12.5;
export const END_RADIUS = 0.2;
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);
export const CHAMBER_START = 2.72;
export const DRUM_START = 3.65;
// The last contact is seen after its light has travelled to the approaching observer.
export const EJECTION_START =
  DRUM_START + (DRUM_STRIKES[3] + APPROACH_DISTANCE) / 30;
export const PORTAL_EXIT = EJECTION_START + 0.67;
export const LOOP_LENGTH = 9.2;
const CORE_PROGRESS = Math.log(START_RADIUS / END_RADIUS);
const AUTHORED_CLOCK_RATE = 30;

const rainClock = (radius: number) =>
  (2 / 3) * (START_RADIUS ** 1.5 - radius ** 1.5);
const classicalClock = rainClock(START_RADIUS * Math.exp(-CHAMBER_START));
export const LOOP_CLOCK =
  classicalClock + (LOOP_LENGTH - CHAMBER_START) * AUTHORED_CLOCK_RATE;

/** The optical infall is classical. The drummer and looping escape are authored fiction. */
export function journeyAt(progress: number) {
  const cycle = Math.floor(Math.max(0, progress) / LOOP_LENGTH);
  const phase = Math.max(0, progress) - cycle * LOOP_LENGTH;
  const fallingRadius =
    START_RADIUS * Math.exp(-Math.min(CORE_PROGRESS, phase));
  const departure = ease(PORTAL_EXIT, 8.95, phase);
  const returnBlend = ease(7.8, 8.95, phase);
  const radius =
    phase < EJECTION_START
      ? fallingRadius
      : END_RADIUS +
        (START_RADIUS - END_RADIUS) * ease(PORTAL_EXIT, 8.95, phase);
  const beatClock = Math.max(0, phase - DRUM_START) * AUTHORED_CLOCK_RATE;
  const arrival = ease(CHAMBER_START, 4.15, phase);
  const approach = ease(4.7, EJECTION_START, phase);
  const dive = ease(EJECTION_START, PORTAL_EXIT, phase);
  const camera = new Float32Array([
    DRUM_CENTER[0] * approach,
    DRUM_CENTER[1] * approach,
    -18 +
      12.6 * arrival +
      (5.4 + DRUM_CENTER[2] - APPROACH_DISTANCE) * approach +
      3.4 * dive,
    ease(EJECTION_START, EJECTION_START + 0.22, phase),
  ]);
  const separation = Math.hypot(
    (camera[0] ?? 0) - DRUM_CENTER[0],
    (camera[1] ?? 0) - DRUM_CENTER[1],
    (camera[2] ?? 0) - DRUM_CENTER[2]
  );
  for (const strike of DRUM_STRIKES) {
    const age = beatClock - strike - separation / 0.65;
    if (age <= 0 || age > 4) {
      continue;
    }
    const impulse = Math.exp(-age * 2) * Math.sin(age * 6);
    camera[0] = (camera[0] ?? 0) + impulse * 0.009;
    camera[1] = (camera[1] ?? 0) + impulse * 0.006;
    camera[2] = (camera[2] ?? 0) - impulse * 0.024;
  }
  const passage = new Float32Array([
    ease(CHAMBER_START, 3.55, phase) * (1 - returnBlend),
    3 + 9.5 * departure,
    beatClock,
    ease(EJECTION_START + 0.35, PORTAL_EXIT, phase),
  ]);
  let stage = "Погружение";
  if (phase >= Math.log(START_RADIUS)) {
    stage = "За горизонтом событий";
  }
  if (phase >= DRUM_START) {
    stage = "Внутри";
  }
  if (phase >= EJECTION_START) {
    stage = "Выход наружу";
  }
  if (phase >= 8.4) {
    stage = "Новый виток";
  }
  return {
    beatClock,
    camera,
    cameraYaw: 0,
    clock:
      cycle * LOOP_CLOCK +
      (phase <= CHAMBER_START
        ? rainClock(fallingRadius)
        : classicalClock + (phase - CHAMBER_START) * AUTHORED_CLOCK_RATE),
    cycle,
    exitVelocity:
      phase > PORTAL_EXIT && phase < 8.95
        ? (9.5 *
            6 *
            ((phase - PORTAL_EXIT) / (8.95 - PORTAL_EXIT)) *
            (1 - (phase - PORTAL_EXIT) / (8.95 - PORTAL_EXIT))) /
          ((8.95 - PORTAL_EXIT) * AUTHORED_CLOCK_RATE)
        : 0,
    passage,
    phase,
    radius,
    stage,
  };
}

/** Radial rain geodesic: dr/dτ = -1/sqrt(r), dT_PG/dτ = 1. */
export const flightRadius = (properTime: number) =>
  Math.max(
    END_RADIUS,
    Math.max(0, START_RADIUS ** 1.5 - 1.5 * properTime) ** (2 / 3)
  );

export function createFlight() {
  let progress = 0;
  let target = 0;
  let active = false;
  let committed = false;
  const horizon = Math.log(START_RADIUS);
  const properTime = () => journeyAt(progress).clock;
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      const journey = journeyAt(progress);
      if (active && !reducedMotion) {
        const pace =
          journey.phase < horizon
            ? Math.min(0.55, 3.8 / journey.radius ** 1.5)
            : 0.19;
        target += seconds * pace;
      }
      const previous = properTime();
      let step = (target - progress) * (1 - Math.exp(-seconds * 7));
      if (step > 0 && !reducedMotion) {
        // Queued wheel gestures change the pace, but cannot skip the drummer.
        let limit = 0.45;
        if (journey.phase < horizon) {
          limit = 1;
        } else if (
          journey.phase >= DRUM_START &&
          journey.phase <= EJECTION_START
        ) {
          limit = 0.24;
        }
        step = Math.min(step, seconds * limit);
      }
      progress += step;
      committed ||= progress >= horizon;
      return properTime() - previous;
    },
    get crossed() {
      const { phase } = journeyAt(progress);
      return phase >= horizon && phase < PORTAL_EXIT;
    },
    get journey() {
      return journeyAt(progress);
    },
    get radius() {
      return journeyAt(progress).radius;
    },
    travel(amount: number, immediate = false) {
      if (committed && amount < 0) {
        return 0;
      }
      active = true;
      target = Math.max(committed ? progress : 0, target + amount);
      const previous = properTime();
      if (immediate) {
        progress = target;
        committed ||= progress >= horizon;
      }
      return properTime() - previous;
    },
  };
}
