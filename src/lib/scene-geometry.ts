import { START_RADIUS } from "./flight";

export const OBSERVER_RADIUS = START_RADIUS;
export const CLOCK_RATE = 3.8;
export interface SceneView {
  distance: number;
  fov: number;
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
