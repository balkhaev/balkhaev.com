/** A finite slab approximation to the material layer's grazing path length.
 * This is a prescribed thickness/extent ratio, rather than a resolved 3D disk. */
export const MATERIAL_GRAZING_RATIO = 0.06;

/** Cosine of the photon direction to the equatorial normal in the emitting frame.
 * The emitter's boost lies in the disk plane, so the normal momentum is unchanged.
 * Photon constants and shift use unit frequency in the observer's local frame. */
export function emitterIncidence(
  radius: number,
  angular: number,
  lambda: number,
  shift: number
) {
  return Math.max(
    0,
    Math.min(
      1,
      (shift * Math.sqrt(Math.max(0, angular ** 2 - lambda ** 2))) / radius
    )
  );
}

/** Absorption/emission through a normal proper optical column, with bounded grazing length. */
export function materialOpacity(normalDepth: number, incidence: number) {
  const cosine = Math.max(0, Math.min(1, incidence));
  return -Math.expm1(
    -Math.max(0, normalDepth) /
      Math.sqrt(cosine ** 2 + MATERIAL_GRAZING_RATIO ** 2)
  );
}

export const MATERIAL_OPACITY_SHADER = `
// The finite grazing length is an explicit slab approximation, not a horizon effect.
const float MATERIAL_GRAZING_RATIO = ${MATERIAL_GRAZING_RATIO.toFixed(2)};
float emitterIncidence(float r, float angular, float lambda, float shift) {
  return clamp(shift * sqrt(max(0.0, angular * angular - lambda * lambda)) / r, 0.0, 1.0);
}
float materialOpacity(float normalDepth, float incidence) {
  float pathCosine = sqrt(incidence * incidence + MATERIAL_GRAZING_RATIO * MATERIAL_GRAZING_RATIO);
  return 1.0 - exp(-max(0.0, normalDepth) / pathCosine);
}
// Shared injection column: the ISCO feed and its advected descendants start identically.
float injectionDepth(vec4 structure, float column) {
  return 0.9 * (0.015 + 0.1 * structure.x + 0.45 * structure.y * structure.y + 2.2 * structure.w) * column;
}
`;
