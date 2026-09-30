import { CRITICAL_B, type GeodesicTable } from "./geodesics";

export interface DiskHit {
  angle: number;
  radius: number;
}

const mod = (value: number, period: number) =>
  ((value % period) + period) % period;

function radiusAt(table: GeodesicTable, row: number, phi: number) {
  const at = (phi / table.phiMax) * (table.phiCount - 1);
  const column = Math.floor(at);
  const low = Math.floor(row);
  const cell = (x: number, y: number) =>
    table.u[
      Math.min(table.rows - 1, Math.max(0, y)) * table.phiCount +
        Math.min(table.phiCount - 1, Math.max(0, x))
    ] ?? 0;
  const upper =
    cell(column, low) * (1 - at + column) +
    cell(column + 1, low) * (at - column);
  const lower =
    cell(column, low + 1) * (1 - at + column) +
    cell(column + 1, low + 1) * (at - column);
  return 1 / (upper * (1 - row + low) + lower * (row - low));
}

/** The same inverse light ray as the image shader, evaluated once for the pointer, without GPU readback. */
export function diskHit(
  table: GeodesicTable,
  basis: Float32Array,
  eye: number[],
  offsetX: number,
  offsetY: number
): DiskHit | null {
  const raw = [0, 1, 2].map(
    (i) =>
      (basis[i] ?? 0) * offsetX +
      (basis[i + 3] ?? 0) * offsetY +
      (basis[i + 6] ?? 0)
  );
  const length = Math.hypot(...raw);
  const dir = raw.map((value) => value / length);
  const e1 = eye.map((value) => value / table.distance);
  const cosine = dir.reduce((sum, value, i) => sum + value * (e1[i] ?? 0), 0);
  const across = dir.map((value, i) => value - cosine * (e1[i] ?? 0));
  const sine = Math.hypot(...across);
  if (sine < 1e-7) {
    return null;
  }
  const e2 = across.map((value) => value / sine);
  const b = (table.distance * sine) / Math.sqrt(1 - 1 / table.distance);
  if (b > table.bMax) {
    return null;
  }
  const row =
    b < CRITICAL_B
      ? table.below * (1 - Math.sqrt(Math.max(0, 1 - b / CRITICAL_B)))
      : table.below +
        ((b - CRITICAL_B) / (table.bMax - CRITICAL_B)) ** (1 / 3) *
          (table.rows - 1 - table.below);
  const low = Math.floor(row);
  const a = table.ends[low] ?? 0;
  const bEnd = table.ends[Math.min(low + 1, table.rows - 1)] ?? 0;
  const fraction = row - low;
  const nearestEnd = fraction < 0.5 ? a : bEnd;
  const end =
    Math.sign(a) === Math.sign(bEnd) ? a + (bEnd - a) * fraction : nearestEnd;
  const first = mod(Math.atan2(e2[1] ?? 0, e1[1] ?? 0) + Math.PI / 2, Math.PI);
  for (let image = 0; image < 3; image += 1) {
    const phi = first + image * Math.PI;
    if (phi >= Math.abs(end)) {
      break;
    }
    const radius = radiusAt(table, row, phi);
    if (radius < 3 || radius > 11 || !Number.isFinite(radius)) {
      continue;
    }
    const x = Math.cos(phi) * (e1[0] ?? 0) + Math.sin(phi) * (e2[0] ?? 0);
    const z = Math.cos(phi) * (e1[2] ?? 0) + Math.sin(phi) * (e2[2] ?? 0);
    return { angle: Math.atan2(z, x), radius };
  }
  return null;
}
