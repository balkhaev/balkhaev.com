import { expect, test } from "bun:test";
import {
  angleRow,
  columnPhi,
  infallDelay,
  infallTable,
  pgClock,
  rainRay,
  rowAngle,
  shadowAngle,
} from "./infall-geodesics";

test("sky frequency shift agrees with independent static-frame gravity and Lorentz factors", () => {
  for (const radius of [12.5, 5, 2, 1.001]) {
    const velocity = 1 / Math.sqrt(radius);
    const lapse = 1 - 1 / radius;
    for (const cosine of [-0.5, 0, 0.5, 0.95]) {
      const angle = Math.acos(-cosine);
      const ray = rainRay(radius, angle);
      const staticCosine = (cosine + velocity) / (1 + velocity * cosine);
      const gravity = 1 / Math.sqrt(lapse);
      const lorentz =
        (1 - velocity * staticCosine) / Math.sqrt(1 - velocity ** 2);
      expect(1 / ray.energy).toBeCloseTo(gravity * lorentz, 8);
    }
  }
});

test("sky redshift is continuous across the horizon and increases when looking behind during infall", () => {
  const ratios = [12.5, 5, 2, 1.001, 1, 0.999, 0.5].map(
    (radius) => 1 / rainRay(radius, Math.acos(-0.95)).energy
  );
  for (let i = 1; i < ratios.length; i += 1) {
    expect(ratios[i] ?? 0).toBeLessThan(ratios[i - 1] ?? 0);
  }
  expect(Math.abs((ratios[3] ?? 0) - (ratios[5] ?? 0))).toBeLessThan(0.001);
});

test("initial photon momentum is null and has unit frequency in the falling observer frame", () => {
  for (const r of [12.5, 3, 1.001, 1, 0.999, 0.2, 0.02]) {
    for (const angle of [0.03, 0.5, 1.5, 3]) {
      const ray = rainRay(r, angle);
      const flow = 1 / Math.sqrt(r);
      const kt = -1;
      const kr = -ray.angular * ray.slope;
      const tangent = ray.angular / r;
      expect(
        -(1 - 1 / r) * kt * kt +
          2 * flow * kt * kr +
          kr * kr +
          tangent * tangent
      ).toBeCloseTo(0, 10);
      expect(ray.energy - flow * (kr + flow * kt)).toBeCloseTo(1, 10);
    }
  }
});

test("escape cone and tabulation stay finite and continuous through the horizon", () => {
  let previousEnd = 0;
  for (const r of [1.001, 1, 0.999]) {
    const table = infallTable(r);
    const under = Math.floor(angleRow(shadowAngle(r) - 0.08, table));
    const over = Math.ceil(angleRow(shadowAngle(r) + 0.08, table));
    expect(table.ends[under]).toBeLessThan(0);
    expect(table.ends[over]).toBeGreaterThan(0);
    expect(table.u.every(Number.isFinite)).toBe(true);
    expect(table.times.every(Number.isFinite)).toBe(true);
    const outward = Math.floor(angleRow(2, table));
    const end = table.ends[outward] ?? 0;
    expect(end).toBeGreaterThan(0);
    if (previousEnd) {
      expect(Math.abs(end - previousEnd)).toBeLessThan(0.01);
    }
    previousEnd = end;
  }
  expect(pgClock(1, -2, 2)).toBeCloseTo(1.25, 12);
});

test("light from outside reaches an interior observer with the correct regular travel time", () => {
  for (const radius of [0.8, 0.02]) {
    const table = infallTable(radius);
    const row = Math.floor(angleRow(2.4, table));
    const ray = rainRay(table.distance, rowAngle(row, table));
    const integrand = (r: number) => {
      const radial = Math.sqrt(
        ray.energy ** 2 - ((1 - 1 / r) * ray.angular ** 2) / r ** 2
      );
      return (
        (ray.energy ** 2 + ray.angular ** 2 / r ** 3) /
        (radial * (ray.energy + radial / Math.sqrt(r)))
      );
    };
    for (const emitterRadius of [10, 32]) {
      const steps = 10_000,
        h = (emitterRadius - table.distance) / steps;
      let expected = integrand(table.distance) + integrand(emitterRadius);
      for (let k = 1; k < steps; k += 1) {
        expected += integrand(table.distance + k * h) * (k % 2 ? 4 : 2);
      }
      expected *= h / 3;
      const offset = row * table.phiCount;
      let column = 1;
      while ((table.u[offset + column] ?? 0) > 1 / emitterRadius) {
        column += 1;
      }
      const a = table.u[offset + column - 1] ?? 0,
        b = table.u[offset + column] ?? 0;
      const fraction = (1 / emitterRadius - a) / (b - a);
      const phi = columnPhi(
        column - 1 + fraction,
        table.ends[row] ?? 0,
        table.phiCount
      );
      expect(Math.abs(infallDelay(table, row, phi) - expected)).toBeLessThan(
        0.001
      );
    }
  }
});

test("deep interior rays preserve the visible external sky and agree with independent angular quadrature", () => {
  const table = infallTable(0.02);
  expect(table.u.every(Number.isFinite)).toBe(true);
  expect(table.times.every(Number.isFinite)).toBe(true);
  expect(shadowAngle(table.distance)).toBeGreaterThan(1.4);
  expect(shadowAngle(table.distance)).toBeLessThan(Math.PI / 2);
  // Rear sources can have higher-order images in the forward hemisphere; no camera flip is involved.
  const rearAhead = [...table.ends].some(
    (end, row) =>
      end > 2 * Math.PI &&
      Math.cos(end) > 0.8 &&
      rowAngle(row, table) < Math.PI / 2
  );
  expect(rearAhead).toBe(true);
  for (const degrees of [83, 100, 140]) {
    const row = Math.ceil(angleRow((degrees * Math.PI) / 180, table));
    const ray = rainRay(table.distance, rowAngle(row, table));
    const k = ray.energy / ray.angular;
    // dφ/du from the Schwarzschild null first integral, independent of the RK orbit equation.
    const integrand = (u: number) => 1 / Math.sqrt(k * k - u * u + u * u * u);
    const steps = 10_000;
    const h = ray.u / steps;
    let angle = integrand(0) + integrand(ray.u);
    for (let i = 1; i < steps; i += 1) {
      angle += integrand(i * h) * (i % 2 ? 4 : 2);
    }
    angle *= h / 3;
    expect(table.ends[row]).toBeGreaterThan(0);
    expect(Math.abs((table.ends[row] ?? 0) - angle)).toBeLessThan(0.0001);
  }
});

test("all future photon directions move to smaller radius inside the horizon", () => {
  for (const radius of [0.999, 0.5, 0.02]) {
    for (const angle of [0.0001, 0.5, Math.PI / 2, 2.5, Math.PI - 0.0001]) {
      const ray = rainRay(radius, angle);
      expect(ray.angular * ray.slope).toBeLessThan(0);
    }
  }
});
