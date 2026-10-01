import { EXIT_VELOCITY } from "./flight";

/** The speculative passage uses world-space surfaces and an outward-moving emission field. */
export const PASSAGE_SHADER = `
uniform vec4 uPassage; // classical blend, bridge travel, outward observer distance, exterior blend

// Fixed world axes align with the original camera; mouse look rotates the viewing rays only.
vec3 passageDirection(vec3 dir) {
  return vec3(-dir.x, dot(dir, vec3(0.0, 0.994521895, 0.104528463)),
    dot(dir, vec3(0.0, -0.104528463, 0.994521895)));
}

vec3 bridgeLight(vec3 dir) {
  vec3 eye = vec3(0.0, 0.0, -12.0 + 52.0 * uPassage.y);
  float transverse = max(0.00001, length(dir.xy));
  vec3 light = vec3(0.0);
  // Nested cylindrical sheets make resolved luminous fibres surround the observer in 3D.
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    float radius = 3.2 + layer * 0.38;
    float distance = radius / transverse;
    vec3 hit = eye + distance * dir;
    if (hit.z < -18.0 || hit.z > 43.0 || distance > 120.0) continue;
    float azimuth = atan(hit.y, hit.x);
    float emissionTime = uTime - distance;
    float phase = azimuth * (6.0 + layer * 2.0) + hit.z * 0.42 + sin(hit.z * 0.11 + layer) * 1.6 + emissionTime * 0.065;
    float wave = abs(sin(phase));
    float pixel = max(fwidth(phase), 0.008);
    float fibre = 1.0 - smoothstep(0.045, 0.12 + pixel, wave);
    float grain = filteredDensity(vec2(azimuth * 12.0 + layer * 9.0, hit.z * 1.8 - emissionTime * 0.05));
    float pulse = pow(0.5 + 0.5 * sin(hit.z * 1.25 - emissionTime * 0.3 + layer), 8.0);
    float edge = smoothstep(-18.0, -12.0, hit.z) * (1.0 - smoothstep(37.0, 43.0, hit.z));
    float density = edge * exp(-distance * 0.018) * (0.0004 * grain * grain + fibre * (0.35 + 0.65 * grain) * (0.01 + 0.035 * pulse));
    float temperature = mix(4300.0, 10000.0, 0.5 + 0.5 * sin(azimuth * 2.0 + hit.z * 0.12 + layer));
    light += blackbody(temperature) * density;
  }
  // A radiating aperture at a world-space plane, growing by perspective as we reach it.
  if (dir.z > 0.0001) {
    float distance = (43.0 - eye.z) / dir.z;
    vec2 hit = distance * dir.xy;
    float aperture = 1.0 - smoothstep(0.8, 2.8, length(hit));
    float grain = filteredDensity(hit * 12.0 + vec2(uTime * 0.02, 0.0));
    light += blackbody(8300.0 + 2700.0 * grain) * aperture * 0.065;
  }
  return light;
}

vec3 whiteExterior(vec3 dir) {
  vec3 eye = vec3(0.0, 0.0, uPassage.z);
  // Special-relativistic aberration and frequency shift for the outward-looking observer.
  float velocity = ${EXIT_VELOCITY.toFixed(5)};
  float gamma = inversesqrt(1.0 - velocity * velocity);
  float denominator = max(0.01, 1.0 - velocity * dir.z);
  float shift = 1.0 / (gamma * denominator);
  vec3 worldRay = vec3(dir.xy / (gamma * denominator), (dir.z - velocity) / denominator);
  vec3 sky = worldRay;
  float angle = 1.1;
  sky = vec3(cos(angle) * sky.x + sin(angle) * sky.z, sky.y, -sin(angle) * sky.x + cos(angle) * sky.z);
  float area = length(cross(dFdx(dir), dFdy(dir)));
  vec3 light = (stars(sky, dFdx(sky), dFdy(sky), area, shift) + distantGalaxy(sky, shift) * 2.5) * 0.65;

  float along = dot(eye, worldRay);
  float centreDistance = dot(eye, eye);
  float closestTime = max(0.0, -along);
  vec3 closest = eye + closestTime * worldRay;
  // Optically thin emitting gas around the white source; the source itself has a resolved surface.
  light += blackbody(9200.0 * shift) * exp(-dot(closest, closest) / 5.0) * 0.008;
  float core = along * along - centreDistance + 1.0;
  float corePixel = max(fwidth(core), 0.0001);
  float coreDistance = 1e5;
  if (core > -corePixel && along < 0.0) {
    float intersection = -along - sqrt(max(0.0, core));
    if (core > 0.0) coreDistance = intersection;
    vec3 surface = eye + intersection * worldRay;
    float granules = filteredDensity(surface.xy * 28.0 + surface.z * 11.0);
    float coverage = smoothstep(-corePixel, corePixel, core);
    light = mix(light, blackbody(12000.0 * shift) * (0.35 + 0.15 * granules), coverage);
  }

  // A rotating launch pattern becomes expanding spiral filaments in an optically thin wind.
  float windSphere = along * along - centreDistance + 144.0;
  if (windSphere > 0.0) {
    float start = max(0.0, -along - sqrt(windSphere));
    float finish = min(coreDistance, -along + sqrt(windSphere));
    float stepLength = max(0.0, finish - start) / 12.0;
    for (int i = 0; i < 12; i++) {
      float distance = start + (float(i) + 0.5) * stepLength;
      vec3 point = eye + distance * worldRay;
      float radius = length(point);
      if (radius < 1.3 || radius > 12.0 || stepLength <= 0.0) continue;
      vec3 radial = point / radius;
      float emissionTime = uTime - distance;
      float launchTime = emissionTime - (radius - 1.0) / 0.52;
      float angle = atan(point.z, point.x);
      float latitude = radial.y - 0.15 * sin(angle * 2.0 - launchTime * 0.025);
      float fan = exp(-latitude * latitude / 0.012);
      float coil = 1.0 - smoothstep(0.03, 0.18, abs(sin(angle * 3.0 - launchTime * 0.075)));
      float grains = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(angle * 41.0 - launchTime * 0.19), 3.0);
      float edge = smoothstep(1.3, 2.0, radius) * (1.0 - smoothstep(9.0, 12.0, radius));
      float density = fan * (0.12 + 0.88 * coil) * grains * edge / (1.0 + radius * radius * 0.06);
      float emitterShift = shift * sqrt(1.0 - 0.52 * 0.52) / (1.0 + 0.52 * dot(worldRay, radial));
      float temperature = mix(9200.0, 5300.0, (radius - 1.3) / 10.7);
      light += blackbody(temperature * emitterShift) * density * stepLength * 0.022;
    }
  }

  // Transparent packets travel radially at 0.52 c. Each shell is staggered at its source.
  for (int i = 0; i < 7; i++) {
    float phase = fract(uTime * 0.02 + float(i) / 7.0);
    float radius = 2.0 + phase * 26.0;
    float speed = 0.52;
    float coefficient = 1.0 - speed * speed;
    float linear = along + radius * speed;
    // Intersect the packet at emission time: |eye+s ray| = radius(now) - speed*s.
    float discriminant = linear * linear - coefficient * (centreDistance - radius * radius);
    if (discriminant <= 0.0) continue;
    float distance = (-linear - sqrt(discriminant)) / coefficient;
    if (distance <= 0.0) distance = (-linear + sqrt(discriminant)) / coefficient;
    if (distance <= 0.0) continue;
    if (distance > coreDistance) continue;
    float emittedRadius = radius - speed * distance;
    if (emittedRadius < 2.0) continue;
    vec3 hit = normalize(eye + distance * worldRay);
    vec3 cell = floor(hit * 85.0);
    vec3 seed = random3(cell, uint(i) + 51u);
    vec3 centre = normalize(cell + 0.3 + random3(cell, uint(i) + 97u) * 0.4);
    float separation = length(hit - centre) * 85.0;
    float spot = exp(-separation * separation * 110.0) * (1.0 - step(0.025, seed.x));
    float emittedPhase = (emittedRadius - 2.0) / 26.0;
    float fade = smoothstep(0.0, 0.08, emittedPhase) * (1.0 - smoothstep(0.85, 1.0, emittedPhase));
    float dilution = fade / (1.0 + radius * 0.05);
    float emitterShift = shift * sqrt(1.0 - speed * speed) / (1.0 + speed * dot(worldRay, hit));
    light += blackbody(mix(5500.0, 11000.0, seed.z) * emitterShift) * spot * 0.035 * dilution;
  }
  return light;
}

vec3 passageLight(vec3 ray) {
  vec3 dir = passageDirection(ray);
  if (uPassage.w >= 1.0) return whiteExterior(dir);
  vec3 inside = bridgeLight(dir);
  if (uPassage.w <= 0.0) return inside;
  return mix(inside, whiteExterior(dir), uPassage.w);
}
`;
