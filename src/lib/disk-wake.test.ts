import { describe, expect, test } from "bun:test";
import { createDiskWake, pickDisk, WAKE_COUNT } from "./disk-wake";
import { infallTable } from "./infall-geodesics";
import type { SceneView } from "./scene-geometry";

const view: SceneView = {
  distance: 12.5,
  fov: 64,
  pitch: 0,
  roll: 0,
  x: 0.5,
  y: 0.5,
  yaw: 0,
};

describe("disk interaction", () => {
  test("picks mirrored disk intersections with the same light-travel time, rejecting empty sky and shadow", () => {
    const table = infallTable(view.distance);
    expect(pickDisk(table, view, 1280, 720, 0.5, 0.5)).toBeNull();
    expect(pickDisk(table, view, 1280, 720, 0.2, 0.1)).toBeNull();
    const a = pickDisk(table, view, 1280, 720, 0.3, 0.6);
    const b = pickDisk(table, view, 1280, 720, 0.7, 0.6);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!(a && b)) {
      throw new Error("Expected disk intersections");
    }
    expect(a.radius).toBeCloseTo(b.radius, 6);
    expect(a.delay).toBeCloseTo(b.delay, 6);
    expect(a.angle + b.angle).toBeCloseTo(-Math.PI, 6);
    const scaled = pickDisk(table, view, 2560, 1440, 0.3, 0.6);
    expect(scaled).toEqual(a);
    const turned = pickDisk(table, { ...view, yaw: 360 }, 1280, 720, 0.3, 0.6);
    expect(turned?.radius).toBeCloseTo(a.radius, 6);
  });

  test("retains bounded history, emission timestamps and energy, and clears on restart", () => {
    const wake = createDiskWake();
    const hit = { angle: -0.5, delay: 10, radius: 6 };
    for (let i = 0; i < 80; i += 1) {
      wake.push(hit, i - hit.delay, i);
    }
    expect(wake.count).toBe(WAKE_COUNT);
    expect(wake.data.length).toBe(WAKE_COUNT * 4);
    const births: number[] = [];
    for (let i = 0; i < WAKE_COUNT; i += 1) {
      births.push(wake.data[i * 4 + 2] ?? 0);
      expect(wake.data[i * 4 + 3]).toBeLessThanOrEqual(1.5);
    }
    expect(Math.min(...births)).toBe(54);
    wake.clear();
    expect(wake.count).toBe(0);
    expect(wake.data.every((value) => value === 0)).toBe(true);
  });
});
