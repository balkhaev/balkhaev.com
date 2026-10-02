import { CLOCK_RATE } from "./scene-geometry";

/** A preview stage selects a starting depth. Only an explicit still flag stops animation. */
export function scenePreview(hostname: string, search: string) {
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    return { phase: null, still: false };
  }
  const params = new URLSearchParams(search);
  const value = params.get("preview-stage");
  const phase = Number(value);
  return {
    phase:
      value !== null && Number.isFinite(phase) && phase >= 0 && phase <= 20
        ? phase
        : null,
    still: params.get("preview-still") === "1",
  };
}

/** One monotonic PG epoch; depth changes select geometry without scrubbing source time. */
export function sceneTimeStep(seconds: number) {
  if (!(Number.isFinite(seconds) && seconds > 0)) {
    return 0;
  }
  return seconds * CLOCK_RATE;
}
