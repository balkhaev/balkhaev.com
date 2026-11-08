import {
  MERGE_TIME,
  REFILL_START,
  SEQUENCE_END,
  START_SEPARATION,
  separationAt,
} from "./binary-merger";

/** Slowest playback, for the plunge and the ringdown, in M per second. */
const MIN_RATE = 8;
/** The refill of the new disk is fast-forwarded. */
const REFILL_RATE = 18;

/**
 * Playback rate in M per second. Early wide orbits take about 0.6 s each and
 * the last ones close to 1.4 s, so the climax plays in slow motion while the
 * whole story stays under half a minute.
 */
export function mergerRate(t: number) {
  if (t > REFILL_START) {
    return REFILL_RATE;
  }
  if (t > MERGE_TIME) {
    return MIN_RATE;
  }
  const a = separationAt(t);
  const period = 2 * Math.PI * a ** 1.5;
  return Math.max(MIN_RATE, period / (0.6 + 0.06 * (START_SEPARATION - a)));
}

export function advanceMerger(t: number, seconds: number) {
  if (seconds < 0) {
    return Math.max(0, t + mergerRate(t) * seconds);
  }
  return Math.min(SEQUENCE_END, t + mergerRate(t) * seconds);
}

/** Wall-clock length of the whole sequence, in seconds. */
export function mergerDuration(step = 1 / 60) {
  let t = 0;
  let seconds = 0;
  while (t < SEQUENCE_END && seconds < 600) {
    t = advanceMerger(t, step);
    seconds += step;
  }
  return seconds;
}
