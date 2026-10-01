export const SPECTRUM_SAMPLES = 1024;
export const MIN_TEMPERATURE = 400;
export const MAX_TEMPERATURE = 200_000;
const WAVELENGTHS = [0.611, 0.549, 0.464] as const;
const WHITE = [0.322_05, 0.361_52, 0.396_27] as const;

/** Planck spectral radiance per wavelength, omitting the common dimensional factor. */
export function planck(wavelength: number, temperature: number) {
  return (
    1 / (wavelength ** 5 * Math.expm1(14_387.77 / (wavelength * temperature)))
  );
}

/** Log-temperature sampling resolves both red stars and strongly blueshifted light. */
export function createSpectrum() {
  const data = new Float32Array(SPECTRUM_SAMPLES * 4);
  for (let i = 0; i < SPECTRUM_SAMPLES; i += 1) {
    const temperature =
      MIN_TEMPERATURE *
      (MAX_TEMPERATURE / MIN_TEMPERATURE) ** (i / (SPECTRUM_SAMPLES - 1));
    for (let channel = 0; channel < 3; channel += 1) {
      data[i * 4 + channel] =
        planck(WAVELENGTHS[channel] ?? 0.549, temperature) /
        (WHITE[channel] ?? 1);
    }
    data[i * 4 + 3] = 1;
  }
  return data;
}

export const SPECTRUM_SHADER = `
uniform sampler2D uSpectrum;
vec3 blackbody(float temperature) {
  float at = clamp(log(max(temperature, ${MIN_TEMPERATURE.toFixed(1)}) / ${MIN_TEMPERATURE.toFixed(1)}) / ${Math.log(MAX_TEMPERATURE / MIN_TEMPERATURE).toFixed(12)}, 0.0, 1.0) * ${SPECTRUM_SAMPLES - 1}.0;
  int low = int(floor(at));
  return mix(texelFetch(uSpectrum, ivec2(low, 0), 0).rgb, texelFetch(uSpectrum, ivec2(min(low + 1, ${SPECTRUM_SAMPLES - 1}), 0), 0).rgb, fract(at));
}
// The temperature shift includes beaming through invariance of I_nu / nu^3.
vec3 shiftedSpectrum(float temperature, float shift) {
  float normalization = dot(blackbody(temperature), vec3(0.2126, 0.7152, 0.0722));
  return blackbody(temperature * shift) / max(normalization, 1e-8);
}
`;
