import { FREQUENCY_INSPECTION_SHADER } from "./frequency-inspection";

export const SPECTRUM_SAMPLES = 2048;
export const MIN_TEMPERATURE = 400;
export const MAX_TEMPERATURE = 20_000_000;

/** Planck spectral radiance per wavelength (µm), omitting the common dimensional factor. */
export function planck(wavelength: number, temperature: number) {
  return (
    1 / (wavelength ** 5 * Math.expm1(14_387.77 / (wavelength * temperature)))
  );
}

// CIE 1931 2° colour-matching functions, multi-lobe fit (Wyman, Sloan & Shirley 2013).
const lobe = (x: number, mu: number, low: number, high: number) => {
  const t = (x - mu) / (x < mu ? low : high);
  return Math.exp(-0.5 * t * t);
};
const matchX = (nm: number) =>
  1.056 * lobe(nm, 599.8, 37.9, 31) +
  0.362 * lobe(nm, 442, 16, 26.7) -
  0.065 * lobe(nm, 501.1, 20.4, 26.2);
const matchY = (nm: number) =>
  0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
const matchZ = (nm: number) =>
  1.217 * lobe(nm, 437, 11.8, 36) + 0.681 * lobe(nm, 459, 26, 13.8);

function planckXyz(temperature: number) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const radiance = planck(nm / 1000, temperature);
    x += radiance * matchX(nm);
    y += radiance * matchY(nm);
    z += radiance * matchZ(nm);
  }
  return [x, y, z] as const;
}

function xyzToLinearSrgb([x, y, z]: readonly [number, number, number]) {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ] as const;
}

// D65 (≈6504 K) renders neutral; the luminance scale matches the earlier table.
const D65 = xyzToLinearSrgb(planckXyz(6504));
const SCALE = planck(0.549, 6504) / 0.361_52 / planckXyz(6504)[1];

/** Linear sRGB of a blackbody seen by the eye (CIE 1931), white-balanced to D65. */
export function blackbodyRgb(temperature: number) {
  const rgb = xyzToLinearSrgb(planckXyz(temperature));
  const luminance = planckXyz(temperature)[1] * SCALE;
  const balanced = rgb.map((value, i) => Math.max(0, value / (D65[i] ?? 1)));
  // Out-of-gamut chroma is clipped; the photometric luminance is kept.
  const y =
    0.2126 * (balanced[0] ?? 0) +
    0.7152 * (balanced[1] ?? 0) +
    0.0722 * (balanced[2] ?? 0);
  return balanced.map((value) => (value * luminance) / Math.max(y, 1e-300));
}

/** Log-temperature sampling resolves both red stars and strongly blueshifted light. */
export function createSpectrum() {
  const data = new Float32Array(SPECTRUM_SAMPLES * 4);
  for (let i = 0; i < SPECTRUM_SAMPLES; i += 1) {
    const temperature =
      MIN_TEMPERATURE *
      (MAX_TEMPERATURE / MIN_TEMPERATURE) ** (i / (SPECTRUM_SAMPLES - 1));
    const rgb = blackbodyRgb(temperature);
    for (let channel = 0; channel < 3; channel += 1) {
      data[i * 4 + channel] = rgb[channel] ?? 0;
    }
    data[i * 4 + 3] = 1;
  }
  return data;
}

export const SPECTRUM_SHADER = `
uniform sampler2D uSpectrum;
${FREQUENCY_INSPECTION_SHADER}
vec3 blackbody(float temperature) {
  float at = clamp(log(max(temperature, ${MIN_TEMPERATURE.toFixed(1)}) / ${MIN_TEMPERATURE.toFixed(1)}) / ${Math.log(MAX_TEMPERATURE / MIN_TEMPERATURE).toFixed(12)}, 0.0, 1.0) * ${SPECTRUM_SAMPLES - 1}.0;
  int low = int(floor(at));
  return mix(texelFetch(uSpectrum, ivec2(low, 0), 0).rgb, texelFetch(uSpectrum, ivec2(min(low + 1, ${SPECTRUM_SAMPLES - 1}), 0), 0).rgb, fract(at));
}
// The temperature shift includes beaming through invariance of I_nu / nu^3.
vec3 shiftedSpectrum(float temperature, float shift) {
  float normalization = dot(blackbody(temperature), vec3(0.2126, 0.7152, 0.0722));
  return frequencyInspection(blackbody(temperature * shift) / max(normalization, 1e-8), shift);
}
`;
