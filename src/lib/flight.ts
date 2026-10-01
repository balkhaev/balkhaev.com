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

/** The trajectory ends at a finite interior radius. Navigation scrubs its display time in either direction. */
export function journeyAt(progress: number) {
  const phase = Math.max(0, Math.min(END_PROGRESS, progress));
  const radius = START_RADIUS * Math.exp(-phase);
  const finished = phase >= END_PROGRESS - 1e-7;
  let stage = "Погружение";
  if (finished) {
    stage = "Последний кадр";
  } else if (radius < 0.25) {
    stage = "Небо сжимается";
  } else if (phase >= HORIZON_PROGRESS) {
    stage = "За горизонтом событий";
  }
  return {
    clock: (2 / 3) * (START_RADIUS ** 1.5 - radius ** 1.5),
    finished,
    phase,
    radius,
    stage,
  };
}

export function createFlight() {
  let progress = 0;
  let target = 0;
  let active = false;
  let playing = false;
  const properTime = () => journeyAt(progress).clock;
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      if (!(Number.isFinite(seconds) && seconds > 0)) {
        return 0;
      }
      const journey = journeyAt(progress);
      if (playing && !reducedMotion) {
        const pace =
          journey.phase < HORIZON_PROGRESS
            ? Math.min(0.55, 3.8 / journey.radius ** 1.5)
            : 0.19;
        target = Math.min(END_PROGRESS, target + seconds * pace);
      }
      const previous = properTime();
      let step = (target - progress) * (1 - Math.exp(-seconds * 7));
      if (!reducedMotion) {
        const forwardRate = journey.phase < HORIZON_PROGRESS ? 1 : 0.45;
        const limit = seconds * (step < 0 ? 1.2 : forwardRate);
        step = Math.sign(step) * Math.min(Math.abs(step), limit);
      }
      progress += step;
      if (Math.abs(target - progress) < 1e-7) {
        progress = target;
      }
      return properTime() - previous;
    },
    get crossed() {
      return progress >= HORIZON_PROGRESS;
    },
    get journey() {
      return journeyAt(progress);
    },
    get playback() {
      if (!active) {
        return "idle";
      }
      if (target < progress - 1e-7) {
        return "rewinding";
      }
      if (journeyAt(progress).finished) {
        return "ended";
      }
      return playing ? "playing" : "paused";
    },
    get radius() {
      return journeyAt(progress).radius;
    },
    travel(amount: number, immediate = false) {
      if (!Number.isFinite(amount) || amount === 0) {
        return 0;
      }
      active = true;
      // A direction change cancels the old queued motion and anchors the gesture to the visible frame.
      const anchor =
        amount < 0 ? Math.min(progress, target) : Math.max(progress, target);
      playing = amount > 0 && !immediate;
      target = Math.min(END_PROGRESS, Math.max(0, anchor + amount));
      const previous = properTime();
      if (immediate) {
        progress = target;
      }
      return properTime() - previous;
    },
  };
}
