import { STAR_RADIUS, STAR_SAMPLES } from "./stellar-orbit";

/** Uses the same ray table and emission clock as the disk, including secondary images. */
export const STELLAR_SHADER = `
uniform sampler2D uOrbit;
uniform vec4 uOrbitClock; // radial period, azimuthal advance, initial time, orientation
const float STAR_RADIUS = ${STAR_RADIUS.toFixed(5)};

vec4 orbitState(float time) {
  float phase = (time + uOrbitClock.z) / uOrbitClock.x;
  float at = fract(phase) * ${STAR_SAMPLES - 1}.0;
  int low = int(floor(at));
  vec4 state = mix(texelFetch(uOrbit, ivec2(low, 0), 0), texelFetch(uOrbit, ivec2(min(low + 1, ${STAR_SAMPLES - 1}), 0), 0), fract(at));
  state.y = uOrbitClock.w - state.y - floor(phase) * uOrbitClock.y;
  state.w = -state.w;
  return state;
}

vec3 starCenter(vec4 state) {
  return state.x * vec3(cos(state.y), 0.0, sin(state.y));
}

vec3 starVelocity(vec4 state) {
  return state.z * vec3(cos(state.y), 0.0, sin(state.y)) + state.x * state.w * vec3(-sin(state.y), 0.0, cos(state.y));
}

vec3 rayPoint(float row, float phi, vec3 e1, vec3 e2) {
  return (cos(phi) * e1 + sin(phi) * e2) / max(inverseRadius(row, phi), 0.0001);
}

vec3 relativeTangent(float row, float phi, float b, float energy, float end, vec3 e1, vec3 e2, vec4 state) {
  float u = max(inverseRadius(row, phi), 0.0001);
  float slope = pathSlope(row, phi, end, b, energy);
  vec3 radial = cos(phi) * e1 + sin(phi) * e2;
  vec3 derivative = (-sin(phi) * e1 + cos(phi) * e2) / u - radial * slope / (u * u);
  float k = energy / max(b, 1e-8);
  float dt = (k * k + u * u * u) / max(u * u * (k - sqrt(u) * slope), 1e-12);
  return derivative + starVelocity(state) * dt;
}

float starIntersection(float row, float b, float energy, float end, vec3 e1, vec3 e2, float winding) {
  if (energy <= 0.0) return 1e5; // Negative Killing-energy photons cannot originate outside.
  vec4 state = orbitState(uTime);
  float phi = 0.0;
  // Resolve the retarded centre first; this also rejects rays outside the photosphere's cone.
  for (int j = 0; j < 4; j++) {
    vec3 center = starCenter(state);
    phi = mod(atan(dot(center, e2), dot(center, e1)) + TAU, TAU) + winding;
    if (phi >= end || phi < 0.001) return 1e5;
    state = orbitState(uTime - travelTime(row, phi) + EPOCH);
  }
  vec3 delta = rayPoint(row, phi, e1, e2) - starCenter(state);
  vec3 tangent = relativeTangent(row, phi, b, energy, end, e1, e2, state);
  float speed2 = dot(tangent, tangent);
  float along = dot(delta, tangent);
  float discriminant = along * along - speed2 * (dot(delta, delta) - STAR_RADIUS * STAR_RADIUS);
  if (discriminant < 0.0) return 1e5;
  phi += (-along - sqrt(discriminant)) / speed2;
  // Refine the front photosphere intersection on the curved, retarded ray.
  for (int j = 0; j < 4; j++) {
    if (phi <= 0.0 || phi >= end) return 1e5;
    state = orbitState(uTime - travelTime(row, phi) + EPOCH);
    delta = rayPoint(row, phi, e1, e2) - starCenter(state);
    tangent = relativeTangent(row, phi, b, energy, end, e1, e2, state);
    float derivative = 2.0 * dot(delta, tangent);
    if (abs(derivative) < 1e-6) return 1e5;
    phi -= clamp((dot(delta, delta) - STAR_RADIUS * STAR_RADIUS) / derivative, -0.04, 0.04);
  }
  state = orbitState(uTime - travelTime(row, phi) + EPOCH);
  delta = rayPoint(row, phi, e1, e2) - starCenter(state);
  if (phi <= 0.0 || phi >= end || abs(length(delta) - STAR_RADIUS) > 0.015) return 1e5;
  return phi;
}

vec4 photosphere(vec3 hit, float time, vec3 photonCovector, float energy) {
  vec4 state = orbitState(time);
  vec3 velocity = starVelocity(state);
  vec3 radial = normalize(hit);
  float lapse = 1.0 - 1.0 / length(hit);
  float vr = dot(velocity, radial);
  float properRate = sqrt(max(0.0, lapse - dot(velocity, velocity) - 2.0 * sqrt(1.0 - lapse) * vr));
  float g = properRate / max(0.00001, energy - dot(photonCovector, velocity));
  vec3 outward = normalize(hit - starCenter(state));
  vec3 photon = photonCovector - radial * dot(photonCovector, radial) * (1.0 - sqrt(lapse));
  float limb = clamp(dot(outward, normalize(photon)), 0.0, 1.0);
  // Prescribed photospheric granules, sampled on the retarded world-space surface.
  vec3 local = vec3(outward.x * cos(state.y) + outward.z * sin(state.y), outward.y,
    -outward.x * sin(state.y) + outward.z * cos(state.y));
  vec3 weights = abs(local);
  weights /= max(dot(weights, vec3(1.0)), 0.0001);
  float granules = dot(weights, vec3(
    filteredDensity(local.yz * 31.0 + time * 0.014),
    filteredDensity(local.xz * 31.0 + time * 0.014),
    filteredDensity(local.xy * 31.0 + time * 0.014)));
  vec3 radiance = blackbody(11800.0 * (0.94 + 0.12 * granules) * g) * (0.42 + 0.58 * limb);
  return vec4(frequencyInspection(radiance, g), 1.0);
}
`;
