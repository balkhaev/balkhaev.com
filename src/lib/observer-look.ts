const radians = Math.PI / 180;

/** The direction of radial inward fall stays fixed through the whole route. */
export function guidedLookAt() {
  return {
    pitch: 0,
    yaw: 0,
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
    advance(seconds: number, immediate = false) {
      if (guided) {
        const target = guidedLookAt();
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
