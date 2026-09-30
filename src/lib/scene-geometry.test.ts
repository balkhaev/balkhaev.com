import { describe, expect, test } from "bun:test";
import { infallTable } from "./infall-geodesics";
import {
  CONTACTS,
  cameraOf,
  contactHit,
  contactPosition,
  focalLength,
  OBSERVER_RADIUS,
  orbitRate,
  type SceneView,
} from "./scene-geometry";

const table = infallTable(OBSERVER_RADIUS);
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
  test("contact surfaces and their orbits remain outside the disk", () => {
    for (const [index, body] of CONTACTS.entries()) {
      expect(
        body.radius - Math.hypot(body.width, body.height) / 2
      ).toBeGreaterThan(11);
      const period = (2 * Math.PI) / orbitRate(body.radius);
      for (const fraction of [0, 0.25, 0.5, 1]) {
        const point = contactPosition(index, period * fraction);
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(
          body.radius,
          10
        );
      }
    }
    const [a, b] = CONTACTS;
    expect(b.radius - a.radius).toBeGreaterThan(
      (Math.hypot(a.width, a.height) + Math.hypot(b.width, b.height)) / 2
    );
  });
  test("both initial contact images can be picked with curved rays; the shadow is empty", () => {
    const found = new Set<number>();
    for (let y = 0; y < 720; y += 6) {
      for (let x = 0; x < 1280; x += 6) {
        const hit = contactHit(table, view, 1280, 720, x, y, 0);
        if (hit >= 0) {
          found.add(hit);
        }
      }
    }
    expect([...found].sort()).toEqual([0, 1]);
    expect(contactHit(table, view, 1280, 720, 640, 360, 0)).toBe(-1);
  });
});
