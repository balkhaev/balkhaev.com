/**
 * False colour for the frequency ratio measured in the observer's falling frame.
 * g = nu_observed / nu_emitted is supplied by each emitting ray intersection,
 * including emitter motion and gravity; no screen-space or radius-based shift is
 * inferred here. The ordinary Planck radiance is returned unchanged by default.
 * Diagnostic brightness deliberately differs from optical surface brightness so
 * very redshifted infrared sources remain inspectable. Overlapping emitters keep
 * their own g and are composited in the physical renderer's usual ray order.
 */
export const FREQUENCY_INSPECTION_SHADER = `
uniform bool uSpectral;

vec3 frequencyInspection(vec3 radiance, float shift) {
  if (!uSpectral) return radiance;
  float stops = clamp(log2(max(shift, 1e-8)), -12.0, 12.0);
  float amount = 1.0 - exp(-abs(stops) * 1.15);
  vec3 neutral = vec3(0.60, 0.62, 0.58);
  vec3 shifted = stops < 0.0 ? vec3(0.74, 0.13, 0.055) : vec3(0.055, 0.28, 0.90);
  vec3 palette = mix(neutral, shifted, amount);
  float luminance = max(0.0, dot(radiance, vec3(0.2126, 0.7152, 0.0722)));
  float diagnosticLight = 0.055 + 0.06 * (1.0 - exp(-sqrt(luminance)));
  return palette * diagnosticLight;
}
`;
