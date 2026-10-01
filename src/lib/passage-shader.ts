import { BEAT_PERIOD } from "./flight";

/** An authored chamber: every sheet, particle and drum wave lives in world coordinates. */
export const PASSAGE_SHADER = `
uniform vec4 uPassage; // blend, distance to the drum, beat clock, ejection
uniform sampler2D uDrummer;
const float BEAT = ${BEAT_PERIOD.toFixed(1)};
const vec3 DRUM = vec3(0.55, 0.65, -0.06);

vec3 passageDirection(vec3 dir) {
  return vec3(-dir.x, dot(dir, vec3(0.0, 0.994521895, 0.104528463)),
    dot(dir, vec3(0.0, -0.104528463, 0.994521895)));
}

float beatPhase(float time) { return fract((time + 3.5) / BEAT); }
float drumPulse(float time) {
  return exp(-beatPhase(time) * 24.0) * smoothstep(0.0, 1.0, time);
}
// Authored luminous materials have independent emissivity, keeping amber and blue equally legible.
vec3 chamberColor(float temperature) {
  vec3 spectrum = blackbody(temperature);
  vec3 emissivity = mix(vec3(0.32, 0.76, 1.24), vec3(1.24, 0.72, 0.28),
    1.0 - smoothstep(4500.0, 8500.0, temperature));
  return spectrum * emissivity / max(0.0001, dot(spectrum, vec3(0.2126, 0.7152, 0.0722)));
}

vec4 spriteFrame(float frame, vec2 uv) {
  vec2 cell = vec2(mod(frame, 2.0), floor(frame / 2.0));
  vec2 imageUv = vec2(uv.x, 1.0 - uv.y);
  imageUv.y -= cell.y * 0.022;
  return texture(uDrummer, (clamp(imageUv, 0.002, 0.998) + cell) * 0.5);
}

vec4 musician(vec3 eye, vec3 dir, out float depth) {
  depth = 1e4;
  if (dir.z <= 0.0001) return vec4(0.0);
  float distance = -eye.z / dir.z;
  vec2 hit = eye.xy + distance * dir.xy;
  // Tiny weight shifts; the sprite remains anchored to the chamber, not to the screen.
  float sway = sin(uPassage.z * 0.17) * 0.018;
  hit.x -= sway;
  vec2 uv = hit / 3.9 + 0.5;
  if (any(lessThan(uv, vec2(0.002))) || any(greaterThan(uv, vec2(0.998)))) return vec4(0.0);
  float phase = beatPhase(uPassage.z - distance);
  float frame = phase < 0.12 ? 2.0 : phase < 0.3 ? 3.0 : phase < 0.79 ? 0.0 : 1.0;
  // Align the generated rows by their feet. Mipmaps preserve transparent edges at a distance.
  vec4 figure = spriteFrame(frame, uv);
  if (phase >= 0.08 && phase < 0.12) figure = mix(spriteFrame(2.0, uv), spriteFrame(3.0, uv), smoothstep(0.08, 0.12, phase));
  if (phase >= 0.26 && phase < 0.3) figure = mix(spriteFrame(3.0, uv), spriteFrame(0.0, uv), smoothstep(0.26, 0.3, phase));
  if (phase >= 0.73 && phase < 0.79) figure = mix(spriteFrame(0.0, uv), spriteFrame(1.0, uv), smoothstep(0.73, 0.79, phase));
  if (phase >= 0.96) figure = mix(spriteFrame(1.0, uv), spriteFrame(2.0, uv), smoothstep(0.96, 1.0, phase));
  vec3 linear = pow(figure.rgb, vec3(2.2));
  float pulse = drumPulse(uPassage.z - distance);
  linear *= vec3(0.86, 0.91, 1.04) * (0.13 + 0.035 * pulse);
  float membrane = exp(-dot((hit - DRUM.xy) / vec2(0.42, 0.61), (hit - DRUM.xy) / vec2(0.42, 0.61)) * 2.0);
  linear += chamberColor(3800.0) * membrane * pulse * 0.06;
  depth = distance;
  return vec4(linear, figure.a);
}

vec3 chamberSheets(vec3 eye, vec3 dir) {
  vec3 light = vec3(0.0);
  // Long, twisting plasma sheets. Fine fibres have pixel-sized coverage rather than a blur.
  for (int i = 0; i < 4; i++) {
    float layer = float(i);
    float radius = 5.8 + layer * 0.7;
    float distance = radius / max(0.0001, length(dir.xy));
    vec3 hit = eye + distance * dir;
    if (hit.z < -65.0 || hit.z > 18.0 || distance > 140.0) continue;
    float angle = atan(hit.y, hit.x);
    float emission = uTime - distance;
    float twist = angle * 3.0 + hit.z * 0.2 + layer * 1.7;
    float cloud = filteredDensity(vec2(angle * 8.0 + layer * 11.0, hit.z * 0.7 - emission * 0.014));
    float fold = sin(twist + sin(hit.z * 0.09 + layer) * 1.8);
    float strands = abs(sin(twist * 8.0 + cloud * 7.0 + hit.z * 0.25));
    float width = max(0.025, fwidth(strands) * 0.75);
    float thread = 1.0 - smoothstep(width, width + 0.045, strands);
    float ribbon = pow(max(0.0, fold), 16.0);
    float pores = filteredDensity(vec2(angle * 90.0, hit.z * 5.0 - emission * 0.04));
    float edge = smoothstep(-65.0, -55.0, hit.z) * (1.0 - smoothstep(8.0, 18.0, hit.z));
    float temperature = mix(2900.0, 12000.0, 0.5 + 0.5 * sin(twist * 0.5 + layer));
    float density = edge * exp(-distance * 0.018) * ribbon * (0.0015 + thread * 0.021) * (0.3 + 0.7 * pores);
    light += chamberColor(temperature) * density;
  }
  return light;
}

vec3 chamberOrbits(vec3 eye, vec3 dir, float figureDepth) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float index = float(i);
    float tilt = 0.3 + index * 0.32;
    vec3 normal = normalize(vec3(sin(tilt) * 1.15, cos(tilt) * 0.8, 1.0));
    vec3 center = vec3(0.0, -0.1, 1.8 + index * 0.23);
    float denominator = dot(dir, normal);
    if (abs(denominator) < 0.0001) continue;
    float distance = dot(center - eye, normal) / denominator;
    if (distance <= 0.0 || distance > figureDepth) continue;
    vec3 hit = eye + distance * dir - center;
    float radius = length(hit);
    float angle = atan(hit.y, hit.x);
    float grain = filteredDensity(vec2(angle * 20.0 + index * 7.0, radius * 18.0));
    float ridge = 2.15 + index * 0.4 + sin(angle * 3.0 + index) * 0.05;
    float line = abs(radius - ridge);
    float pixel = max(0.008, fwidth(radius));
    float filament = 1.0 - smoothstep(0.009, 0.02 + pixel, line);
    float halo = exp(-line * line / 0.012);
    float emissionTime = uPassage.z - distance;
    float glint = pow(0.5 + 0.5 * sin(angle * 5.0 - emissionTime * 0.09 + index), 10.0);
    float thermal = mod(index, 3.0) < 0.5 ? 11500.0 : 3300.0 + index * 90.0;
    light += chamberColor(thermal) * (filament * (0.018 + glint * 0.065) + halo * 0.0012) * (0.4 + grain * 0.6);
  }
  return light;
}

vec3 drumWaves(vec3 eye, vec3 dir, float figureDepth) {
  vec3 relative = eye - DRUM;
  float along = dot(relative, dir);
  float square = dot(relative, relative);
  vec3 light = vec3(0.0);
  // Retarded intersections of expanding spherical fronts. Waves are emitted by each contact.
  for (int i = 0; i < 6; i++) {
    float age = mod(uPassage.z + 3.5, BEAT) + float(i) * BEAT;
    if (age > uPassage.z) continue;
    float speed = 0.7;
    float radiusNow = 0.2 + age * speed;
    float coefficient = 1.0 - speed * speed;
    float linear = along + radiusNow * speed;
    float discriminant = linear * linear - coefficient * (square - radiusNow * radiusNow);
    if (discriminant <= 0.0) continue;
    float distance = (-linear - sqrt(discriminant)) / coefficient;
    if (distance <= 0.0) distance = (-linear + sqrt(discriminant)) / coefficient;
    if (distance <= 0.0 || distance > figureDepth) continue;
    float radius = radiusNow - speed * distance;
    if (radius < 0.2) continue;
    vec3 direction = normalize(relative + distance * dir);
    float angle = atan(direction.y, direction.x);
    float latitude = direction.z;
    float grain = filteredDensity(vec2(angle * 31.0 + float(i) * 7.0, latitude * 40.0));
    float lace = abs(sin(angle * 18.0 + latitude * 24.0 + grain * 0.7));
    float vein = 1.0 - smoothstep(0.035, 0.11 + fwidth(lace), lace);
    float belt = exp(-pow((latitude + 0.27) / 0.08, 2.0));
    float rim = pow(max(0.0, 1.0 - abs(dot(direction, dir))), 10.0);
    float fade = exp(-radius * 0.065) * smoothstep(0.2, 1.0, radius);
    fade *= 1.0 + smoothstep(74.0, 76.5, uPassage.z - age) * 0.65;
    light += chamberColor(mix(3300.0, 7500.0, grain)) * fade * (belt * 0.012 + vein * rim * 0.075 + rim * 0.006);
  }
  return light;
}

vec3 chamberDust(vec3 eye, vec3 dir, float figureDepth) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float radius = 4.0 + float(i) * 7.0;
    float along = dot(eye, dir);
    float discriminant = along * along - dot(eye, eye) + radius * radius;
    if (discriminant <= 0.0) continue;
    float distance = -along - sqrt(discriminant);
    if (distance <= 0.0) distance = -along + sqrt(discriminant);
    if (distance <= 0.0 || distance > figureDepth) continue;
    vec3 hit = normalize(eye + distance * dir);
    // A small rotation gives dust its own parallax and keeps it independent of the camera.
    float spin = (uTime - distance) * 0.001;
    hit.xy = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * hit.xy;
    vec3 cell = floor(hit * 75.0);
    vec3 seed = random3(cell, uint(i) + 123u);
    vec3 center = normalize(cell + 0.2 + random3(cell, uint(i) + 91u) * 0.6);
    float separation = length(hit - center) * 75.0;
    float pixel = max(length(dFdx(hit)), length(dFdy(hit))) * 75.0;
    float point = exp(-separation * separation / max(0.003, pixel * pixel));
    point *= 1.0 - step(0.045, seed.x);
    point *= 0.1 + pow(seed.y, 4.0) * 2.0;
    light += chamberColor(mix(3000.0, 12500.0, seed.z)) * point * 0.09;
  }
  return light;
}

vec3 passageLight(vec3 ray) {
  vec3 dir = passageDirection(ray);
  vec3 eye = vec3(0.0, 0.0, -uPassage.y);
  float figureDepth;
  vec4 figure = musician(eye, dir, figureDepth);
  vec3 background = chamberSheets(eye, dir);
  float area = length(cross(dFdx(dir), dFdy(dir)));
  background += stars(dir, dFdx(dir), dFdy(dir), area, 1.0) * 0.18;
  background += distantGalaxy(dir, 1.0) * 0.35;
  // A distant warm cloud gives the silhouette depth without a screen-space vignette.
  vec3 glowCenter = vec3(0.0, 0.35, 3.0);
  float closest = max(0.0, dot(glowCenter - eye, dir));
  vec3 miss = eye + closest * dir - glowCenter;
  background += chamberColor(3700.0) * exp(-dot(miss, miss) / 5.5) * 0.004;
  vec3 light = mix(background, figure.rgb, figure.a);
  float occlusion = figure.a > 0.9 ? figureDepth : 1e4;
  light += chamberOrbits(eye, dir, occlusion);
  light += drumWaves(eye, dir, occlusion);
  light += chamberDust(eye, dir, occlusion);
  return light;
}
`;
