export const START_RADIUS = 12.5;
export const END_RADIUS = 0.2;
export const HORIZON_TIME = (2 / 3) * (START_RADIUS ** 1.5 - 1);
export const END_TIME = (2 / 3) * (START_RADIUS ** 1.5 - END_RADIUS ** 1.5);

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
  const limit = Math.log(START_RADIUS / END_RADIUS);
  const horizon = Math.log(START_RADIUS);
  const properTime = () =>
    (2 / 3) *
    (START_RADIUS ** 1.5 - (START_RADIUS * Math.exp(-progress)) ** 1.5);
  return {
    get active() {
      return active;
    },
    advance(seconds: number, reducedMotion = false) {
      if (active && !reducedMotion) {
        target = Math.min(limit, target + seconds * 0.025);
      }
      const previous = properTime();
      progress += (target - progress) * (1 - Math.exp(-seconds * 7));
      crossed ||= progress >= horizon;
      return properTime() - previous;
    },
    get crossed() {
      return crossed;
    },
    get ended() {
      return progress > limit - 0.0001;
    },
    get radius() {
      return START_RADIUS * Math.exp(-progress);
    },
    reset() {
      progress = 0;
      target = 0;
      active = false;
      crossed = false;
    },
    travel(amount: number, immediate = false) {
      if (crossed && amount < 0) {
        return 0;
      }
      active = true;
      target = Math.max(
        crossed ? horizon + 0.0001 : 0,
        Math.min(limit, target + amount)
      );
      const previous = properTime();
      if (immediate) {
        progress = target;
        crossed ||= progress >= horizon;
      }
      return properTime() - previous;
    },
  };
}
