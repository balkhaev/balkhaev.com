import { END_RADIUS, START_RADIUS } from "./flight";
import { shadowAngle as rainShadowAngle } from "./infall-geodesics";

const modelRadius = (radius: number) =>
  Number.isFinite(radius) && radius > 0
    ? Math.max(END_RADIUS, radius)
    : START_RADIUS;

/**
 * Received/emitted frequency for a source at rest at infinity, in the radial
 * rain observer's frame. Angle is measured from inward radial gaze, in radians.
 * The same ratio gives the apparent rate of that source's clock along this ray;
 * it does not set the scene's PG epoch or the local observer's proper-clock rate.
 * Captured directions and nonpositive Killing energy cannot show that source.
 */
export function skyShiftAt(radius: number, angle: number) {
  const r = modelRadius(radius);
  if (
    !Number.isFinite(angle) ||
    angle < 0 ||
    angle > Math.PI ||
    angle <= rainShadowAngle(r)
  ) {
    return null;
  }
  const energy = 1 - Math.cos(angle) / Math.sqrt(r);
  return energy > 0 ? 1 / energy : null;
}

/**
 * Schwarzschild readouts for the physical rain frame, in r_s = c = 1 units.
 * Static speed and lapse are defined only outside the horizon. Tidal strength
 * is relative to START_RADIUS; without a mass it is not a force in SI units.
 * The optical journey ends at END_RADIUS, before the singularity.
 */
export function relativityAt(radius: number, forwardAngle = 0) {
  const r = modelRadius(radius);
  const outside = r > 1;
  return {
    forwardShift: skyShiftAt(r, forwardAngle),
    insideHorizon: !outside,
    radius: r,
    rearShift: skyShiftAt(r, Math.PI - forwardAngle),
    shadowAngle: rainShadowAngle(r),
    sideShift: skyShiftAt(r, Math.PI / 2),
    staticLapse: outside ? Math.sqrt(1 - 1 / r) : null,
    staticSpeed: outside ? Math.sqrt(1 / r) : null,
    tidalRatio: (START_RADIUS / r) ** 3,
  };
}
