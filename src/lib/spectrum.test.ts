import { expect, test } from "bun:test";
import {
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
    for (const [channel, wavelength, white] of [
      [0, 0.611, 0.322_05],
      [1, 0.549, 0.361_52],
      [2, 0.464, 0.396_27],
    ]) {
      const a = data[low * 4 + (channel ?? 0)] ?? 0;
      const b = data[(low + 1) * 4 + (channel ?? 0)] ?? 0;
      const sampled = a + (b - a) * (at - low);
      const exact = planck(wavelength ?? 0.549, temperature) / (white ?? 1);
      expect(Math.abs(sampled / exact - 1)).toBeLessThan(0.002);
    }
  }
});
