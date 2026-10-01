import { angleRow, type InfallTable, infallSample } from "./infall-geodesics";
import { cameraOf, focalLength, type SceneView } from "./scene-geometry";

export const WAKE_COUNT = 16;
const TAU = Math.PI * 2;

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
  const directions = new Float32Array(WAKE_COUNT * 2);
  let count = 0;
  let cursor = 0;
  let previous: DiskHit | null = null;
  return {
    clear() {
      count = 0;
      cursor = 0;
      data.fill(0);
      directions.fill(0);
      previous = null;
    },
    get count() {
      return count;
    },
    data,
    directions,
    push(hit: DiskHit, emissionTime: number, strength: number) {
      let radial = 0;
      let azimuthal = 1;
      if (previous) {
        radial = hit.radius - previous.radius;
        const angle = hit.angle - previous.angle;
        azimuthal = Math.atan2(Math.sin(angle), Math.cos(angle)) * hit.radius;
      }
      const length = Math.hypot(radial, azimuthal);
      directions.set(
        length > 0.001 ? [radial / length, azimuthal / length] : [0, 1],
        cursor * 2
      );
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
      previous = hit;
    },
  };
}

/** A prescribed, damped pressure packet in disk material coordinates, not a fluid solver. */
export const DISK_WAKE_SHADER = `
uniform int uWakeCount;
uniform vec4 uWakes[${WAKE_COUNT}]; // radius, angle, PG emission time, deposited energy
uniform vec2 uWakeDirections[${WAKE_COUNT}];

vec2 diskWake(float r, float psi, float emissionTime) {
  vec2 response = vec2(0.0);
  for (int i = 0; i < ${WAKE_COUNT}; i++) {
    if (i >= uWakeCount) break;
    vec4 source = uWakes[i];
    float age = emissionTime - source.z;
    // Permit only rounding error between CPU picking and GPU ray interpolation.
    if (age < -0.005 || age > 70.0) continue;
    age = max(0.0, age);
    float properAge = age * sqrt(1.0 - 1.5 / source.x);
    float omega = sqrt(0.5 / (r * r * r));
    float azimuth = psi - source.y + uSpin * omega * age;
    azimuth = atan(sin(azimuth), cos(azimuth));
    vec2 material = vec2(r - source.x, source.x * azimuth);
    vec2 direction = uWakeDirections[i];
    float along = dot(material, direction);
    float across = dot(material, vec2(-direction.y, direction.x));
    float distance = length(vec2(along * 0.7, across));
    // An elongated contact patch; group propagation remains below 0.26 c.
    float front = 0.32 + 0.18 * properAge;
    float width = 0.22 + 0.008 * properAge;
    if (distance > front + width) continue;
    float strength = source.w * exp(-properAge / 9.0) / sqrt(1.0 + properAge * 0.16);
    float rim = max(0.0, 1.0 - abs(distance - front) / width);
    rim = rim * rim * (3.0 - 2.0 * rim);
    // The bow is stronger ahead of the cut; thermal grains break up the rim.
    rim *= (0.35 + 0.65 * smoothstep(-0.3, 0.25, along)) * (0.55 + 0.45 * filteredDensity(material * 15.0 + source.xy));
    float groove = max(0.0, 1.0 - distance / 0.34);
    response.x += strength * (rim * 0.75 - groove * groove * 1.8 * exp(-properAge / 4.5));
    response.y += strength * rim;
  }
  return vec2(clamp(response.x, -0.9, 1.8), min(response.y, 2.5));
}
`;
