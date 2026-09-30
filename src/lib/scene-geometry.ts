import { CRITICAL_B, type GeodesicTable } from "./geodesics";

export const OBSERVER_RADIUS = 60;
export const CLOCK_RATE = 3.8;
export const CONTACT_TILT = (70 * Math.PI) / 180;
export const CONTACT_UP = [
  0,
  Math.cos(CONTACT_TILT),
  Math.sin(CONTACT_TILT),
] as const;
export const CONTACT_NORMAL = [0, -CONTACT_UP[2], CONTACT_UP[1]] as const;
export const CONTACTS = [
  {
    height: 3.3,
    href: "https://t.me/balkhaev",
    label: "@balkhaev",
    phase: 1.88,
    radius: 14.5,
    width: 5.2,
  },
  {
    height: 3.3,
    href: "mailto:m.balkhaev@gmail.com",
    label: "Email ↗",
    phase: 1.2,
    radius: 20.5,
    width: 4.5,
  },
] as const;

export interface SceneView {
  azimuth?: number;
  inclination: number;
  roll: number;
  size: number;
  x: number;
  y: number;
}

export const orbitRate = (radius: number) => Math.sqrt(0.5 / radius ** 3);

export function contactPosition(index: number, time: number) {
  const body = CONTACTS[index];
  if (!body) {
    return { x: 0, y: 0, z: 0 };
  }
  const angle = body.phase + orbitRate(body.radius) * time;
  return {
    x: body.radius * Math.cos(angle),
    y: body.radius * Math.sin(angle) * CONTACT_UP[1],
    z: body.radius * Math.sin(angle) * CONTACT_UP[2],
  };
}

/** Stationary Schwarzschild observer. Changing the viewpoint selects another observer;
 * camera navigation is not interpreted as a physical spacecraft trajectory. */
export function cameraOf(view: SceneView) {
  const tilt = (view.inclination * Math.PI) / 180;
  const yaw = ((view.azimuth ?? 0) * Math.PI) / 180;
  const eye: [number, number, number] = [
    OBSERVER_RADIUS * Math.sin(tilt) * Math.sin(yaw),
    OBSERVER_RADIUS * Math.cos(tilt),
    -OBSERVER_RADIUS * Math.sin(tilt) * Math.cos(yaw),
  ];
  const forward = eye.map((value) => -value / OBSERVER_RADIUS);
  const right0 = [-Math.cos(yaw), 0, -Math.sin(yaw)];
  const up0 = [
    -Math.cos(tilt) * Math.sin(yaw),
    Math.sin(tilt),
    Math.cos(tilt) * Math.cos(yaw),
  ];
  const roll = (view.roll * Math.PI) / 180;
  const right = right0.map(
    (value, i) => value * Math.cos(roll) + (up0[i] ?? 0) * Math.sin(roll)
  );
  const up = up0.map(
    (value, i) => value * Math.cos(roll) - (right0[i] ?? 0) * Math.sin(roll)
  );
  return { basis: new Float32Array([...right, ...up, ...forward]), eye };
}

export function focalLength(view: SceneView, width: number, height: number) {
  const sine =
    (CRITICAL_B * Math.sqrt(1 - 1 / OBSERVER_RADIUS)) / OBSERVER_RADIUS;
  return (view.size * Math.min(width, height)) / Math.tan(Math.asin(sine));
}

/** Change the observer's optics, never the bodies, to keep the primary scene framed. */
export function fittedSize(
  view: SceneView,
  width: number,
  height: number,
  time: number
) {
  const { basis, eye } = cameraOf(view);
  let extentX = 0.2;
  let extentY = 0.12;
  for (const [index, body] of CONTACTS.entries()) {
    for (const delay of [-16, 0, 16]) {
      const point = contactPosition(index, time + delay);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = point.x + (sx * body.width) / 2;
          const y = point.y + (sy * body.height * CONTACT_UP[1]) / 2;
          const z = point.z + (sy * body.height * CONTACT_UP[2]) / 2;
          const depth =
            OBSERVER_RADIUS -
            (x * eye[0] + y * eye[1] + z * eye[2]) / OBSERVER_RADIUS;
          extentX = Math.max(
            extentX,
            Math.abs(
              (x * (basis[0] ?? 0) +
                y * (basis[1] ?? 0) +
                z * (basis[2] ?? 0)) /
                depth
            ) * 1.06
          );
          extentY = Math.max(
            extentY,
            Math.abs(
              (x * (basis[3] ?? 0) +
                y * (basis[4] ?? 0) +
                z * (basis[5] ?? 0)) /
                depth
            ) * 1.06
          );
        }
      }
    }
  }
  const size =
    (Math.min(width / 22, height / 25) * CRITICAL_B) / Math.min(width, height);
  const focal = focalLength({ ...view, size }, width, height);
  return (
    size *
    Math.min(
      1,
      (width / 2 - 18) / (focal * extentX),
      (height * 0.45 - 28) / (focal * extentY)
    )
  );
}

export function tableSample(
  table: GeodesicTable,
  data: Float32Array,
  row: number,
  phi: number
) {
  const column = (phi / table.phiMax) * (table.phiCount - 1);
  const x = Math.floor(column),
    y = Math.floor(row);
  const cell = (dx: number, dy: number) =>
    data[
      Math.max(0, Math.min(table.rows - 1, y + dy)) * table.phiCount +
        Math.max(0, Math.min(table.phiCount - 1, x + dx))
    ] ?? 0;
  const f = column - x,
    g = row - y;
  return (
    (cell(0, 0) * (1 - f) + cell(1, 0) * f) * (1 - g) +
    (cell(0, 1) * (1 - f) + cell(1, 1) * f) * g
  );
}

export function sceneRay(
  table: GeodesicTable,
  view: SceneView,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const { basis, eye } = cameraOf(view);
  const focal = focalLength(view, width, height);
  const ox = (x - width * view.x) / focal;
  const oy = (height * view.y - y) / focal;
  const raw = [0, 1, 2].map(
    (i) => (basis[i] ?? 0) * ox + (basis[i + 3] ?? 0) * oy + (basis[i + 6] ?? 0)
  );
  const norm = Math.hypot(...raw);
  const dir = raw.map((v) => v / norm);
  const e1 = eye.map((v) => v / OBSERVER_RADIUS);
  const dot = dir.reduce((sum, v, i) => sum + v * (e1[i] ?? 0), 0);
  const across = dir.map((v, i) => v - dot * (e1[i] ?? 0));
  const sine = Math.hypot(...across);
  if (sine < 1e-8) {
    return null;
  }
  const b = (OBSERVER_RADIUS * sine) / Math.sqrt(1 - 1 / OBSERVER_RADIUS);
  if (b > table.bMax) {
    return null;
  }
  const row =
    b < CRITICAL_B
      ? table.below * (1 - Math.sqrt(1 - b / CRITICAL_B))
      : table.below +
        ((b - CRITICAL_B) / (table.bMax - CRITICAL_B)) ** (1 / 3) *
          (table.rows - 1 - table.below);
  const low = Math.floor(row),
    f = row - low;
  const a = table.ends[low] ?? 0,
    c = table.ends[Math.min(low + 1, table.rows - 1)] ?? 0;
  const nearest = f < 0.5 ? a : c;
  const end = Math.sign(a) === Math.sign(c) ? a + (c - a) * f : nearest;
  return { b, e1, e2: across.map((v) => v / sine), end, row };
}

/** Picking uses the same curved ray, retarded emission time and surface bounds as GLSL. */
export function contactHit(
  table: GeodesicTable,
  view: SceneView,
  width: number,
  height: number,
  x: number,
  y: number,
  time: number,
  images = 3
) {
  const ray = sceneRay(table, view, width, height, x, y);
  if (!ray) {
    return -1;
  }
  const planeDot = (v: number[]) =>
    (v[1] ?? 0) * CONTACT_NORMAL[1] + (v[2] ?? 0) * CONTACT_NORMAL[2];
  const first =
    (((Math.atan2(planeDot(ray.e2), planeDot(ray.e1)) + Math.PI / 2) %
      Math.PI) +
      Math.PI) %
    Math.PI;
  for (let image = 0; image < images; image += 1) {
    const phi = first + image * Math.PI;
    if (phi >= Math.abs(ray.end)) {
      break;
    }
    const inverse = tableSample(table, table.u, ray.row, phi);
    if (inverse <= 0 || inverse >= 1) {
      continue;
    }
    const hx =
      (Math.cos(phi) * (ray.e1[0] ?? 0) + Math.sin(phi) * (ray.e2[0] ?? 0)) /
      inverse;
    const hy =
      (Math.cos(phi) *
        ((ray.e1[1] ?? 0) * CONTACT_UP[1] + (ray.e1[2] ?? 0) * CONTACT_UP[2]) +
        Math.sin(phi) *
          ((ray.e2[1] ?? 0) * CONTACT_UP[1] +
            (ray.e2[2] ?? 0) * CONTACT_UP[2])) /
      inverse;
    const delay = tableSample(table, table.times, ray.row, phi);
    for (const [index, body] of CONTACTS.entries()) {
      const center = contactPosition(index, time - delay + OBSERVER_RADIUS);
      if (
        Math.abs(hx - center.x) <= body.width / 2 &&
        Math.abs(hy - center.y * CONTACT_UP[1] - center.z * CONTACT_UP[2]) <=
          body.height / 2
      ) {
        return index;
      }
    }
  }
  return -1;
}
