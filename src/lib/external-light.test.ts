import { expect, test } from "bun:test";
import {
  createExternalLightCatalogue,
  EXTERNAL_LIGHT_LAPSE,
  EXTERNAL_LIGHT_RADIUS,
  EXTERNAL_LIGHT_STRIDE,
  externalLightVariation,
} from "./external-light";

test("finite variable sources are deterministic world landmarks with valid proper clocks", () => {
  const data = createExternalLightCatalogue();
  expect(data).toEqual(createExternalLightCatalogue());
  expect(data.length / EXTERNAL_LIGHT_STRIDE).toBe(10);
  expect(EXTERNAL_LIGHT_RADIUS).toBeGreaterThan(12.5);
  expect(EXTERNAL_LIGHT_LAPSE ** 2).toBeCloseTo(
    1 - 1 / EXTERNAL_LIGHT_RADIUS,
    12
  );
  const periods = new Set<number>();
  for (let at = 0; at < data.length; at += EXTERNAL_LIGHT_STRIDE) {
    expect(
      Math.hypot(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0)
    ).toBeCloseTo(1, 6);
    expect(data[at + 3]).toBeGreaterThan(0);
    expect(data[at + 4]).toBeGreaterThanOrEqual(4800);
    expect(data[at + 4]).toBeLessThanOrEqual(11_200);
    expect(data[at + 5]).toBeGreaterThanOrEqual(9);
    expect(data[at + 5]).toBeLessThanOrEqual(19);
    expect(data[at + 6]).toBeGreaterThanOrEqual(0);
    expect(data[at + 6]).toBeLessThan(1);
    periods.add(data[at + 5] ?? 0);
  }
  expect(periods.size).toBe(10);
});

test("one continuous source history gives delayed image echoes without changing the global epoch", () => {
  const period = 12.9;
  const directDelay = 48.2;
  const woundDelay = directDelay + 7.3;
  for (const epoch of [-100, 0, 40, 100, 1000]) {
    const wound = externalLightVariation(
      EXTERNAL_LIGHT_LAPSE * (epoch - woundDelay),
      period,
      0.17
    );
    const directAtEarlierArrival = externalLightVariation(
      EXTERNAL_LIGHT_LAPSE * (epoch - (woundDelay - directDelay) - directDelay),
      period,
      0.17
    );
    expect(wound).toBeCloseTo(directAtEarlierArrival, 10);
    expect(
      externalLightVariation(
        EXTERNAL_LIGHT_LAPSE * (epoch - directDelay) + period,
        period,
        0.17
      )
    ).toBeCloseTo(
      externalLightVariation(
        EXTERNAL_LIGHT_LAPSE * (epoch - directDelay),
        period,
        0.17
      ),
      10
    );
  }
});

test("variable source light curves remain finite, positive and smooth through negative epochs and cycle seams", () => {
  let previous = externalLightVariation(-36, 9, 0.31);
  let low = previous;
  let high = previous;
  for (let i = 1; i <= 7200; i += 1) {
    const current = externalLightVariation(-36 + i / 100, 9, 0.31);
    expect(Number.isFinite(current)).toBe(true);
    expect(current).toBeGreaterThanOrEqual(0.32);
    expect(current).toBeLessThan(2.85);
    expect(Math.abs(current - previous)).toBeLessThan(0.025);
    previous = current;
    low = Math.min(low, current);
    high = Math.max(high, current);
  }
  expect(high / low).toBeGreaterThan(5);
});
