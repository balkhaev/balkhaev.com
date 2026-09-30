import { describe, expect, test } from "bun:test";
import { geodesicTable, rowImpact } from "./geodesics";
import {
  CONTACTS,
  cameraOf,
  contactHit,
  contactPosition,
  fittedSize,
  OBSERVER_RADIUS,
  orbitRate,
  type SceneView,
} from "./scene-geometry";

const table = geodesicTable({
  bMax: 60.5,
  distance: OBSERVER_RADIUS,
  phiCount: 1024,
});
const view: SceneView = {
  azimuth: 0,
  inclination: 76,
  roll: -8,
  size: 2.598 / 25,
  x: 0.5,
  y: 0.5,
};

describe("one Schwarzschild scene", () => {
  test("observer basis stays orthonormal over the full supported camera range", () => {
    for (const inclination of [28, 78, 90, 152]) {
      for (const azimuth of [-65, 0, 65]) {
        const { basis, eye } = cameraOf({ ...view, azimuth, inclination });
        expect(Math.hypot(...eye)).toBeCloseTo(OBSERVER_RADIUS, 9);
        for (let a = 0; a < 3; a += 1) {
          for (let b = 0; b < 3; b += 1) {
            let product = 0;
            for (let k = 0; k < 3; k += 1) {
              product += (basis[a * 3 + k] ?? 0) * (basis[b * 3 + k] ?? 0);
            }
            expect(product).toBeCloseTo(a === b ? 1 : 0, 6);
          }
        }
      }
    }
  });

  test("contact orbits conserve radius and the full surfaces clear the gas disk", () => {
    for (const [index, body] of CONTACTS.entries()) {
      expect(
        body.radius - Math.hypot(body.width, body.height) / 2
      ).toBeGreaterThan(11);
      const period = (2 * Math.PI) / orbitRate(body.radius);
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const point = contactPosition(index, period * fraction);
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(
          body.radius,
          10
        );
      }
      const start = contactPosition(index, 0),
        end = contactPosition(index, period);
      expect(end.x).toBeCloseTo(start.x, 10);
      expect(end.y).toBeCloseTo(start.y, 10);
    }
    expect(orbitRate(12) / orbitRate(24)).toBeCloseTo(Math.sqrt(8), 10);
    const [inner, outer] = CONTACTS;
    expect(outer.radius - inner.radius).toBeGreaterThan(
      Math.hypot(inner.width, inner.height) / 2 +
        Math.hypot(outer.width, outer.height) / 2
    );
  });

  test("integrated light travel time agrees with independent radial quadrature", () => {
    let row = table.below;
    while (rowImpact(row, table.rows, table.below, table.bMax) < 8) {
      row += 1;
    }
    const b = rowImpact(row, table.rows, table.below, table.bMax);
    const integrand = (r: number) =>
      1 / ((1 - 1 / r) * Math.sqrt(1 - ((b * b) / (r * r)) * (1 - 1 / r)));
    const steps = 2000,
      h = (60 - 20) / steps;
    let sum = integrand(20) + integrand(60);
    for (let k = 1; k < steps; k += 1) {
      sum += integrand(20 + k * h) * (k % 2 ? 4 : 2);
    }
    const expected = (sum * h) / 3;
    let column = 1;
    const offset = row * table.phiCount;
    while ((table.u[offset + column] ?? 0) < 1 / 20) {
      column += 1;
    }
    const before = table.u[offset + column - 1] ?? 0,
      after = table.u[offset + column] ?? 1;
    const fraction = (1 / 20 - before) / (after - before);
    const a = table.times[offset + column - 1] ?? 0,
      c = table.times[offset + column] ?? 0;
    const actual = a + fraction * (c - a);
    expect(actual).toBeGreaterThan(40);
    expect(Math.abs(actual - expected)).toBeLessThan(0.03);
  });

  test("both initial light images can be picked on desktop and mobile; empty space cannot", () => {
    for (const [width, height] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      const framed = {
        ...view,
        size: fittedSize(view, width, height, 0),
      };
      const found = new Set<number>();
      for (let y = 0; y < height; y += 7) {
        for (let x = 0; x < width; x += 7) {
          const hit = contactHit(table, framed, width, height, x, y, 0);
          if (hit >= 0) {
            found.add(hit);
          }
        }
      }
      expect([...found].sort()).toEqual([0, 1]);
      expect(
        contactHit(table, framed, width, height, width * 0.5, height * 0.5, 0)
      ).toBe(-1);
      expect(contactHit(table, framed, width, height, 0, 0, 0)).toBe(-1);
    }
  });

  test("explicit optical reframing finds both moving primary surfaces on a narrow screen", () => {
    const width = 390,
      height = 844;
    for (const time of [40, 100, 180, 270, 400, 550, 720]) {
      const framed = { ...view, size: fittedSize(view, width, height, time) };
      const found = new Set<number>();
      for (let y = 10; y < height - 10; y += 5) {
        for (let x = 10; x < width - 10; x += 5) {
          const hit = contactHit(table, framed, width, height, x, y, time, 1);
          if (hit >= 0) {
            found.add(hit);
          }
        }
      }
      expect([...found].sort()).toEqual([0, 1]);
    }
  });
});
