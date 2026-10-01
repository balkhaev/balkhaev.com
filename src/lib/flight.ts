export const START_RADIUS = 12.5;
export const END_RADIUS = 0.2;
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);
export const WHITE_EXIT = 5.85;
export const OPEN_SPACE = 8.5;
export const EXIT_VELOCITY = 0.45;
const CORE_PROGRESS = Math.log(START_RADIUS / END_RADIUS);

const smoothRange = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Classical infall ends before the singularity; the following passage is a visual interpretation. */
export function journeyAt(progress: number) {
  const radius = START_RADIUS * Math.exp(-Math.min(CORE_PROGRESS, progress));
  const passage = new Float32Array([
    smoothRange(2.7, 3.7, progress),
    Math.max(0, Math.min(1, (progress - 2.65) / 3.2)),
    3 + Math.max(0, progress - WHITE_EXIT) * 10,
    smoothRange(5.6, 6.5, progress),
  ]);
  let stage = "Погружение";
  if (radius < 1) {
    stage = "За горизонтом событий";
  }
  if (progress >= 3.7) {
    stage = "Переход";
  }
  if (progress >= WHITE_EXIT) {
    stage = "Белая дыра";
  }
  if (progress >= OPEN_SPACE) {
    stage = "По ту сторону";
  }
  return {
    cameraYaw: 180 * smoothRange(6.4, 8.2, progress),
    clock:
      (2 / 3) * (START_RADIUS ** 1.5 - radius ** 1.5) +
      Math.max(0, Math.min(progress, WHITE_EXIT) - CORE_PROGRESS) * 35 +
      (Math.max(0, progress - WHITE_EXIT) * 10) / EXIT_VELOCITY,
    passage,
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
  let crossed = false;
  const horizon = Math.log(START_RADIUS);
  const properTime = () => journeyAt(progress).clock;
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      if (active && !reducedMotion) {
        const pace = crossed ? 0.08 : 0.025;
        target += seconds * pace;
      }
      const previous = properTime();
      let step = (target - progress) * (1 - Math.exp(-seconds * 7));
      if (step > 0 && !reducedMotion) {
        step = crossed
          ? Math.min(step, seconds * 0.5)
          : Math.min(
              step,
              seconds * 1.2,
              Math.max(0.05, horizon - progress + 0.05)
            );
      }
      progress += step;
      crossed ||= progress >= horizon;
      return properTime() - previous;
    },
    get crossed() {
      return crossed;
    },
    get journey() {
      return journeyAt(progress);
    },
    get radius() {
      return journeyAt(progress).radius;
    },
    travel(amount: number, immediate = false) {
      if (crossed && amount < 0) {
        return 0;
      }
      active = true;
      target = Math.max(crossed ? horizon + 0.0001 : 0, target + amount);
      const previous = properTime();
      if (immediate) {
        progress = target;
        crossed ||= progress >= horizon;
      }
      return properTime() - previous;
    },
  };
}
