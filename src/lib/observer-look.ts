import { END_RADIUS, MODEL_END_PROGRESS, START_RADIUS } from "./flight";

const radians = Math.PI / 180;

/** A directed gaze reveals the peripheral sky; the observer's radial worldline is unchanged. */
export function guidedLookAt(radius: number, artisticProgress = 0) {
  const phase = Math.log(START_RADIUS / Math.max(END_RADIUS, radius));
  const fraction = Math.max(
    0,
    Math.min(1, (phase - 1.65) / (MODEL_END_PROGRESS - 1.65))
  );
  const ease = fraction ** 3 * (10 + fraction * (6 * fraction - 15));
  const imagined = Math.max(0, Math.min(1, artisticProgress));
  const turn = imagined ** 3 * (10 + imagined * (6 * imagined - 15));
  return {
    pitch:
      -4 * Math.sin(fraction * Math.PI) +
      5 * Math.sin(imagined * Math.PI) -
      turn * 4,
    yaw: ease * 78 + turn * 22,
  };
}

const shortestTurn = (angle: number) =>
  Math.atan2(Math.sin(angle * radians), Math.cos(angle * radians)) / radians;

/** Damped look, with immediate manual takeover and no automatic return after a drag. */
export function createObserverLook() {
  let guided = true;
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  return {
    advance(
      radius: number,
      seconds: number,
      immediate = false,
      artisticProgress = 0
    ) {
      if (guided) {
        const target = guidedLookAt(radius, artisticProgress);
        targetYaw = yaw + shortestTurn(target.yaw - yaw);
        targetPitch = target.pitch;
      }
      const blend = immediate
        ? 1
        : 1 - Math.exp(-Math.max(0, seconds) * (guided ? 3.2 : 14));
      yaw += (targetYaw - yaw) * blend;
      pitch += (targetPitch - pitch) * blend;
      return { pitch, yaw };
    },
    get guided() {
      return guided;
    },
    setGuided(value: boolean) {
      guided = value;
      targetYaw = yaw;
      targetPitch = pitch;
    },
    turn(horizontal: number, vertical: number, immediate = false) {
      if (guided) {
        guided = false;
        targetYaw = yaw;
        targetPitch = pitch;
      }
      targetYaw += horizontal;
      targetPitch = Math.max(-89, Math.min(89, targetPitch + vertical));
      if (immediate) {
        yaw = targetYaw;
        pitch = targetPitch;
      }
    },
  };
}
