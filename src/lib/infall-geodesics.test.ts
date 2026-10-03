import { expect, test } from "bun:test";
import {
  angleRow,
  columnPhi,
  createFiniteSkyMap,
  infallDelay,
  infallTable,
  pgClock,
  radialClock,
  rainRay,
  rowAngle,
  shadowAngle,
} from "./infall-geodesics";

function directLightQuadrature(
  radius: number,
  angle: number,
  sourceRadius: number
) {
  const ray = rainRay(radius, angle);
  const integrands = (logRadius: number) => {
    const r = Math.exp(logRadius);
    const radial = Math.sqrt(
      ray.energy ** 2 - ((1 - 1 / r) * ray.angular ** 2) / r ** 2
    );
    return {
      angle: ray.angular / (r * radial),
      time:
        (r * (ray.energy ** 2 + ray.angular ** 2 / r ** 3)) /
        (radial * (ray.energy + radial / Math.sqrt(r))),
    };
  };
  const steps = 4096;
  const start = Math.log(radius);
  const end = Math.log(sourceRadius);
  const h = (end - start) / steps;
  const first = integrands(start);
  const last = integrands(end);
  let phi = first.angle + last.angle;
  let delay = first.time + last.time;
  for (let step = 1; step < steps; step += 1) {
    const sample = integrands(start + step * h);
    const weight = step % 2 ? 4 : 2;
    phi += sample.angle * weight;
    delay += sample.time * weight;
  }
  return { delay: (delay * h) / 3, phi: (phi * h) / 3 };
}

function finiteImage(table: ReturnType<typeof infallTable>, sourcePhi: number) {
  const map = createFiniteSkyMap(table, 60);
  let low = map.firstValidRow;
  let high = table.rows - 1;
  if ((map.data[low * 4] ?? 0) < sourcePhi) {
    throw new Error("Requested image exceeds the retained winding count.");
  }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((map.data[middle * 4] ?? 0) > sourcePhi) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = map.data[low * 4] ?? 0;
  const b = map.data[high * 4] ?? 0;
  const fraction = (sourcePhi - a) / (b - a);
  const delayA = map.data[low * 4 + 1] ?? 0;
  const delayB = map.data[high * 4 + 1] ?? 0;
  return {
    angle: rowAngle(low + fraction, table),
    delay: delayA + (delayB - delayA) * fraction,
  };
}

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

test("regular exterior escape segments agree with independent angular and PG-time quadrature", () => {
  for (const radius of [12.5, 3, 1.001]) {
    // A coarse output grid also checks that long winding segments retain bounded substeps.
    const phiCount = radius < 2 ? 64 : 512;
    const table = infallTable(radius, {
      below: 160,
      critical: 0,
      distance: radius,
      ends: new Float32Array(512),
      phiCount,
      rows: 512,
      times: new Float32Array(512 * phiCount),
      u: new Float32Array(512 * phiCount),
    });
    // Include a near-critical ray that spends several radians around the photon sphere.
    const row = radius < 2 ? table.below + 4 : Math.floor(angleRow(2.4, table));
    const ray = rainRay(radius, rowAngle(row, table));
    const end = table.ends[row] ?? 0;
    expect(end).toBeGreaterThan(0);
    expect(ray.slope).toBeLessThan(0);
    for (const fraction of [0.35, 0.59, 0.78]) {
      const column = Math.round(fraction * (table.phiCount - 1));
      const emitterRadius = 1 / (table.u[row * table.phiCount + column] ?? 0);
      // Schwarzschild's null first integral determines both derivatives independently
      // of the RK orbit equation and the residual-clock integrator used by the table.
      const integrands = (r: number) => {
        const radial = Math.sqrt(
          ray.energy ** 2 - ((1 - 1 / r) * ray.angular ** 2) / r ** 2
        );
        return {
          angle: ray.angular / (r * r * radial),
          time:
            (ray.energy ** 2 + ray.angular ** 2 / r ** 3) /
            (radial * (ray.energy + radial / Math.sqrt(r))),
        };
      };
      const steps = 50_000;
      const h = (emitterRadius - radius) / steps;
      const first = integrands(radius);
      const last = integrands(emitterRadius);
      let angle = first.angle + last.angle;
      let time = first.time + last.time;
      for (let step = 1; step < steps; step += 1) {
        const sample = integrands(radius + step * h);
        const weight = step % 2 ? 4 : 2;
        angle += sample.angle * weight;
        time += sample.time * weight;
      }
      const phi = columnPhi(column, end, table.phiCount);
      const tolerance = radius < 2 ? 1e-5 : 2e-6;
      expect(Math.abs(phi - (angle * h) / 3)).toBeLessThan(tolerance);
      expect(
        Math.abs(infallDelay(table, row, phi) - (time * h) / 3)
      ).toBeLessThan(tolerance);
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

test("finite source maps share the null path and PG delay verified by independent quadrature", () => {
  for (const radius of [12.5, 1, 0.02]) {
    const table = infallTable(radius);
    const row = Math.floor(angleRow(2.4, table));
    const angle = rowAngle(row, table);
    for (const sourceRadius of [40, 60, 80]) {
      const map = createFiniteSkyMap(table, sourceRadius);
      const expected = directLightQuadrature(radius, angle, sourceRadius);
      expect(Math.abs((map.data[row * 4] ?? 0) - expected.phi)).toBeLessThan(
        0.0001
      );
      expect(
        Math.abs((map.data[row * 4 + 1] ?? 0) - expected.delay)
      ).toBeLessThan(0.001);
      expect(map.sourceRadius).toBe(sourceRadius);
      expect(map.firstValidRow).toBeGreaterThanOrEqual(table.below);
      for (let captured = 0; captured < map.firstValidRow; captured += 1) {
        expect(map.data[captured * 4]).toBe(-1);
      }
      const final = (table.rows - 1) * 4;
      expect(map.data[final]).toBe(0);
      expect(map.data[final + 1]).toBeCloseTo(
        radialClock(sourceRadius) - radialClock(radius),
        4
      );
    }
  }
});

test("finite sphere angular derivatives follow the independently integrated source map", () => {
  const table = infallTable(0.25);
  const map = createFiniteSkyMap(table, 60);
  const row = Math.floor(angleRow(2.4, table));
  const angle = rowAngle(row, table);
  const h = 1e-5;
  const a = directLightQuadrature(table.distance, angle - h, 60).phi;
  const b = directLightQuadrature(table.distance, angle + h, 60).phi;
  const expectedDerivative = (b - a) / (2 * h);
  const actualDerivative = map.data[row * 4 + 2] ?? 0;
  expect(actualDerivative).toBeLessThan(0);
  expect(Math.abs(actualDerivative / expectedDerivative - 1)).toBeLessThan(
    0.005
  );
  for (let at = map.firstValidRow + 1; at < table.rows; at += 1) {
    expect(map.data[at * 4]).toBeLessThan(map.data[(at - 1) * 4] ?? 0);
    expect(map.data[at * 4 + 1]).toBeGreaterThan(0);
    expect(map.data[at * 4 + 2]).toBeLessThan(0);
  }
});

test("one finite variable source has delayed opposite-parity and winding images", () => {
  const table = infallTable(1);
  const direct = finiteImage(table, 0.6);
  const opposite = finiteImage(table, 2 * Math.PI - 0.6);
  const winding = finiteImage(table, 2 * Math.PI + 0.6);
  expect(direct.angle).toBeGreaterThan(opposite.angle);
  expect(opposite.angle).toBeGreaterThan(winding.angle);
  expect(opposite.delay).toBeGreaterThan(direct.delay);
  expect(winding.delay).toBeGreaterThan(opposite.delay);
  // Every image reads one source phase at its own T-delay, with no per-image time warp.
  const observerEpoch = 100;
  expect(observerEpoch - opposite.delay).toBeLessThan(
    observerEpoch - direct.delay
  );
  expect(observerEpoch - winding.delay).toBeLessThan(
    observerEpoch - opposite.delay
  );
});

test("a finite static source's retarded clock derivative agrees with g along an actual rain worldline", () => {
  const radius = 1;
  const table = infallTable(radius);
  const row = Math.floor(angleRow(2.4, table));
  const map = createFiniteSkyMap(table, 60);
  const sourcePhi = map.data[row * 4] ?? 0;
  const image = finiteImage(table, sourcePhi);
  const h = 0.002;
  const rAt = (tau: number) => (radius ** 1.5 - 1.5 * tau) ** (2 / 3);
  const before = finiteImage(infallTable(rAt(-h)), sourcePhi);
  const after = finiteImage(infallTable(rAt(h)), sourcePhi);
  const sourceLapse = Math.sqrt(1 - 1 / 60);
  const emittedBefore = sourceLapse * (-h - before.delay);
  const emittedAfter = sourceLapse * (h - after.delay);
  const measured = (emittedAfter - emittedBefore) / (2 * h);
  const expected =
    sourceLapse / (1 - Math.cos(image.angle) / Math.sqrt(radius));
  expect(Math.abs(measured - expected)).toBeLessThan(0.005);
});

test("finite maps reject an emitting sphere inside the observer or at a static horizon", () => {
  const table = infallTable(3);
  for (const radius of [0.5, 1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => createFiniteSkyMap(table, radius)).toThrow(RangeError);
  }
});
