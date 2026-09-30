import { START_RADIUS } from "./flight";
import { angleRow, type InfallTable, infallSample } from "./infall-geodesics";

export const OBSERVER_RADIUS = START_RADIUS;
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
  distance: number;
  fov: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  yaw: number;
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

/** A first-person rain observer just above the disk plane; looking never moves the eye. */
export function cameraOf(view: SceneView) {
  const tilt = (84 * Math.PI) / 180;
  const yaw = (view.yaw * Math.PI) / 180;
  const pitch = (view.pitch * Math.PI) / 180;
  const eye: [number, number, number] = [
    0,
    view.distance * Math.cos(tilt),
    -view.distance * Math.sin(tilt),
  ];
  const inward = [0, -Math.cos(tilt), Math.sin(tilt)];
  const horizonUp = [0, Math.sin(tilt), Math.cos(tilt)];
  const side = [-1, 0, 0];
  const right0 = side.map(
    (v, i) => v * Math.cos(yaw) - (inward[i] ?? 0) * Math.sin(yaw)
  );
  const heading = inward.map(
    (v, i) => v * Math.cos(yaw) + (side[i] ?? 0) * Math.sin(yaw)
  );
  const forward = heading.map(
    (v, i) => v * Math.cos(pitch) + (horizonUp[i] ?? 0) * Math.sin(pitch)
  );
  const up0 = horizonUp.map(
    (v, i) => v * Math.cos(pitch) - (heading[i] ?? 0) * Math.sin(pitch)
  );
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
  return (Math.min(width, height) * 0.5) / Math.tan((view.fov * Math.PI) / 360);
}

export function sceneRay(
  table: InfallTable,
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
  const e1 = eye.map((v) => v / view.distance);
  const dot = dir.reduce((sum, v, i) => sum + v * (e1[i] ?? 0), 0);
  const across = dir.map((v, i) => v - dot * (e1[i] ?? 0));
  const sine = Math.hypot(...across);
  if (sine < 1e-8) {
    return null;
  }
  const row = angleRow(Math.acos(Math.max(-1, Math.min(1, -dot))), table);
  const low = Math.floor(row),
    f = row - low;
  const a = table.ends[low] ?? 0,
    c = table.ends[Math.min(low + 1, table.rows - 1)] ?? 0;
  const nearest = f < 0.5 ? a : c;
  const end = Math.sign(a) === Math.sign(c) ? a + (c - a) * f : nearest;
  return { e1, e2: across.map((v) => v / sine), end, row };
}

/** Picking uses the same curved ray, retarded emission time and surface bounds as GLSL. */
export function contactHit(
  table: InfallTable,
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
    const inverse = infallSample(table, table.u, ray.row, phi);
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
    const delay = infallSample(table, table.times, ray.row, phi);
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
