import {
  MERGE_TIME,
  RINGDOWN_DAMPING_TIME,
  SEQUENCE_END,
  START_SEPARATION,
  separationAt,
} from "./binary-merger";

/** Scene time (in M) per second of wall clock at the start of the inspiral. */
const START_RATE = 36;
/** Slowest playback, for the plunge and the ringdown. */
const MIN_RATE = 9;

/**
 * Playback rate in M per second. The wide early orbits are fast-forwarded and
 * the last orbits are slowed, so the chirp (orbits getting faster) stays
 * visible without the inspiral taking minutes.
 */
export function mergerRate(t: number) {
  if (t > MERGE_TIME + 2 * RINGDOWN_DAMPING_TIME) {
    // After the ringdown, follow the last burst as it travels outward.
    return 2 * MIN_RATE;
  }
  if (t > MERGE_TIME) {
    return MIN_RATE;
  }
  const a = separationAt(t) / START_SEPARATION;
  return Math.max(MIN_RATE, START_RATE * a ** 0.9);
}

export function advanceMerger(t: number, seconds: number) {
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
