import { expect, test } from "bun:test";
import {
  angleRow,
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
  for (const r of [12.5, 3, 1.001, 1, 0.999, 0.2]) {
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
  const table = infallTable(0.8);
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
  const steps = 4000,
    h = (10 - table.distance) / steps;
  let expected = integrand(table.distance) + integrand(10);
  for (let k = 1; k < steps; k += 1) {
    expected += integrand(table.distance + k * h) * (k % 2 ? 4 : 2);
  }
  expected *= h / 3;
  const offset = row * table.phiCount;
  let column = 1;
  while ((table.u[offset + column] ?? 0) > 0.1) {
    column += 1;
  }
  const a = table.u[offset + column - 1] ?? 0,
    b = table.u[offset + column] ?? 0;
  const fraction = (0.1 - a) / (b - a);
  const start = table.times[offset + column - 1] ?? 0,
    end = table.times[offset + column] ?? 0;
  expect(Math.abs(start + fraction * (end - start) - expected)).toBeLessThan(
    0.01
  );
});
