import { CRITICAL_B } from "./geodesics";

/** Ingoing Painleve–Gullstrand time is regular at the future horizon.
 * Each row is a direction in the orthonormal frame of a radial rain observer.
 * Past null k = (-1, sqrt(1/r) e_r + n), E = 1 + sqrt(1/r) n_r.
 * The orbit equation u'' = -u + 3u²/2 is valid on both sides of the horizon. */
export interface InfallTable {
  below: number;
  critical: number;
  distance: number;
  ends: Float32Array;
  phiCount: number;
  rows: number;
  times: Float32Array;
  u: Float32Array;
}

export function shadowAngle(radius: number) {
  const flow = 1 / Math.sqrt(radius);
  const b2 = CRITICAL_B ** 2;
  const root =
    radius * Math.sqrt(Math.max(0, radius ** 2 - b2 * (1 - 1 / radius)));
  const mu =
    (-b2 * flow + (radius < 1.5 ? root : -root)) / (radius ** 2 + b2 / radius);
  return Math.acos(Math.max(-1, Math.min(1, -mu)));
}

export function rowAngle(
  row: number,
  table: Pick<InfallTable, "below" | "critical" | "rows">
) {
  if (row < table.below) {
    return table.critical * (1 - (1 - row / table.below) ** 2);
  }
  return (
    table.critical +
    (Math.PI - table.critical) *
      ((row - table.below) / (table.rows - 1 - table.below)) ** 2
  );
}

export function angleRow(
  angle: number,
  table: Pick<InfallTable, "below" | "critical" | "rows">
) {
  if (angle < table.critical) {
    return (
      table.below * (1 - Math.sqrt(Math.max(0, 1 - angle / table.critical)))
    );
  }
  return (
    table.below +
    Math.sqrt(
      Math.max(0, (angle - table.critical) / (Math.PI - table.critical))
    ) *
      (table.rows - 1 - table.below)
  );
}

export function rainRay(radius: number, angle: number) {
  const theta = Math.max(0.0001, Math.min(Math.PI - 0.0001, angle));
  const flow = 1 / Math.sqrt(radius);
  const angular = radius * Math.sin(theta);
  const energy = 1 - flow * Math.cos(theta);
  return {
    angular,
    energy,
    slope: (Math.cos(theta) - flow) / angular,
    u: 1 / radius,
  };
}

/** Rationalized clock removes the 0/0 at r=1 for past rays arriving from outside. */
export function pgClock(u: number, slope: number, k: number) {
  const inverse = Math.max(u, 0.0001);
  const denominator = inverse ** 2 * (k - Math.sqrt(inverse) * slope);
  return (k * k + inverse ** 3) / Math.max(denominator, 1e-12);
}

interface State {
  slope: number;
  time: number;
  u: number;
}

function advance(state: State, k: number, h: number, clock: boolean) {
  const a = state.slope;
  const av = state.u * (1.5 * state.u - 1);
  const bu = state.u + (h * a) / 2;
  const b = a + (h * av) / 2;
  const bv = bu * (1.5 * bu - 1);
  const cu = state.u + (h * b) / 2;
  const c = a + (h * bv) / 2;
  const cv = cu * (1.5 * cu - 1);
  const du = state.u + h * c;
  const d = a + h * cv;
  const dv = du * (1.5 * du - 1);
  if (clock) {
    state.time +=
      (h / 6) *
      (pgClock(state.u, a, k) +
        2 * pgClock(bu, b, k) +
        2 * pgClock(cu, c, k) +
        pgClock(du, d, k));
  }
  state.u += (h / 6) * (a + 2 * b + 2 * c + d);
  state.slope += (h / 6) * (av + 2 * bv + 2 * cv + dv);
}

function rayEnd(initial: ReturnType<typeof rainRay>) {
  const state: State = { slope: initial.slope, time: 0, u: initial.u };
  let phi = 0;
  for (let step = 0; step < 1800 && phi < 3.3 * Math.PI; step += 1) {
    const h = Math.min(0.018, 0.02 / Math.max(Math.abs(state.slope), 0.01));
    const before = state.u;
    advance(state, initial.energy / initial.angular, h, false);
    if (state.u <= 0) {
      return phi + (h * before) / (before - state.u);
    }
    if (state.slope > 0 && state.u >= 0.9999) {
      return -(phi + h * Math.max(0, (0.9999 - before) / (state.u - before)));
    }
    if (initial.energy <= 0 && state.u <= 1.0001) {
      return -(phi + h * Math.max(0, (before - 1.0001) / (before - state.u)));
    }
    phi += h;
  }
  return -phi;
}

export function infallTable(
  distance: number,
  reusable?: InfallTable
): InfallTable {
  const table: InfallTable = reusable ?? {
    below: 160,
    critical: 0,
    distance,
    ends: new Float32Array(512),
    phiCount: 512,
    rows: 512,
    times: new Float32Array(512 * 512),
    u: new Float32Array(512 * 512),
  };
  table.distance = distance;
  table.critical = shadowAngle(distance);
  for (let row = 0; row < table.rows; row += 1) {
    const ray = rainRay(distance, rowAngle(row, table));
    const traced = rayEnd(ray);
    const end = traced <= 0 ? Math.min(-1e-7, traced) : traced;
    table.ends[row] = end;
    const state: State = { slope: ray.slope, time: 0, u: ray.u };
    const h = Math.abs(end) / (table.phiCount - 1) / 2;
    const offset = row * table.phiCount;
    table.u[offset] = state.u;
    table.times[offset] = 0;
    for (let column = 1; column < table.phiCount; column += 1) {
      advance(state, ray.energy / ray.angular, h, true);
      advance(state, ray.energy / ray.angular, h, true);
      table.u[offset + column] = Math.max(0, state.u);
      table.times[offset + column] = Math.min(state.time, 100_000);
    }
  }
  return table;
}

export function infallSample(
  table: InfallTable,
  data: Float32Array,
  row: number,
  phi: number
) {
  const low = Math.max(0, Math.min(table.rows - 1, Math.floor(row)));
  const sample = (r: number) => {
    const end = Math.abs(table.ends[r] ?? 1);
    const at = Math.max(
      0,
      Math.min(table.phiCount - 1, (phi / end) * (table.phiCount - 1))
    );
    const left = Math.floor(at);
    const a = data[r * table.phiCount + left] ?? 0;
    const b =
      data[r * table.phiCount + Math.min(left + 1, table.phiCount - 1)] ?? a;
    return a + (b - a) * (at - left);
  };
  const a = sample(low),
    b = sample(Math.min(low + 1, table.rows - 1));
  return a + (b - a) * (row - low);
}
