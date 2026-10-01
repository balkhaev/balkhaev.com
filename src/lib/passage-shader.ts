import { SCORE_SHADER } from "./drum-score";

/** A causal score: continuous limbs, elastic membrane, pressure fronts and a passage through the drum. */
export const PASSAGE_SHADER = `
uniform vec4 uPassage; // classical blend, exit observer radius, score clock, exterior blend
uniform vec4 uPassageCamera; // chamber observer xyz, membrane aperture
uniform sampler2D uDrummer;
uniform vec3 uBones[4]; // shoulder, elbow, grip, beater head
uniform vec4 uBody; // lean, breath scale, head inclination, observed clock
uniform float uExitVelocity;
${SCORE_SHADER}
const vec3 DRUM_U = vec3(0.703, -0.289, 0.65);
const vec3 DRUM_V = vec3(0.38, 0.925, 0.0);

vec3 passageDirection(vec3 dir) {
  return vec3(-dir.x, dot(dir, vec3(0.0, 0.994521895, 0.104528463)),
    dot(dir, vec3(0.0, -0.104528463, 0.994521895)));
}
vec3 chamberColor(float temperature) {
  vec3 spectrum = blackbody(temperature);
  vec3 emissivity = mix(vec3(0.32, 0.76, 1.24), vec3(1.24, 0.72, 0.28),
    1.0 - smoothstep(4500.0, 8500.0, temperature));
  return spectrum * emissivity / max(0.0001, dot(spectrum, vec3(0.2126, 0.7152, 0.0722)));
}
vec4 rigTexture(int part, vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  vec4 crop = part == 1 ? vec4(0.36, 0.12, 0.66, 0.91)
    : part == 2 ? vec4(0.355, 0.11, 0.66, 0.84)
    : part == 3 ? vec4(0.35, 0.04, 0.6, 0.945) : vec4(0.0, 0.0, 1.0, 1.0);
  vec2 cell = vec2(float(part % 2), float(part / 2));
  vec4 texel = texture(uDrummer, (mix(crop.xy, crop.zw, uv) + cell) * 0.5);
  texel.rgb = pow(texel.rgb, vec3(2.2)) * 0.16;
  return texel;
}
vec4 bodySurface(vec3 eye, vec3 dir, out float depth) {
  depth = 1e4;
  if (abs(dir.z) < 0.0001) return vec4(0.0);
  float distance = -eye.z / dir.z;
  if (distance < 0.0) return vec4(0.0);
  vec2 hit = eye.xy + distance * dir.xy;
  // Inverse skinning: the hips stay anchored while chest, head and cloth move continuously.
  hit.y += 0.35;
  float c = cos(uBody.x), s = sin(uBody.x);
  hit = mat2(c, -s, s, c) * hit;
  hit.y = hit.y / uBody.y - 0.35;
  float neck = smoothstep(1.1, 1.45, hit.y);
  vec2 head = hit - vec2(-0.02, 1.1);
  c = cos(uBody.z * neck); s = sin(uBody.z * neck);
  hit = mat2(c, -s, s, c) * head + vec2(-0.02, 1.1);
  hit.x -= sin(hit.y * 8.0 + uBody.w * 0.16) * 0.008 * (1.0 - smoothstep(-0.7, 0.0, hit.y)) * smoothstep(-1.85, -1.5, hit.y);
  vec2 uv = hit / 3.9 + 0.5;
  depth = distance;
  return rigTexture(0, vec2(uv.x, 1.0 - uv.y));
}
vec4 boneSurface(vec3 eye, vec3 dir, vec3 from, vec3 to, float width, int part, out float depth) {
  depth = 1e4;
  vec3 axis = normalize(to - from);
  vec3 across = normalize(cross(vec3(0.0, 0.0, 1.0), axis));
  vec3 normal = cross(across, axis);
  float denominator = dot(dir, normal);
  if (abs(denominator) < 0.0001) return vec4(0.0);
  float distance = dot(from - eye, normal) / denominator;
  if (distance < 0.0) return vec4(0.0);
  vec3 hit = eye + distance * dir - from;
  vec2 uv = vec2(0.5 + dot(hit, across) / width, dot(hit, axis) / length(to - from));
  if (part == 3) uv.y = 1.0 - uv.y;
  depth = distance;
  return rigTexture(part, uv);
}
vec4 musician(vec3 eye, vec3 dir, out float depth, out float limbDepth) {
  vec4 surfaces[4];
  float depths[4];
  surfaces[0] = bodySurface(eye, dir, depths[0]);
  vec3 upper = normalize(uBones[1] - uBones[0]);
  vec3 lower = normalize(uBones[2] - uBones[1]);
  vec3 mallet = normalize(uBones[3] - uBones[2]);
  surfaces[1] = boneSurface(eye, dir, uBones[0] - upper * 0.04, uBones[1] + upper * 0.06, 0.38, 1, depths[1]);
  surfaces[2] = boneSurface(eye, dir, uBones[1] - lower * 0.055, uBones[2] + lower * 0.07, 0.33, 2, depths[2]);
  surfaces[3] = boneSurface(eye, dir, uBones[2] - mallet * 0.1, uBones[3] + mallet * 0.13, 0.23, 3, depths[3]);
  // Four planes are composited in actual ray order, including the shaft behind the fingers.
  vec4 figure = vec4(0.0);
  depth = 1e4;
  limbDepth = 1e4;
  for (int order = 0; order < 4; order++) {
    int farthest = -1;
    float farDepth = -1.0;
    for (int i = 0; i < 4; i++) {
      if (depths[i] > farDepth) { farthest = i; farDepth = depths[i]; }
    }
    if (farthest < 0) continue;
    vec4 part = surfaces[farthest];
    figure.rgb = mix(figure.rgb, part.rgb, part.a);
    figure.a = part.a + figure.a * (1.0 - part.a);
    if (part.a > 0.9) depth = min(depth, farDepth);
    if (part.a > 0.9 && farthest > 0) limbDepth = min(limbDepth, farDepth);
    depths[farthest] = -1.0;
  }
  figure.rgb /= max(figure.a, 0.0001);
  figure.rgb *= vec3(0.91, 0.94, 1.02) * (1.0 + scorePulse(uBody.w) * 0.2);
  return figure;
}

vec3 chamberSheets(vec3 eye, vec3 dir) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float layer = float(i);
    float radius = 6.3 + layer * 1.3;
    float distance = radius / max(0.0001, length(dir.xy));
    vec3 hit = eye + distance * dir;
    if (hit.z < -45.0 || hit.z > 16.0 || distance > 100.0) continue;
    float angle = atan(hit.y, hit.x);
    float emission = uPassage.z - distance;
    float wave = pressureAt(length(hit - DRUM), emission);
    float phase = angle * 2.0 + hit.z * 0.16 + layer * 2.0 - wave * 0.11;
    float cloud = filteredDensity(vec2(angle * 9.0 + layer * 12.0, hit.z * 0.8 - uTime * 0.014));
    float fold = pow(max(0.0, sin(phase + sin(hit.z * 0.09) * 1.2)), 16.0);
    float strand = abs(sin(phase * 12.0 + cloud * 3.0));
    float thread = 1.0 - smoothstep(0.02, 0.06 + fwidth(strand), strand);
    float edge = smoothstep(-45.0, -30.0, hit.z) * (1.0 - smoothstep(7.0, 16.0, hit.z));
    float density = fold * edge * exp(-distance * 0.024) * (0.00065 + thread * 0.006) * (1.0 + wave * 2.5);
    light += chamberColor(layer < 0.5 ? 3500.0 : 11000.0) * density;
  }
  return light;
}
vec3 chamberFloor(vec3 eye, vec3 dir, float figureDepth) {
  if (abs(dir.y) < 0.0001) return vec3(0.0);
  float distance = (-1.94 - eye.y) / dir.y;
  if (distance <= 0.0 || distance > figureDepth) return vec3(0.0);
  vec3 hit = eye + distance * dir;
  float radius = length(hit.xz);
  if (radius > 7.0) return vec3(0.0);
  float angle = atan(hit.z, hit.x);
  float grain = filteredDensity(hit.xz * 35.0);
  float sourceDistance = length(hit - DRUM);
  float wave = pressureAt(sourceDistance, uPassage.z - distance);
  float phase = radius * 16.0 + angle * 3.0 + grain * 1.4 - wave * 0.15;
  float seam = 1.0 - smoothstep(0.01, 0.07 + fwidth(phase), abs(sin(phase)));
  float edge = 1.0 - smoothstep(4.0, 7.0, radius);
  float shadow = 1.0 - 0.93 * exp(-hit.z * hit.z / 0.2 - pow((abs(hit.x) - 0.33) / 0.28, 2.0));
  vec3 light = chamberColor(3400.0) * (0.0015 + seam * 0.0025 + wave * 0.01) * edge * shadow;
  return light * exp(-distance * 0.012);
}
vec3 pressureFronts(vec3 eye, vec3 dir, float figureDepth) {
  vec3 relative = eye - DRUM;
  float along = dot(relative, dir), square = dot(relative, relative);
  vec3 light = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float age = uPassage.z - STRIKES[i];
    if (age < 0.0) continue;
    float speed = 0.65;
    float radiusNow = 0.02 + age * speed;
    float coefficient = 1.0 - speed * speed;
    float linear = along + radiusNow * speed;
    float discriminant = linear * linear - coefficient * (square - radiusNow * radiusNow);
    if (discriminant <= 0.0) continue;
    float distance = (-linear - sqrt(discriminant)) / coefficient;
    if (distance <= 0.0) distance = (-linear + sqrt(discriminant)) / coefficient;
    if (distance <= 0.0 || distance > figureDepth) continue;
    float radius = radiusNow - speed * distance;
    if (radius < 0.02) continue;
    vec3 hit = normalize(relative + distance * dir);
    float latitude = hit.z, angle = atan(hit.y, hit.x);
    float rim = pow(max(0.0, 1.0 - abs(dot(hit, dir))), 14.0);
    float lace = abs(sin(angle * 16.0 + latitude * 12.0));
    float fibre = 1.0 - smoothstep(0.02, 0.075 + fwidth(lace), lace);
    float fade = exp(-radius * 0.095) * smoothstep(0.1, 0.8, radius);
    light += chamberColor(i == 3 ? 7000.0 : 3700.0) * rim * fade * (0.012 + fibre * 0.055) * (i == 3 ? 1.8 : 1.0);
  }
  return light;
}
vec3 chamberDust(vec3 eye, vec3 dir, float figureDepth) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float radius = 4.0 + float(i) * 8.0;
    float along = dot(eye, dir);
    float discriminant = along * along - dot(eye, eye) + radius * radius;
    if (discriminant <= 0.0) continue;
    float distance = -along - sqrt(discriminant);
    if (distance <= 0.0) distance = -along + sqrt(discriminant);
    if (distance <= 0.0 || distance > figureDepth) continue;
    vec3 hit = normalize(eye + distance * dir);
    vec3 cell = floor(hit * 65.0);
    vec3 seed = random3(cell, uint(i) + 123u);
    vec3 center = normalize(cell + 0.2 + random3(cell, uint(i) + 91u) * 0.6);
    float separation = length(hit - center) * 65.0;
    float pixel = max(length(dFdx(hit)), length(dFdy(hit))) * 65.0;
    float point = exp(-separation * separation / max(0.003, pixel * pixel));
    point *= (1.0 - step(0.018, seed.x)) * pow(seed.y, 3.0);
    float wave = pressureAt(length(eye + distance * dir - DRUM), uPassage.z - distance);
    light += chamberColor(mix(3200.0, 12500.0, seed.z)) * point * (0.07 + wave * 0.08);
  }
  return light;
}

vec3 whiteExterior(vec3 dir) {
  vec3 eye = vec3(0.0, 0.0, -uPassage.y);
  float velocity = -uExitVelocity;
  float gamma = inversesqrt(1.0 - velocity * velocity);
  float denominator = max(0.01, 1.0 - velocity * dir.z);
  float shift = 1.0 / (gamma * denominator);
  vec3 worldRay = vec3(dir.xy / (gamma * denominator), (dir.z - velocity) / denominator);
  vec3 sky = vec3(worldRay.x * 0.65 + worldRay.z * 0.76, worldRay.y, -worldRay.x * 0.76 + worldRay.z * 0.65);
  float area = length(cross(dFdx(dir), dFdy(dir)));
  vec3 light = stars(sky, dFdx(sky), dFdy(sky), area, shift) * 0.8 + distantGalaxy(sky, shift) * 2.5;
  float along = dot(eye, worldRay), square = dot(eye, eye);
  float core = along * along - square + 0.72;
  float pixel = max(fwidth(core), 0.0001);
  float depth = 1e4;
  if (along < 0.0 && core > -pixel) {
    depth = -along - sqrt(max(0.0, core));
    vec3 point = eye + depth * worldRay;
    vec2 surfaceFlow = point.xy * 42.0 + point.z * 9.0 + vec2(uPassage.z * 0.012, 0.0);
    float grain = filteredDensity(surfaceFlow);
    float cells = filteredDensity(surfaceFlow * 3.5 + grain * 2.0);
    float limb = pow(max(0.0, 1.0 - core / 0.72), 2.0);
    vec3 surface = chamberColor(9500.0 * shift) * (0.15 + grain * 0.07 + cells * 0.025);
    surface += chamberColor(4700.0) * limb * 0.065;
    light = mix(light, surface, smoothstep(-pixel, pixel, core));
  }
  float plume = along * along - square + 144.0;
  if (plume > 0.0) {
    float start = max(0.0, -along - sqrt(plume));
    float end = min(depth, -along + sqrt(plume));
    float stepLength = max(0.0, end - start) / 9.0;
    for (int i = 0; i < 9; i++) {
      float distance = start + (float(i) + 0.5) * stepLength;
      vec3 point = eye + distance * worldRay;
      float radius = length(point);
      if (radius < 0.9 || radius > 12.0) continue;
      float angle = atan(point.y, point.x);
      float emission = uPassage.z - distance;
      float launch = emission - (radius - 0.9) / 0.52;
      float latitude = point.z / radius;
      float coil = abs(sin(angle * 5.0 - launch * 0.07 + latitude * 3.0));
      float filament = 1.0 - smoothstep(0.02, 0.11 + fwidth(coil), coil);
      float belt = exp(-pow((latitude - 0.15 * sin(angle * 2.0)) / 0.55, 2.0));
      belt += 0.2 * exp(-(1.0 - abs(latitude)) / 0.16);
      float grain = filteredDensity(vec2(angle * 32.0, radius * 5.0 - launch * 0.07));
      float burst = exp(-pow((launch - STRIKES[3]) / 8.0, 2.0));
      float density = belt * (0.05 + 0.95 * filament) * (0.4 + grain * 0.6) * (0.3 + burst) / (1.0 + radius * radius * 0.07);
      light += chamberColor(6000.0 + grain * 5000.0) * density * stepLength * 0.009;
    }
  }
  return light;
}

vec3 drumMembrane(vec3 eye, vec3 dir, vec3 under, out float depth) {
  depth = 1e4;
  vec3 normal = normalize(cross(DRUM_U, DRUM_V));
  float denominator = dot(dir, normal);
  if (abs(denominator) < 0.0001) return under;
  float distance = dot(DRUM - eye, normal) / denominator;
  if (distance <= 0.0) return under;
  vec3 hit = eye + distance * dir - DRUM;
  vec2 local = vec2(dot(hit, DRUM_U), dot(hit, DRUM_V));
  float radius = length(local) / DRUM_RADIUS;
  float pixel = max(0.003, fwidth(radius));
  if (radius > 1.0 + pixel) return under;
  depth = distance;
  float emission = uBody.w;
  float displacement = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = emission - STRIKES[i];
    if (age < 0.0) continue;
    displacement += sin(radius * 18.0 - age * 9.0) * exp(-age * 1.2) * pow(max(0.0, 1.0 - radius * radius), 2.0) * (i == 3 ? 2.0 : 1.0);
  }
  float grain = filteredDensity(local * 85.0);
  vec3 membrane = under * (1.0 + displacement * 0.14);
  membrane += chamberColor(3400.0) * max(0.0, displacement) * 0.06;
  float opening = uPassageCamera.w;
  if (opening > 0.0) {
    float iris = radius - opening;
    float inside = 1.0 - smoothstep(-pixel, pixel, iris);
    float rim = exp(-iris * iris / 0.0008);
    vec3 beyond = whiteExterior(normalize(vec3(local * 1.3, 1.0)));
    beyond += chamberColor(10000.0) * exp(-dot(local, local) * 14.0) * 0.07;
    membrane = mix(membrane, beyond, inside);
    membrane += chamberColor(5700.0) * rim * (0.065 + grain * 0.012);
  }
  return mix(under, membrane, 1.0 - smoothstep(1.0 - pixel, 1.0 + pixel, radius));
}
vec3 chamberLight(vec3 dir) {
  vec3 eye = uPassageCamera.xyz;
  float figureDepth;
  float limbDepth;
  vec4 figure = musician(eye, dir, figureDepth, limbDepth);
  vec3 light = chamberSheets(eye, dir);
  float area = length(cross(dFdx(dir), dFdy(dir)));
  light += stars(dir, dFdx(dir), dFdy(dir), area, 1.0) * 0.075;
  light += distantGalaxy(dir, 1.0) * 0.12;
  vec3 glowCenter = vec3(0.0, 0.45, 2.0);
  float closest = max(0.0, dot(glowCenter - eye, dir));
  vec3 miss = eye + closest * dir - glowCenter;
  light += chamberColor(3400.0) * exp(-dot(miss, miss) / 3.0) * 0.0025;
  light = mix(light, figure.rgb, figure.a);
  float occlusion = figure.a > 0.9 ? figureDepth : 1e4;
  float membraneDepth;
  light = drumMembrane(eye, dir, light, membraneDepth);
  // Fingers and the beater stay in front of the membrane.
  if (figure.a > 0.9 && limbDepth < membraneDepth - 0.035) light = figure.rgb;
  occlusion = min(occlusion, membraneDepth);
  light += chamberFloor(eye, dir, occlusion);
  light += pressureFronts(eye, dir, occlusion);
  light += chamberDust(eye, dir, occlusion);
  return light;
}
vec3 passageLight(vec3 ray) {
  vec3 dir = passageDirection(ray);
  if (uPassage.w >= 1.0) return whiteExterior(dir);
  vec3 chamber = chamberLight(dir);
  if (uPassage.w <= 0.0) return chamber;
  return mix(chamber, whiteExterior(dir), uPassage.w);
}
`;
