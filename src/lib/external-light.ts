/** Prescribed variable emitters held on one finite exterior sphere, in r_s=c=1. */
export const EXTERNAL_LIGHT_RADIUS = 60;
export const EXTERNAL_LIGHT_LAPSE = Math.sqrt(1 - 1 / EXTERNAL_LIGHT_RADIUS);
export const EXTERNAL_LIGHT_STRIDE = 12;

const DIRECTIONS = [
  [0.56, 0.22, 0.8],
  [0.12, -0.46, 0.88],
  [-0.72, 0.3, 0.6],
  [0.88, 0.25, -0.39],
  [-0.82, -0.08, -0.56],
  [0.15, 0.91, 0.33],
  [-0.12, -0.91, 0.395],
  [0.48, -0.3, -0.82],
  [-0.34, 0.15, 0.93],
  [0.33, 0.41, -0.85],
] as const;
const PERIODS = [
  9, 10.3, 11.5, 12.9, 14.2, 15.4, 16.7, 17.6, 18.4, 19,
] as const;
const TEMPERATURES = [
  5100, 8800, 6300, 11_200, 4800, 9400, 7400, 5700, 10_400, 6900,
] as const;

/**
 * World direction/flux; source temperature/proper period/phase/luminosity depth;
 * source lapse/thermal modulation and two reserved components. All optical images
 * read this same history; their different finite light-travel delays cause echoes.
 */
export function createExternalLightCatalogue() {
  const data = new Float32Array(DIRECTIONS.length * EXTERNAL_LIGHT_STRIDE);
  for (const [index, direction] of DIRECTIONS.entries()) {
    const length = Math.hypot(...direction);
    const offset = index * EXTERNAL_LIGHT_STRIDE;
    data.set(
      [
        direction[0] / length,
        direction[1] / length,
        direction[2] / length,
        (2.3 + (index % 3) * 0.75) * 1e-5,
        TEMPERATURES[index] ?? 6500,
        PERIODS[index] ?? 14,
        (index * 0.381_966_01) % 1,
        0.82 + (index % 4) * 0.055,
        EXTERNAL_LIGHT_LAPSE,
        0.08 + (index % 3) * 0.01,
        0,
        0,
      ],
      offset
    );
  }
  return data;
}

/** Source-proper light curve; this is prescribed variability, not a GR prediction. */
export function externalLightVariation(
  properTime: number,
  period: number,
  phase: number
) {
  const angle = ((properTime / period + phase) % 1) * Math.PI * 2;
  const primary = ((1 + Math.cos(angle - 1.15)) * 0.5) ** 7;
  const echo = ((1 + Math.cos(angle - 3.65)) * 0.5) ** 9;
  return 0.32 + 1.7 * primary + 0.83 * echo;
}

export const EXTERNAL_LIGHT_CURVE_SHADER = `
float externalLightVariation(float properTime, float period, float phase) {
  float angle = fract(properTime / period + phase) * 6.28318530718;
  float primary = pow((1.0 + cos(angle - 1.15)) * 0.5, 7.0);
  float echo = pow((1.0 + cos(angle - 3.65)) * 0.5, 9.0);
  return 0.32 + 1.7 * primary + 0.83 * echo;
}
`;
