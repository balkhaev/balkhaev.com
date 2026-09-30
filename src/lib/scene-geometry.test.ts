import { describe, expect, test } from "bun:test";
import {
  cameraOf,
  focalLength,
  OBSERVER_RADIUS,
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
  test("flight changes position while the lens stays fixed", () => {
    const near = { ...view, distance: 0.6 };
    expect(focalLength(near, 1280, 720)).toBe(focalLength(view, 1280, 720));
    expect(Math.hypot(...cameraOf(near).eye)).toBeCloseTo(0.6, 12);
    expect(Math.hypot(...cameraOf(view).eye)).toBeCloseTo(12.5, 12);
  });
});
