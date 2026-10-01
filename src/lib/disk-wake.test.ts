import { describe, expect, test } from "bun:test";
import {
  createDiskWake,
  pickDisk,
  SPLASH_COUNT,
  WAKE_COUNT,
  WAVE_SPEED,
} from "./disk-wake";
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

  test("retains bounded history, emission timestamps and energy, and clears explicitly", () => {
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
    expect(Math.min(...births)).toBe(80 - WAKE_COUNT - hit.delay);
    wake.clear();
    expect(wake.count).toBe(0);
    expect(wake.data.every((value) => value === 0)).toBe(true);
    expect(wake.directions.every((value) => value === 0)).toBe(true);
    expect(wake.splashes.every((value) => value === 0)).toBe(true);
  });

  test("heated fragments are deterministic, finite and slower than their launching pressure front", () => {
    for (const impact of [false, true]) {
      const wake = createDiskWake();
      const repeat = createDiskWake();
      const hit = { angle: -0.5, delay: 10, radius: 6 };
      wake.push(hit, 8, 1.4, { impact });
      repeat.push(hit, 8, 1.4, { impact });
      expect(wake.splashes).toEqual(repeat.splashes);
      expect(wake.splashes.length).toBe(WAKE_COUNT * SPLASH_COUNT * 4);
      for (let i = 0; i < SPLASH_COUNT; i += 1) {
        const speed = Math.hypot(
          wake.splashes[i * 4] ?? 0,
          wake.splashes[i * 4 + 1] ?? 0
        );
        expect(speed).toBeGreaterThan(0);
        expect(speed).toBeLessThan(WAVE_SPEED);
        expect(wake.splashes[i * 4 + 2]).toBeGreaterThan(0);
      }
    }
  });

  test("cuts measure motion relative to the orbiting gas and preserve wrapped angular continuity", () => {
    const wake = createDiskWake();
    const radius = 6;
    const omega = Math.sqrt(0.5 / radius ** 3);
    wake.push({ angle: Math.PI - 0.01, delay: 10, radius }, 0, 1, {
      observedTime: 0,
      spin: -1,
    });
    wake.push({ angle: -Math.PI + 0.03, delay: 10, radius }, 0.1, 1, {
      observedTime: 0.1,
      spin: -1,
    });
    expect(wake.directions[4]).toBeCloseTo(0, 6);
    expect(wake.directions[5]).toBeCloseTo(1, 6);
    expect(wake.directions[6]).toBeCloseTo((0.04 - omega * 0.1) * radius, 6);
    const coMoving = createDiskWake();
    coMoving.push({ angle: 0, delay: 10, radius }, 0, 1);
    coMoving.push({ angle: omega * 0.1, delay: 10, radius }, 0.1, 1);
    expect(coMoving.directions[6]).toBeCloseTo(0, 6);
  });

  test("paused contacts, image jumps and clicks do not connect unrelated material patches", () => {
    for (const second of [
      { angle: 0.01, delay: 10, observedTime: 4, radius: 6.1 },
      { angle: 2, delay: 15, observedTime: 0.1, radius: 10 },
    ]) {
      const wake = createDiskWake();
      wake.push({ angle: 0, delay: 10, radius: 6 }, 0, 1);
      wake.push(second, 0.1, 1, { observedTime: second.observedTime });
      expect(wake.directions[6]).toBe(0);
      expect(
        Math.hypot(wake.directions[4] ?? 0, wake.directions[5] ?? 0)
      ).toBeCloseTo(1, 6);
    }
    const wake = createDiskWake();
    const hit = { angle: 0, delay: 10, radius: 6 };
    wake.push(hit, 0, 1);
    wake.push({ ...hit, angle: 0.05 }, 0.1, 1, { impact: true });
    expect(wake.directions[6]).toBe(0);
    expect(wake.directions[7]).toBe(0);
    wake.push({ ...hit, angle: 0.06 }, 0.2, 1);
    expect(wake.directions[10]).toBe(0);
    expect(wake.directions[11]).toBe(1);
  });
});
