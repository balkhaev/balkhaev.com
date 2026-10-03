import { END_RADIUS, START_RADIUS } from "./flight";
import { CRITICAL_B } from "./geodesics";
import { shadowAngle } from "./infall-geodesics";

export const OBSERVER_RADIUS = START_RADIUS;
export const CLOCK_RATE = 3.8;
export interface SceneView {
  distance: number;
  fov: number;
  panorama?: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  yaw: number;
}

/** A first-person rain observer just above the disk plane; looking never moves the eye. */
export function cameraOf(view: SceneView) {
  const tilt = (84 * Math.PI) / 180;
  const yaw = (view.yaw * Math.PI) / 180;
  const pitch = (view.pitch * Math.PI) / 180;
  const eye: [number, number, number] = [
    0,
    view.distance * Math.cos(tilt),
    -view.distance * Math.sin(tilt),
  ];
  const inward = [0, -Math.cos(tilt), Math.sin(tilt)];
  const horizonUp = [0, Math.sin(tilt), Math.cos(tilt)];
  const side = [-1, 0, 0];
  const right0 = side.map(
    (v, i) => v * Math.cos(yaw) - (inward[i] ?? 0) * Math.sin(yaw)
  );
  const heading = inward.map(
    (v, i) => v * Math.cos(yaw) + (side[i] ?? 0) * Math.sin(yaw)
  );
  const forward = heading.map(
    (v, i) => v * Math.cos(pitch) + (horizonUp[i] ?? 0) * Math.sin(pitch)
  );
  const up0 = horizonUp.map(
    (v, i) => v * Math.cos(pitch) - (heading[i] ?? 0) * Math.sin(pitch)
  );
  const roll = (view.roll * Math.PI) / 180;
  const right = right0.map(
    (value, i) => value * Math.cos(roll) + (up0[i] ?? 0) * Math.sin(roll)
  );
  const up = up0.map(
    (value, i) => value * Math.cos(roll) - (right0[i] ?? 0) * Math.sin(roll)
  );
  return { basis: new Float32Array([...right, ...up, ...forward]), eye };
}

export function focalLength(view: SceneView, width: number, height: number) {
  return (Math.min(width, height) * 0.5) / Math.tan((view.fov * Math.PI) / 360);
}

const LENS_ENTRY_RADIUS = 3;
const OUTER_FOV = 64;
const FINAL_SHADOW_RADIUS = 0.95;
const outerHalf = (OUTER_FOV * Math.PI) / 360;
const entryShadow = shadowAngle(LENS_ENTRY_RADIUS);
const entryCos = Math.cos(entryShadow);
const entrySin = Math.sin(entryShadow);
const entryFlow = 1 / Math.sqrt(LENS_ENTRY_RADIUS);
const entryRho = Math.tan(entryShadow) / Math.tan(outerHalf);
// Differentiate r*sin(theta)=b_critical*(1-cos(theta)/sqrt(r)) with respect
// to inward log distance. Matching the fixed lens slope gives a C1 transition.
const entryAngleSlope =
  (LENS_ENTRY_RADIUS * entrySin - (CRITICAL_B * entryFlow * entryCos) / 2) /
  (LENS_ENTRY_RADIUS * entryCos - CRITICAL_B * entryFlow * entrySin);
const shadowGrowth =
  entryAngleSlope /
  (entryCos ** 2 * Math.tan(outerHalf) * (FINAL_SHADOW_RADIUS - entryRho));

function lensAngle(rho: number, half: number, panorama: number) {
  const rectilinear = Math.atan(rho * Math.tan(half));
  const stereographic = 2 * Math.atan(rho * Math.tan(half * 0.5));
  return rectilinear * (1 - panorama) + stereographic * panorama;
}

/** Lens presentation keeps the growing physical shadow in frame without a pan or zoom-out. */
export function opticsAt(radius: number) {
  if (radius >= LENS_ENTRY_RADIUS) {
    return { fov: OUTER_FOV, panorama: 0 };
  }
  const r = Math.max(END_RADIUS, radius);
  const depth = Math.log(LENS_ENTRY_RADIUS / r);
  const at = Math.max(0, Math.min(1, depth / Math.log(5)));
  const panorama = at * at * (3 - 2 * at);
  const rho =
    entryRho +
    (FINAL_SHADOW_RADIUS - entryRho) * (1 - Math.exp(-shadowGrowth * depth));
  const shadow = shadowAngle(r);
  let low = outerHalf;
  let high = Math.PI / 2;
  for (let step = 0; step < 32; step += 1) {
    const half = (low + high) / 2;
    if (lensAngle(rho, half, panorama) < shadow) {
      low = half;
    } else {
      high = half;
    }
  }
  return { fov: ((low + high) * 180) / Math.PI, panorama };
}

/** Unit sightline in the local camera frame. CPU picking and the GPU use the same lens. */
export function cameraRay(
  view: SceneView,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const scale = Math.min(width, height) * 0.5;
  const dx = ((x - view.x) * width) / scale;
  const dy = ((view.y - y) * height) / scale;
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-9) {
    return [0, 0, 1];
  }
  const half = (view.fov * Math.PI) / 360;
  const panorama = view.panorama ?? 0;
  const angle = lensAngle(rho, half, panorama);
  return [
    (dx / rho) * Math.sin(angle),
    (dy / rho) * Math.sin(angle),
    Math.cos(angle),
  ];
}
