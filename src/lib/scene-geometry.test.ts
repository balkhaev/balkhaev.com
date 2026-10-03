import { describe, expect, test } from "bun:test";
import { END_RADIUS, START_RADIUS } from "./flight";
import { shadowAngle } from "./infall-geodesics";
import {
  cameraOf,
  cameraRay,
  focalLength,
  OBSERVER_RADIUS,
  opticsAt,
  type SceneView,
} from "./scene-geometry";

const view: SceneView = {
  distance: OBSERVER_RADIUS,
  fov: 56,
  pitch: 0,
  roll: 0,
  x: 0.5,
  y: 0.5,
  yaw: 0,
};

// Invert the actual picking ray rather than a second copy of the lens formula.
function projectedShadowRadius(radius: number) {
  const frame = { ...view, ...opticsAt(radius), distance: radius };
  const shadow = shadowAngle(radius);
  let low = 0;
  let high = 2;
  for (let step = 0; step < 40; step += 1) {
    const rho = (low + high) / 2;
    const ray = cameraRay(frame, 1000, 1000, 0.5 + rho / 2, 0.5);
    if (Math.acos(ray[2] ?? 0) < shadow) {
      low = rho;
    } else {
      high = rho;
    }
  }
  return (low + high) / 2;
}

describe("first-person scene", () => {
  test("looking through 360 degrees preserves an orthonormal camera and never moves the eye", () => {
    for (const distance of [12.5, 1, 0.5]) {
      const origin = cameraOf({ ...view, distance }).eye;
      for (const yaw of [-360, -180, 0, 90, 720]) {
        for (const pitch of [-89, 0, 89]) {
          const { basis, eye } = cameraOf({ ...view, distance, pitch, yaw });
          expect(eye).toEqual(origin);
          for (let a = 0; a < 3; a += 1) {
            for (let b = 0; b < 3; b += 1) {
              let dot = 0;
              for (let k = 0; k < 3; k += 1) {
                dot += (basis[a * 3 + k] ?? 0) * (basis[b * 3 + k] ?? 0);
              }
              expect(dot).toBeCloseTo(a === b ? 1 : 0, 6);
            }
          }
        }
      }
    }
  });
  test("camera position and requested lens intrinsics remain independent", () => {
    const near = { ...view, distance: 0.6 };
    expect(focalLength(near, 1280, 720)).toBe(focalLength(view, 1280, 720));
    expect(Math.hypot(...cameraOf(near).eye)).toBeCloseTo(0.6, 12);
    expect(Math.hypot(...cameraOf(view).eye)).toBeCloseTo(12.5, 12);
  });

  test("the panoramic lens preserves angles, a unit sightline and rear peripheral directions", () => {
    for (const distance of [12.5, 3, 1.001, 1, 0.999, 0.6, 0.02]) {
      const wide = { ...view, ...opticsAt(distance), distance };
      expect(cameraRay(wide, 1280, 720, 0.5, 0.5)).toEqual([0, 0, 1]);
      const top = cameraRay(wide, 1280, 720, 0.5, 0);
      expect(Math.acos(top[2] ?? 0)).toBeCloseTo(
        (wide.fov * Math.PI) / 360,
        10
      );
      for (const [x, y] of [
        [0, 0],
        [0.5, 0],
        [0.9, 0.6],
        [1, 1],
      ]) {
        const ray = cameraRay(wide, 1280, 720, x ?? 0, y ?? 0);
        expect(Math.hypot(...ray)).toBeCloseTo(1, 12);
        expect(cameraRay(wide, 2560, 1440, x ?? 0, y ?? 0)).toEqual(ray);
      }
    }
    const inside = { ...view, ...opticsAt(0.2) };
    expect(cameraRay(inside, 1280, 720, 1, 0.5)[2]).toBeLessThan(0);
    expect(opticsAt(3)).toEqual({ fov: 64, panorama: 0 });
    const before = opticsAt(1.001),
      after = opticsAt(0.999);
    expect(Math.abs(after.fov - before.fov)).toBeLessThan(0.2);
  });

  test("the physical shadow grows throughout the route without a lens zoom-out", () => {
    let previousShadow = 0;
    let previousFov = 64;
    let previousPanorama = 0;
    const routeLength = Math.log(START_RADIUS / END_RADIUS);
    for (let step = 0; step <= 512; step += 1) {
      const radius = START_RADIUS * Math.exp((-routeLength * step) / 512);
      const lens = opticsAt(radius);
      const rho = projectedShadowRadius(radius);
      expect(rho).toBeGreaterThan(previousShadow);
      expect(rho).toBeLessThan(0.95);
      expect(lens.fov).toBeGreaterThanOrEqual(previousFov - 1e-7);
      expect(lens.fov).toBeLessThanOrEqual(180);
      expect(lens.panorama).toBeGreaterThanOrEqual(previousPanorama);
      expect(lens.panorama).toBeLessThanOrEqual(1);
      previousShadow = rho;
      previousFov = lens.fov;
      previousPanorama = lens.panorama;
    }
    expect(projectedShadowRadius(3)).toBeCloseTo(0.719_334, 6);
    expect(projectedShadowRadius(1)).toBeGreaterThan(0.92);
    expect(projectedShadowRadius(END_RADIUS)).toBeCloseTo(0.95, 4);
    expect(opticsAt(END_RADIUS).fov).toBeLessThan(171);
    expect(opticsAt(END_RADIUS / 2)).toEqual(opticsAt(END_RADIUS));
  });

  test("lens opening matches the outer shadow velocity and remains smooth at the horizon", () => {
    const h = 1e-4;
    for (const radius of [3, 1]) {
      const before = radius * Math.exp(h);
      const after = radius * Math.exp(-h);
      const rhoBefore = projectedShadowRadius(before);
      const rhoAt = projectedShadowRadius(radius);
      const rhoAfter = projectedShadowRadius(after);
      expect((rhoAt - rhoBefore) / h).toBeCloseTo((rhoAfter - rhoAt) / h, 3);
      const fovBefore = opticsAt(before).fov;
      const fovAt = opticsAt(radius).fov;
      const fovAfter = opticsAt(after).fov;
      expect(Math.abs(fovAfter - 2 * fovAt + fovBefore) / h).toBeLessThan(0.03);
    }
    for (const radius of [START_RADIUS, 10, 5, 3]) {
      expect(opticsAt(radius)).toEqual({ fov: 64, panorama: 0 });
    }
  });
});
