import { describe, expect, test } from "bun:test";

import { CRITICAL_B, geodesicTable, rowImpact } from "./geodesics";

/** Light round a Schwarzschild hole, checked against what is known of it (r_s = 1). */

const FAR = 1e6;
const table = geodesicTable({ distance: FAR });

const rowOf = (wanted: number) => {
  let best = 0;
  for (let row = 0; row < table.rows; row += 1) {
    const b = rowImpact(row, table.rows, table.below, table.bMax);
    if (
      Math.abs(b - wanted) <
      Math.abs(rowImpact(best, table.rows, table.below, table.bMax) - wanted)
    ) {
      best = row;
    }
  }
  return best;
};

describe("geodesics", () => {
  test("a ray passing far bends as Einstein said, with the second-order term", () => {
    const row = table.rows - 1;
    const b = rowImpact(row, table.rows, table.below, table.bMax);
    const bend = (table.ends[row] ?? 0) - Math.PI;
    // 4M/b + 15π/4·(M/b)², with M = 1/2.
    const expected = 2 / b + ((15 * Math.PI) / 4) * (0.5 / b) ** 2;
    expect(bend).toBeGreaterThan(0);
    expect(Math.abs(bend - expected)).toBeLessThan(1e-3);
  });

  test("rays under the photon sphere fall in, rays over it get away", () => {
    const under = rowOf(CRITICAL_B * 0.9);
    const over = rowOf(CRITICAL_B * 1.2);
    expect(table.ends[under]).toBeLessThan(0);
    expect(table.ends[over]).toBeGreaterThan(0);
  });

  test("a ray just over the photon sphere winds round it more than once", () => {
    const row = rowOf(CRITICAL_B + 1e-4);
    expect(Math.abs(table.ends[row] ?? 0)).toBeGreaterThan(2 * Math.PI);
  });

  test("rows are squeezed towards the photon sphere from both sides", () => {
    const step = (row: number) =>
      rowImpact(row + 1, table.rows, table.below, table.bMax) -
      rowImpact(row, table.rows, table.below, table.bMax);
    expect(step(table.below)).toBeLessThan(step(table.rows - 2) / 1000);
    expect(step(table.below - 2)).toBeLessThan(step(0));
  });
});
