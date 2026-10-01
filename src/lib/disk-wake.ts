import { angleRow, type InfallTable, infallSample } from "./infall-geodesics";
import { cameraOf, focalLength, type SceneView } from "./scene-geometry";

export const WAKE_COUNT = 24;
const TAU = Math.PI * 2;
export const WAVE_SPEED = 0.2;
export const WAVE_LIFETIME = 42;
export const SPLASH_COUNT = 3;

export interface WakeContact {
  impact?: boolean;
  observedTime?: number;
  spin?: 1 | -1;
}

export interface DiskHit {
  angle: number;
  delay: number;
  radius: number;
}

/** Pick the first visible disk crossing with the renderer's curved ray and clock. */
export function pickDisk(
  table: InfallTable,
  view: SceneView,
  width: number,
  height: number,
  x: number,
  y: number
): DiskHit | null {
  const { basis, eye } = cameraOf(view);
  const focal = focalLength(view, width, height);
  const offset = [
    ((x - view.x) * width) / focal,
    ((view.y - y) * height) / focal,
    1,
  ];
  const direction = [0, 1, 2].map((axis) =>
    offset.reduce(
      (sum, value, column) => sum + value * (basis[column * 3 + axis] ?? 0),
      0
    )
  );
  const length = Math.hypot(...direction);
  const e1 = eye.map((value) => value / view.distance);
  const dir = direction.map((value) => value / length);
  const cosine = dir.reduce(
    (sum, value, axis) => sum + value * (e1[axis] ?? 0),
    0
  );
  const across = dir.map((value, axis) => value - cosine * (e1[axis] ?? 0));
  const sine = Math.hypot(...across);
  if (sine < 1e-7) {
    return null;
  }
  const e2 = across.map((value) => value / sine);
  const row = angleRow(Math.acos(Math.max(-1, Math.min(1, -cosine))), table);
  const low = Math.max(0, Math.min(table.rows - 1, Math.floor(row)));
  const a = table.ends[low] ?? 0;
  const b = table.ends[Math.min(low + 1, table.rows - 1)] ?? a;
  let end = row - low < 0.5 ? a : b;
  if (Math.sign(a) === Math.sign(b)) {
    end = a + (b - a) * (row - low);
  }
  let phi =
    (((Math.atan2(e2[1] ?? 0, e1[1] ?? 0) + Math.PI * 0.5) % Math.PI) +
      Math.PI) %
    Math.PI;
  for (
    let image = 0;
    image < 3 && phi < Math.abs(end);
    image += 1, phi += Math.PI
  ) {
    const inverse = infallSample(table, table.u, row, phi);
    const radius = 1 / inverse;
    if (radius < 3.05 || radius > 10.9) {
      continue;
    }
    const hit = e1.map(
      (value, axis) => Math.cos(phi) * value + Math.sin(phi) * (e2[axis] ?? 0)
    );
    return {
      angle: Math.atan2(hit[2] ?? 0, hit[0] ?? 0),
      delay: infallSample(table, table.times, row, phi),
      radius,
    };
  }
  return null;
}

/** Bounded local impulses. Their emission timestamps also drive delayed secondary images. */
export function createDiskWake() {
  const data = new Float32Array(WAKE_COUNT * 4);
  const directions = new Float32Array(WAKE_COUNT * 4);
  const splashes = new Float32Array(WAKE_COUNT * SPLASH_COUNT * 4);
  let count = 0;
  let cursor = 0;
  let previous: {
    hit: DiskHit;
    emissionTime: number;
    observedTime: number;
  } | null = null;
  return {
    clear() {
      count = 0;
      cursor = 0;
      data.fill(0);
      directions.fill(0);
      splashes.fill(0);
      previous = null;
    },
    get count() {
      return count;
    },
    data,
    directions,
    push(
      hit: DiskHit,
      emissionTime: number,
      strength: number,
      contact: WakeContact = {}
    ) {
      const observedTime = contact.observedTime ?? emissionTime;
      const spin = contact.spin ?? -1;
      const lapse = Math.sqrt(1 - 1 / hit.radius);
      let radial = 0;
      let azimuthal = spin;
      let extent = 0;
      const elapsed = previous ? observedTime - previous.observedTime : 0;
      if (previous && elapsed >= 0 && elapsed < 2.5 && !contact.impact) {
        radial = (hit.radius - previous.hit.radius) / lapse;
        // Measure the cut relative to the gas, rather than relative to the screen.
        const omega = Math.sqrt(0.5 / previous.hit.radius ** 3);
        const angle =
          hit.angle -
          previous.hit.angle +
          spin * omega * (emissionTime - previous.emissionTime);
        azimuthal = Math.atan2(Math.sin(angle), Math.cos(angle)) * hit.radius;
        const separation = Math.hypot(radial, azimuthal);
        // Separate images and distant jumps must never be joined by a giant stroke.
        if (separation < 1.8) {
          extent = Math.min(0.85, separation);
        } else {
          radial = 0;
          azimuthal = spin;
        }
      }
      const length = Math.hypot(radial, azimuthal);
      directions.set(
        [
          length > 0.001 ? radial / length : 0,
          length > 0.001 ? azimuthal / length : spin,
          extent,
          contact.impact ? 0 : 1,
        ],
        cursor * 4
      );
      const modulus = 4_294_967_296;
      let seed =
        ((Math.trunc(
          hit.radius * 71_173 + hit.angle * 19_919 + emissionTime * 7919
        ) %
          modulus) +
          modulus) %
        modulus;
      const random = () => {
        seed = (seed * 1_664_525 + 1_013_904_223) % modulus;
        return seed / modulus;
      };
      for (let particle = 0; particle < SPLASH_COUNT; particle += 1) {
        const angle = contact.impact ? random() * TAU : (random() - 0.5) * 2.8;
        const speed = 0.1 + random() * 0.08;
        splashes.set(
          [
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
            0.03 + random() * 0.03,
            random(),
          ],
          (cursor * SPLASH_COUNT + particle) * 4
        );
      }
      data.set(
        [
          hit.radius,
          hit.angle % TAU,
          emissionTime,
          Math.max(0.25, Math.min(1.5, strength)),
        ],
        cursor * 4
      );
      cursor = (cursor + 1) % WAKE_COUNT;
      count = Math.min(WAKE_COUNT, count + 1);
      previous = contact.impact ? null : { emissionTime, hit, observedTime };
    },
    splashes,
  };
}

/** A prescribed, damped pressure packet in disk material coordinates, not a fluid solver. */
export const DISK_WAKE_SHADER = `
uniform int uWakeCount;
uniform vec4 uWakes[${WAKE_COUNT}]; // radius, angle, PG emission time, deposited energy
uniform vec4 uWakeDirections[${WAKE_COUNT}]; // relative direction, swept length, cut/impact
uniform vec4 uWakeSplashes[${WAKE_COUNT * SPLASH_COUNT}]; // relative velocity, material radius, seed

float wakeRidge(float distance, float radius, float width) {
  float edge = abs(distance - radius);
  float pixel = max(fwidth(distance), 0.001);
  return 1.0 - smoothstep(width * 0.25, width + pixel, edge);
}

vec4 diskWake(float r, float psi, float emissionTime, out float splashes) {
  vec4 response = vec4(0.0);
  splashes = 0.0;
  for (int i = 0; i < ${WAKE_COUNT}; i++) {
    if (i >= uWakeCount) break;
    vec4 source = uWakes[i];
    float age = emissionTime - source.z;
    // Permit only rounding error between CPU picking and GPU ray interpolation.
    if (age < -0.005 || age > ${WAVE_LIFETIME.toFixed(1)}) continue;
    age = max(0.0, age);
    float properAge = age * sqrt(1.0 - 1.5 / source.x);
    vec4 stroke = uWakeDirections[i];
    float front = 0.16 + ${WAVE_SPEED.toFixed(2)} * properAge;
    float width = 0.095 + 0.009 * properAge;
    float lapse = sqrt(1.0 - 1.0 / source.x);
    if (abs(r - source.x) / lapse > front + stroke.z + width * 2.0) continue;
    float omega = sqrt(0.5 / (r * r * r));
    float azimuth = psi - source.y + uSpin * omega * age;
    azimuth = atan(sin(azimuth), cos(azimuth));
    vec2 material = vec2((r - source.x) / lapse, source.x * azimuth);
    vec2 direction = stroke.xy;
    float along = dot(material, direction);
    float across = dot(material, vec2(-direction.y, direction.x));
    // A swept contact patch joins adjacent samples; its expanding edges become sheared wings.
    float tailLength = stroke.z * stroke.w;
    float endpoint = along - clamp(along, -tailLength, 0.0);
    float distance = length(vec2(endpoint, across));
    if (distance > front + width * 2.0) continue;
    float strength = source.w * exp(-properAge / 12.0) / sqrt(1.0 + properAge * 0.13);
    float grain = filteredDensity(material * 5.0 + source.xy * 9.0);
    float knots = smoothstep(0.36, 0.76, grain);
    float corrugation = (grain - 0.5) * 0.07 * smoothstep(0.0, 1.2, properAge);
    float primary = wakeRidge(distance, front + corrugation, width);
    float secondary = wakeRidge(distance, 0.08 + properAge * 0.12 - corrugation, width * 0.6);
    float bow = mix(1.0, 0.2 + 0.8 * smoothstep(-tailLength - 0.15, 0.18, along), stroke.w);
    float ridge = primary * bow * (0.4 + knots * 0.6) + secondary * 0.2;
    float grooveWidth = 0.13 + min(properAge, 5.0) * 0.018;
    float groove = (1.0 - smoothstep(grooveWidth * 0.2, grooveWidth + fwidth(distance), distance));
    groove *= exp(-properAge / 6.5);
    float rarefaction = wakeRidge(distance, max(0.0, front - width * 1.8), width * 0.7);
    response.x += strength * (ridge - rarefaction * 0.22 - groove * 1.5);
    response.y += strength * (primary * bow * (0.5 + knots * 0.7) + secondary * 0.14);
    // Resolved material deformation gives tracers a restrained sideways drift at the front.
    float motion = sin(properAge * 2.0) * smoothstep(0.0, 0.7, properAge);
    vec2 outward = distance > 0.001 ? vec2(endpoint, across) / distance : vec2(0.0);
    vec2 shift = direction * outward.x + vec2(-direction.y, direction.x) * outward.y;
    response.zw += shift * strength * primary * motion * 0.09;
    // Hot fragments remain in the disk, advect with it and move slower than the pressure front.
    if (properAge < 12.0) {
      for (int particle = 0; particle < ${SPLASH_COUNT}; particle++) {
        vec4 spark = uWakeSplashes[i * ${SPLASH_COUNT} + particle];
        vec2 velocity = direction * spark.x + vec2(-direction.y, direction.x) * spark.y;
        vec2 origin = -direction * tailLength * spark.w + vec2(-direction.y, direction.x) * (spark.w - 0.5) * 0.1;
        vec2 head = origin + velocity * properAge;
        vec2 tail = head - velocity * min(properAge, 1.1);
        vec2 delta = material - head;
        float reach = spark.z * 3.0 + length(head - tail);
        if (abs(delta.x) > reach || abs(delta.y) > reach) continue;
        vec2 axis = head - tail;
        float alongTail = clamp(dot(material - tail, axis) / max(dot(axis, axis), 0.00001), 0.0, 1.0);
        vec2 filament = material - (tail + axis * alongTail);
        vec2 pixel = fwidth(delta);
        vec2 variance = vec2(spark.z * spark.z) + pixel * pixel * 0.12;
        float radiance = exp(-dot(filament * filament, 1.0 / variance));
        radiance *= spark.z * spark.z / sqrt(variance.x * variance.y);
        float cooling = exp(-properAge / (3.5 + spark.w * 2.0)) * smoothstep(0.0, 0.35, properAge);
        splashes += radiance * cooling * source.w * (0.25 + alongTail * 0.75);
      }
    }
    // Two small counter-rotating eddies bend the material on either side of a cut.
    for (int side = 0; side < 2; side++) {
      float sign = side == 0 ? -1.0 : 1.0;
      vec2 local = vec2(along + tailLength * 0.45, across - sign * 0.24);
      float eddy = exp(-dot(local, local) / 0.09) * stroke.w * strength * smoothstep(0.0, 1.0, properAge);
      vec2 curl = sign * vec2(-local.y, local.x);
      response.zw += (direction * curl.x + vec2(-direction.y, direction.x) * curl.y) * eddy * 0.18;
    }
  }
  // Smooth saturation retains fine structure where neighbouring strokes overlap.
  response.x = response.x < 0.0 ? max(-0.88, response.x) : 1.4 * (1.0 - exp(-response.x / 1.4));
  response.y = 1.2 * (1.0 - exp(-response.y / 1.2));
  response.zw *= min(1.0, 0.12 / max(length(response.zw), 0.0001));
  splashes = 1.6 * (1.0 - exp(-splashes / 1.6));
  return response;
}
`;
