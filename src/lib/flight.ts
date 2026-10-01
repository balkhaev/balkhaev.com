export const START_RADIUS = 12.5;
export const END_RADIUS = 0.02;
export const HORIZON_PROGRESS = Math.log(START_RADIUS);
export const END_PROGRESS = Math.log(START_RADIUS / END_RADIUS);
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);

/** Radial rain geodesic: dr/dτ = -1/sqrt(r), dT_PG/dτ = 1. */
export const flightRadius = (properTime: number) =>
  Math.max(
    END_RADIUS,
    Math.max(0, START_RADIUS ** 1.5 - 1.5 * properTime) ** (2 / 3)
  );

/** The model ends at a finite interior radius; there is no escape or automatic reset. */
export function journeyAt(progress: number) {
  const phase = Math.max(0, Math.min(END_PROGRESS, progress));
  const radius = START_RADIUS * Math.exp(-phase);
  return {
    clock: (2 / 3) * (START_RADIUS ** 1.5 - radius ** 1.5),
    phase,
    radius,
    stage: phase >= HORIZON_PROGRESS ? "За горизонтом событий" : "Погружение",
  };
}

export function createFlight() {
  let progress = 0;
  let target = 0;
  let active = false;
  let committed = false;
  const properTime = () => journeyAt(progress).clock;
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      const journey = journeyAt(progress);
      if (active && !reducedMotion) {
        const pace =
          journey.phase < HORIZON_PROGRESS
            ? Math.min(0.55, 3.8 / journey.radius ** 1.5)
            : 0.19;
        target = Math.min(END_PROGRESS, target + seconds * pace);
      }
      const previous = properTime();
      let step = (target - progress) * (1 - Math.exp(-seconds * 7));
      if (step > 0 && !reducedMotion) {
        step = Math.min(
          step,
          seconds * (journey.phase < HORIZON_PROGRESS ? 1 : 0.45)
        );
      }
      progress += step;
      if (Math.abs(target - progress) < 1e-7) {
        progress = target;
      }
      committed ||= progress >= HORIZON_PROGRESS;
      return properTime() - previous;
    },
    get crossed() {
      return progress >= HORIZON_PROGRESS;
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
      target = Math.min(
        END_PROGRESS,
        Math.max(committed ? progress : 0, target + amount)
      );
      const previous = properTime();
      if (immediate) {
        progress = target;
        committed ||= progress >= HORIZON_PROGRESS;
      }
      return properTime() - previous;
    },
  };
}
