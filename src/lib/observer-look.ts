import { END_RADIUS, HORIZON_PROGRESS, START_RADIUS } from "./flight";

const radians = Math.PI / 180;

/** Guide towards the increasingly blueshifted sky band; it never changes a ray's physics. */
export function guidedLookAt(radius: number) {
  const r = Math.max(END_RADIUS, Math.min(START_RADIUS, radius));
  const phase = Math.log(START_RADIUS / r);
  const fraction = Math.max(
    0,
    Math.min(1, (phase - 1.65) / (HORIZON_PROGRESS - 1.65))
  );
  const ease = fraction ** 3 * (10 + fraction * (6 * fraction - 15));
  // For the rain frame g = 1 / (1 - cos(theta) / sqrt(r)). Choose g=2/sqrt(r)
  // inside: this growing, finite shift stays outside the shadow on the route.
  // It approaches the transverse sky band as r shrinks, without a post-end turn.
  const shift = 2 / Math.sqrt(r);
  const skyAngle = Math.acos(
    Math.max(-1, Math.min(1, Math.sqrt(r) * (1 - 1 / shift)))
  );
  return {
    pitch: 0,
    yaw: (ease * skyAngle) / radians,
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
    advance(radius: number, seconds: number, immediate = false) {
      if (guided) {
        const target = guidedLookAt(radius);
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
