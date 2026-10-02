/**
 * An explicitly imagined continuation after the resolved Schwarzschild descent.
 * This is an emitting, world-anchored volume, not a prediction of light at a singularity.
 * Its camera ray uses the same stereographic lens as the physical renderer. The
 * coordinates stay fixed when the observer looks around; only journey progress
 * moves the observer, while animationTime advects the fine luminous filaments.
 * Radiance stays linear until the renderer's shared exposure and tone mapping.
 */
export const INTERIOR_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform float uSensor;
uniform vec3 uLens;
uniform mat3 uCamera;
uniform float uPhase;
uniform float uAnimationTime;
uniform int uSamples;
out vec4 outColor;

const float FIRST_LIGHT = 2.95651156; // log(12.5 / .65)
const float RESOLVED_END = 6.43775165; // log(12.5 / .02)
const float IMAGINED_END = 9.23775165;
const vec3 FALL_AXIS = vec3(0.0, -0.10452846, 0.99452190);
const vec3 FALL_UP = vec3(0.0, 0.99452190, 0.10452846);

// Smooth, low-frequency structure: no texture lookup or unbounded fractal loop.
float interiorCloud(vec3 p) {
  return sin(p.x + sin(p.y * 0.71))
    * sin(p.y + sin(p.z * 0.83))
    * sin(p.z + sin(p.x * 0.67));
}

// Integrate narrow seams over a march segment. This keeps luminous energy while
// preventing unresolved surfaces from sparkling as the camera moves.
float interiorSeam(float value, float width, float footprint) {
  float filtered = width + footprint;
  return exp(-abs(value) / filtered) * width / filtered;
}

vec4 interiorMatter(vec3 p, vec3 ray, float segment, float quiet, float time) {
  float twist = p.z * 0.24 + sin(p.z * 0.28 + time * 0.025) * 0.18;
  vec2 xy = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.xy;
  float radius = length(xy);
  float azimuth = atan(xy.y, xy.x);
  float cloud = interiorCloud(vec3(xy * 0.54, p.z * 0.32));
  float flow = time * mix(0.065, 0.027, quiet);

  // Nested folded sheets carry separate narrow braids. Looking sideways reveals
  // their local thickness; looking along the fall reveals their depth.
  float foldPhase = radius * 1.24 - p.z * 0.48
    + sin(azimuth * 3.0 + p.z * 0.26) * 0.72 + cloud * 0.28;
  float fold = sin(foldPhase);
  vec2 rayXY = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * ray.xy;
  float twistRate = (0.24 + cos(p.z * 0.28 + time * 0.025) * 0.0504) * ray.z;
  rayXY += vec2(xy.y, -xy.x) * twistRate;
  float radialRate = dot(xy, rayXY) / max(radius, 0.1);
  float azimuthRate = (xy.x * rayXY.y - xy.y * rayXY.x) / max(radius * radius, 0.1);
  float foldRate = 1.24 * radialRate - 0.48 * ray.z
    + cos(azimuth * 3.0 + p.z * 0.26) * 0.72 * (3.0 * azimuthRate + 0.26 * ray.z);
  float foldFootprint = min(0.48, abs(foldRate) * segment * 0.22 + segment * 0.014);
  float braid = 0.5 + 0.5 * sin(azimuth * 7.0 - p.z * 0.67
    + radius * 0.4 - flow + cloud * 0.8);
  float thread = interiorSeam(fold, 0.036, foldFootprint)
    * (0.09 + 1.5 * pow(braid, 9.0));
  float veil = exp(-abs(fold) * 3.8) * (0.009 + 0.020 * cloud * cloud);
  float crossFold = sin(dot(p, vec3(0.39, 0.74, 0.18)) + cloud * 0.42);
  float crossing = interiorSeam(crossFold, 0.045,
    abs(dot(ray, vec3(0.39, 0.74, 0.18))) * segment * 0.22)
    * exp(-abs(fold) * 8.0) * 0.16;
  // A cool boundless depth, with rare amber seams where the sheets meet.
  float colourWave = 0.5 + 0.5 * sin(p.z * 0.37 + azimuth * 1.7 + cloud);
  vec3 colour = mix(vec3(0.19, 0.035, 0.47), vec3(0.025, 0.40, 0.48), colourWave);
  float warm = smoothstep(0.74, 0.98,
    0.5 + 0.5 * sin(p.z * 0.61 - azimuth * 2.0 + cloud));
  colour = mix(colour, vec3(0.71, 0.24, 0.055), warm * 0.62);
  float edge = exp(-radius * 0.045);
  vec3 emission = colour * (thread + veil + crossing) * edge;
  float density = (thread * 0.25 + veil) * edge;

  // Farther in, the braids gradually calm into a suspended, spatial lattice.
  // Its centre is ahead in the imagined volume, independent of the physical r=0.
  vec3 h = p - vec3(7.2, -0.5, 11.2);
  float envelope = exp(-dot(h, h) * 0.033);
  vec3 waves = sin(h * vec3(1.24, 1.02, 0.89)
    + vec3(sin(h.y * 0.43), sin(h.z * 0.39), sin(h.x * 0.46)) * 0.26);
  vec3 latticeFootprint = abs(ray) * vec3(1.24, 1.02, 0.89) * segment * 0.22
    + vec3(segment * 0.014);
  vec3 seams = vec3(interiorSeam(waves.x, 0.055, latticeFootprint.x),
    interiorSeam(waves.y, 0.055, latticeFootprint.y),
    interiorSeam(waves.z, 0.055, latticeFootprint.z));
  float lace = seams.x * seams.y + seams.y * seams.z + seams.z * seams.x;
  float torusDistance = length(vec2(length(h.xz) - 2.8, h.y * 0.82));
  float cradle = exp(-torusDistance * torusDistance * 5.5);
  float breath = 0.91 + 0.09 * sin(time * 0.23);
  vec3 lattice = mix(vec3(0.09, 0.30, 0.47), vec3(0.42, 0.19, 0.55),
    0.5 + 0.5 * sin(h.z * 0.51 + h.x * 0.3));
  emission = mix(emission, emission * 0.32, quiet);
  emission += quiet * envelope * breath
    * (lattice * lace * 3.2 + vec3(0.53, 0.35, 0.13) * cradle * 0.26
      + vec3(0.0015, 0.0031, 0.006));
  density += quiet * envelope * (lace * 0.075 + cradle * 0.025);
  return vec4(emission, density);
}

vec3 interiorCradlePoint(vec2 orbit, vec2 flow) {
  float sin3 = 3.0 * orbit.y - 4.0 * orbit.y * orbit.y * orbit.y;
  float cos3 = 4.0 * orbit.x * orbit.x * orbit.x - 3.0 * orbit.x;
  return vec3(7.2, -0.5, 11.2)
    + vec3((sin3 * flow.x + cos3 * flow.y) * 0.34,
      orbit.x * 1.65, orbit.y * 2.55);
}

// A resolved thread through the final suspended lattice. Analytic ray/segment
// distances make this fine geometry stable even with a modest volume sample count.
// It is a spatial closed curve, so free look and descent give real parallax.
vec3 interiorCradle(vec3 origin, vec3 ray, float time) {
  float closest = 1e4;
  float at = 0.0;
  float depth = 1.0;
  vec2 flow = vec2(cos(time * 0.035), sin(time * 0.035));
  vec2 orbit = vec2(1.0, 0.0);
  // A fixed ten-degree rotation avoids per-segment trigonometry on the GPU.
  mat2 turn = mat2(0.98480775, 0.17364818, -0.17364818, 0.98480775);
  vec3 a = interiorCradlePoint(orbit, flow);
  for (int i = 0; i < 36; i++) {
    orbit = turn * orbit;
    vec3 b = interiorCradlePoint(orbit, flow);
    vec3 segment = b - a;
    vec3 offset = origin - a;
    float along = dot(ray, segment);
    float fraction = clamp((dot(segment, offset) - along * dot(ray, offset))
      / max(1e-5, dot(segment, segment) - along * along), 0.0, 1.0);
    vec3 point = a + segment * fraction;
    float rayDistance = max(0.0, dot(point - origin, ray));
    float distance = length(point - origin - ray * rayDistance);
    if (distance < closest) {
      closest = distance;
      depth = rayDistance;
      at = (float(i) + fraction) * 6.28318530718 / 36.0;
    }
    a = b;
  }
  float width = 0.018 + depth * uSensor * 0.8;
  float core = exp(-pow(closest / width, 2.0));
  float halo = exp(-pow(closest / (width * 3.0), 2.0));
  float amber = smoothstep(0.90, 0.99, 0.5 + 0.5 * sin(at * 3.0 - time * 0.065));
  vec3 colour = mix(vec3(0.29, 0.65, 0.79), vec3(0.85, 0.49, 0.17), amber * 0.75);
  return colour * (core * 0.08 + halo * 0.006) * (0.018 / width);
}

void main() {
  float awakening = smoothstep(FIRST_LIGHT, 4.42, uPhase);
  if (awakening <= 0.0) { outColor = vec4(0.0); return; }
  float beyond = smoothstep(RESOLVED_END - 0.65, RESOLVED_END + 1.25, uPhase);
  float quiet = smoothstep(RESOLVED_END + 1.1, IMAGINED_END, uPhase);
  vec2 offset = (gl_FragCoord.xy - uCenter) * uSensor;
  float rho = length(offset);
  float angle = mix(atan(rho * uLens.x), 2.0 * atan(rho * uLens.y), uLens.z);
  vec3 local = vec3(rho > 1e-8 ? offset * (sin(angle) / rho) : vec2(0.0), cos(angle));
  vec3 worldRay = normalize(uCamera * local);
  vec3 ray = vec3(-worldRay.x, dot(worldRay, FALL_UP), dot(worldRay, FALL_AXIS));

  float travel = max(0.0, uPhase - FIRST_LIGHT);
  float depth = travel * 1.05 + max(0.0, uPhase - RESOLVED_END) * 2.1;
  vec3 origin = vec3(sin(travel * 0.48) * 0.22,
    (cos(travel * 0.35) - 1.0) * 0.15, depth);
  float steps = float(uSamples);
  float transmission = 1.0;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= uSamples) break;
    float fraction = (float(i) + 0.5) / steps;
    float distance = 19.0 * fraction * fraction;
    float segment = max(0.02, 19.0 * (2.0 * fraction / steps + 1.0 / (steps * steps)));
    vec3 point = origin + ray * distance;
    vec4 matter = interiorMatter(point, ray, segment, quiet, uAnimationTime);
    float extinction = exp(-matter.a * segment * 0.085);
    light += transmission * matter.rgb * segment * 0.12;
    transmission *= extinction;
  }
  // The first wisps are dim enough to preserve the horizon's physical light.
  // The resolved source dissolves only across the imagined part of the journey.
  float strength = awakening * mix(0.08, 0.95, beyond);
  if (quiet > 0.0) light += interiorCradle(origin, ray, uAnimationTime) * quiet;
  float sourceFade = smoothstep(RESOLVED_END + 0.2, RESOLVED_END + 1.8, uPhase);
  float opacity = sourceFade + (1.0 - sourceFade) * (1.0 - transmission) * awakening * 0.22;
  outColor = vec4(clamp(light * strength, vec3(0.0), vec3(6.0)), clamp(opacity, 0.0, 1.0));
}`;
