export const START_RADIUS = 12.5;
export const END_RADIUS = 0.2;
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);
export const CHAMBER_START = 2.72;
export const DRUM_START = 3.65;
export const BEAT_PERIOD = 10;
// The eighth contact is seen after its light has travelled from the drum to the observer.
export const EJECTION_START = DRUM_START + (8 * BEAT_PERIOD - 3.5 + 5.4) / 30;
export const LOOP_LENGTH = 9.2;
const CORE_PROGRESS = Math.log(START_RADIUS / END_RADIUS);
const AUTHORED_CLOCK_RATE = 30;

const smoothRange = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
  const departure = smoothRange(EJECTION_START, 8.4, phase);
  const returnBlend = smoothRange(7.8, 8.95, phase);
  const radius =
    phase < EJECTION_START
      ? fallingRadius
      : END_RADIUS +
        (START_RADIUS - END_RADIUS) * smoothRange(6.65, 8.95, phase);
  const beatClock = Math.max(0, phase - DRUM_START) * AUTHORED_CLOCK_RATE;
  const passage = new Float32Array([
    smoothRange(CHAMBER_START, 3.55, phase) * (1 - returnBlend),
    18 - 12.6 * smoothRange(CHAMBER_START, 4.3, phase) + 32 * departure,
    beatClock,
    departure,
  ]);
  let stage = "Погружение";
  if (phase >= Math.log(START_RADIUS)) {
    stage = "За горизонтом событий";
  }
  if (phase >= DRUM_START) {
    stage = "В ритме бубна";
  }
  if (phase >= EJECTION_START) {
    stage = "Выход наружу";
  }
  if (phase >= 8.4) {
    stage = "Новый виток";
  }
  return {
    beatClock,
    cameraYaw: 0,
    clock:
      cycle * LOOP_CLOCK +
      (phase <= CHAMBER_START
        ? rainClock(fallingRadius)
        : classicalClock + (phase - CHAMBER_START) * AUTHORED_CLOCK_RATE),
    cycle,
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
            : 0.2;
        target += seconds * pace;
      }
      const previous = properTime();
      let step = (target - progress) * (1 - Math.exp(-seconds * 7));
      if (step > 0 && !reducedMotion) {
        // Queued wheel gestures change the pace, but cannot skip the drummer.
        step = Math.min(step, seconds * (journey.phase < horizon ? 1 : 0.38));
      }
      progress += step;
      committed ||= progress >= horizon;
      return properTime() - previous;
    },
    get crossed() {
      const { phase } = journeyAt(progress);
      return phase >= horizon && phase < 8.4;
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
