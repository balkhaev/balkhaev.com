import { shadowAngle } from "./infall-geodesics";
import { skyShiftAt } from "./relativity";

/** Display seconds per unshifted cycle in the labelled local rate illustration. */
export const LOCAL_CLOCK_PERIOD_SECONDS = 8;

/** A specified exterior sky ray two degrees outside the shadow, not a camera heading. */
export const skyRimAngle = (radius: number) =>
  shadowAngle(radius) + (2 * Math.PI) / 180;

interface ClockReading {
  phase: number;
  rate: number | null;
  ticks: number;
}

/**
 * A local tangent comparison, not the retarded history of a shared emitter.
 * Integrating each instantaneous rate keeps the illustrated phase continuous
 * when depth or gaze changes. It never changes the PG scene or source epochs.
 */
export function createLocalLightClocks() {
  let local = 0;
  let forward = 0;
  let rim = 0;
  let rear = 0;
  const reading = (cycles: number, rate: number | null): ClockReading => {
    const ticks = Math.floor(cycles);
    return { phase: cycles - ticks, rate, ticks };
  };
  return {
    advance(seconds: number, radius: number, forwardAngle: number) {
      const elapsed = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      const forwardRate = skyShiftAt(radius, forwardAngle);
      const rimRate = skyShiftAt(radius, skyRimAngle(radius));
      const rearRate = skyShiftAt(radius, Math.PI) ?? 1;
      local += elapsed / LOCAL_CLOCK_PERIOD_SECONDS;
      forward += (elapsed * (forwardRate ?? 0)) / LOCAL_CLOCK_PERIOD_SECONDS;
      rim += (elapsed * (rimRate ?? 0)) / LOCAL_CLOCK_PERIOD_SECONDS;
      rear += (elapsed * rearRate) / LOCAL_CLOCK_PERIOD_SECONDS;
      return {
        forward: reading(forward, forwardRate),
        local: reading(local, 1),
        rear: reading(rear, rearRate),
        rim: reading(rim, rimRate),
      };
    },
  };
}
