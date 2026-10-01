import { expect, test } from "bun:test";
import {
  createDistantSky,
  firstSkyRow,
  skyImage,
  skySolidAngle,
} from "./distant-sky";
import { infallTable, rainRay } from "./infall-geodesics";

test("the catalogue is fixed at infinity and samples sky area rather than cube coordinates", () => {
  const data = createDistantSky();
  expect(data).toEqual(createDistantSky());
  expect(data.length / 5).toBeGreaterThan(1000);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let at = 0; at < data.length; at += 5) {
    const x = data[at] ?? 0,
      y = data[at + 1] ?? 0,
      z = data[at + 2] ?? 0;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(data[at + 3]).toBeGreaterThan(0);
    expect(data[at + 4]).toBeGreaterThanOrEqual(3200);
    expect(data[at + 4]).toBeLessThanOrEqual(14_000);
    const axis = [x, y, z]
      .map(Math.abs)
      .indexOf(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)));
    const face = axis * 2 + (([x, y, z][axis] ?? 0) < 0 ? 1 : 0);
    counts[face] = (counts[face] ?? 0) + 1;
  }
  expect(Math.min(...counts)).toBeGreaterThan(150);
  let area = 0;
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      area += skySolidAngle(x, y, 32);
    }
  }
  expect(area * 6).toBeCloseTo(4 * Math.PI, 12);
  expect(skySolidAngle(0, 0, 32)).toBeLessThan(skySolidAngle(16, 16, 32));
});

function quadrature(radius: number, angle: number) {
  const ray = rainRay(radius, angle);
  const k = ray.energy / ray.angular;
  const integrand = (u: number) => 1 / Math.sqrt(k * k - u * u + u * u * u);
  const integrate = (from: number, to: number) => {
    const steps = 20_000,
      h = (to - from) / steps;
    let total = integrand(from) + integrand(to);
    for (let i = 1; i < steps; i += 1) {
      total += integrand(from + i * h) * (i % 2 ? 4 : 2);
    }
    return (total * h) / 3;
  };
  // Resolve the photon-sphere peak separately from the long high-u interior tail.
  const split = Math.min(2, ray.u);
  return integrate(0, split) + (ray.u > split ? integrate(split, ray.u) : 0);
}

test("projected sky images agree with the independent null first integral inside the horizon", () => {
  for (const radius of [0.8, 0.02]) {
    const table = infallTable(radius);
    const first = firstSkyRow(table);
    expect(first).toBeGreaterThan(table.below);
    for (let row = first + 1; row < table.rows; row += 1) {
      expect(table.ends[row]).toBeLessThan(table.ends[row - 1] ?? 0);
    }
    for (const phi of [0.4, 1.2, 2.8, 5]) {
      const image = skyImage(table, phi);
      expect(image).not.toBeNull();
      if (!image) {
        continue;
      }
      const error = Math.abs(quadrature(radius, image.angle) - phi);
      expect(error).toBeLessThan(phi > 3 ? 0.05 : 0.005);
      expect(rainRay(radius, image.angle).energy).toBeGreaterThan(0);
    }
    expect(skyImage(table, 20)).toBeNull();
  }
});

test("opposite image parities preserve a rear source while winding places its image ahead", () => {
  const table = infallTable(0.02);
  const beta = 0.3;
  const direct = skyImage(table, beta);
  const reverse = skyImage(table, 2 * Math.PI - beta);
  const wound = skyImage(table, 2 * Math.PI + beta);
  expect(direct?.angle).toBeGreaterThan(Math.PI / 2);
  expect(reverse?.angle).toBeLessThan(Math.PI / 2);
  expect(wound?.angle).toBeLessThan(Math.PI / 2);
  for (const [phi, parity] of [
    [beta, 1],
    [2 * Math.PI - beta, -1],
    [2 * Math.PI + beta, 1],
  ]) {
    expect(Math.cos(phi ?? 0)).toBeCloseTo(Math.cos(beta), 12);
    expect(Math.sin(phi ?? 0) * (parity ?? 1)).toBeCloseTo(Math.sin(beta), 12);
  }
});

test("point-source magnification uses the Jacobian of the actual escape map", () => {
  for (const radius of [12.5, 1.001, 1, 0.999, 0.02]) {
    const table = infallTable(radius);
    for (const phi of [0.731, 2.313, 6.23]) {
      const image = skyImage(table, phi);
      const a = skyImage(table, phi - 1e-5);
      const b = skyImage(table, phi + 1e-5);
      if (!(image && a && b)) {
        throw new Error("missing escaping image");
      }
      const inverseDerivative = (b.angle - a.angle) / 2e-5;
      expect(image.derivative * inverseDerivative).toBeCloseTo(1, 5);
      const gain =
        Math.sin(image.angle) / Math.abs(Math.sin(phi) * image.derivative);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThan(0);
    }
  }
});
