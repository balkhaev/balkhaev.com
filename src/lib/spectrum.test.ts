import { expect, test } from "bun:test";
import {
  blackbodyRgb,
  createSpectrum,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  planck,
  SPECTRUM_SAMPLES,
} from "./spectrum";

test("temperature shift includes the wavelength form of relativistic beaming exactly once", () => {
  for (const wavelength of [0.464, 0.549, 0.611]) {
    for (const temperature of [3200, 6500, 11_800]) {
      for (const shift of [0.35, 0.8, 1, 1.8, 4, 150]) {
        const shifted = planck(wavelength, temperature * shift);
        const invariant = shift ** 5 * planck(wavelength * shift, temperature);
        expect(shifted / invariant).toBeCloseTo(1, 12);
      }
    }
  }
});

test("the GPU spectrum table preserves colour and intensity over the useful temperature range", () => {
  const data = createSpectrum();
  expect(data.every(Number.isFinite)).toBe(true);
  for (const temperature of [
    1800, 3200, 6500, 11_800, 24_000, 80_000, 1_000_000, 10_000_000,
  ]) {
    const at =
      (Math.log(temperature / MIN_TEMPERATURE) /
        Math.log(MAX_TEMPERATURE / MIN_TEMPERATURE)) *
      (SPECTRUM_SAMPLES - 1);
    const low = Math.floor(at);
    const exact = blackbodyRgb(temperature);
    const scale = Math.max(...exact);
    for (let channel = 0; channel < 3; channel += 1) {
      const a = data[low * 4 + channel] ?? 0;
      const b = data[(low + 1) * 4 + channel] ?? 0;
      const sampled = a + (b - a) * (at - low);
      expect(Math.abs(sampled - (exact[channel] ?? 0)) / scale).toBeLessThan(
        0.003
      );
    }
  }
});

test("blackbody colours follow the eye: D65 is neutral, cool gas is orange, hot gas is blue", () => {
  const white = blackbodyRgb(6504);
  expect((white[0] ?? 0) / (white[2] ?? 1)).toBeCloseTo(1, 6);
  const ember = blackbodyRgb(3000);
  expect((ember[2] ?? 0) / (ember[0] ?? 1)).toBeLessThan(0.2);
  const hot = blackbodyRgb(20_000);
  expect((hot[0] ?? 0) / (hot[2] ?? 1)).toBeLessThan(0.5);
});
