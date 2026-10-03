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
  /** PG travel-time residual after subtracting the radial incoming-light clock. */
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

/** Integral of dT/dr for radial incoming light; removes the far-emitter divergence. */
export function radialClock(radius: number) {
  const root = Math.sqrt(radius);
  return radius - 2 * root + 2 * Math.log1p(root);
}

/** dT/dφ - d(radialClock(1/u))/dφ; rationalize k+s using the null first integral. */
function residualClock(u: number, slope: number, k: number) {
  const inverse = Math.max(u, 0.0001);
  const root = Math.sqrt(inverse);
  const angular =
    k > 0 && slope < 0
      ? (k * (1 - inverse)) / (k - slope)
      : (k * (k + slope)) / inverse ** 2;
  return (
    (angular + inverse + root) /
    Math.max((k - root * slope) * (1 + root), 1e-12)
  );
}

export function columnPhi(column: number, end: number, count: number) {
  const fraction = column / (count - 1);
  return (
    Math.abs(end) *
    (fraction < 0.5 ? 2 * fraction ** 2 : 1 - 2 * (1 - fraction) ** 2)
  );
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
      (residualClock(state.u, a, k) +
        2 * residualClock(bu, b, k) +
        2 * residualClock(cu, c, k) +
        residualClock(du, d, k));
  }
  state.u += (h / 6) * (a + 2 * b + 2 * c + d);
  state.slope += (h / 6) * (av + 2 * bv + 2 * cv + dv);
}

function rayEnd(initial: ReturnType<typeof rainRay>) {
  const state: State = { slope: initial.slope, time: 0, u: initial.u };
  const k = initial.energy / initial.angular;
  let phi = 0;
  for (let step = 0; step < 1800 && phi < 3.3 * Math.PI; step += 1) {
    const h = Math.min(
      0.018,
      (0.02 * Math.max(1, state.u)) / Math.max(Math.abs(state.slope), 0.01)
    );
    const before = state.u;
    advance(state, k, h, false);
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
  // The observer and far-emitter spacing is shared by every ray. Keep it in double precision.
  const fractions = new Float64Array(table.phiCount);
  for (let column = 1; column < table.phiCount; column += 1) {
    fractions[column] = columnPhi(column, 1, table.phiCount);
  }
  for (let row = 0; row < table.rows; row += 1) {
    const ray = rainRay(distance, rowAngle(row, table));
    const k = ray.energy / ray.angular;
    const traced = rayEnd(ray);
    const end = traced <= 0 ? Math.min(-1e-7, traced) : traced;
    table.ends[row] = end;
    const state: State = { slope: ray.slope, time: 0, u: ray.u };
    let phi = 0;
    const offset = row * table.phiCount;
    table.u[offset] = state.u;
    table.times[offset] = 0;
    for (let column = 1; column < table.phiCount; column += 1) {
      // Quadratic spacing resolves both the observer and distant emitters close to escape.
      const target = Math.abs(end) * (fractions[column] ?? 0);
      // RK4 needs one bounded step on regular escaping segments. Preserve the finer
      // integration inside the horizon and on captured paths, where the PG clock is stiff.
      const maxStep = Math.min(
        0.018,
        (target - phi) * (end > 0 && state.u <= 1 ? 1 : 0.5)
      );
      // Resolve the high curvature at small r without wasting the ray-end iteration budget.
      while (phi < target) {
        const h = Math.min(
          maxStep,
          target - phi,
          (0.02 * Math.max(1, state.u)) / Math.max(Math.abs(state.slope), 0.01)
        );
        advance(state, k, h, true);
        phi += h;
      }
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
    const fraction = Math.max(0, Math.min(1, phi / end));
    const at =
      (fraction < 0.5
        ? Math.sqrt(fraction * 0.5)
        : 1 - Math.sqrt((1 - fraction) * 0.5)) *
      (table.phiCount - 1);
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

export function infallDelay(table: InfallTable, row: number, phi: number) {
  const u = infallSample(table, table.u, row, phi);
  return (
    infallSample(table, table.times, row, phi) +
    radialClock(1 / Math.max(u, 0.0001)) -
    radialClock(table.distance)
  );
}

export interface FiniteSkyMap {
  /** Per row: angle at source sphere (-1 if captured), PG delay, dPhi/dTheta, reserved. */
  data: Float32Array;
  firstValidRow: number;
  sourceRadius: number;
}

function finiteSphereCrossing(
  table: InfallTable,
  row: number,
  inverse: number,
  radialDelay: number
) {
  const end = table.ends[row] ?? 0;
  if (!(end > 0)) {
    return null;
  }
  // Keep the exact radial limit closed at phi=0, beyond the integrator's
  // tiny angular regularization of theta=pi.
  if (row === table.rows - 1) {
    return { delay: radialDelay, phi: 0 };
  }
  const offset = row * table.phiCount;
  let low = 0;
  let high = table.phiCount - 1;
  if ((table.u[offset + high] ?? 0) > inverse) {
    return null;
  }
  // R exceeds the observer radius. A turning escaping ray also has exactly
  // one crossing of this outer sphere, on its outer segment.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if ((table.u[offset + middle] ?? 0) > inverse) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = table.u[offset + low] ?? 0;
  const b = table.u[offset + high] ?? 0;
  const blend = (inverse - a) / (b - a);
  const residualA = table.times[offset + low] ?? 0;
  const residualB = table.times[offset + high] ?? 0;
  const phi = columnPhi(low + blend, end, table.phiCount);
  const delay = residualA + (residualB - residualA) * blend + radialDelay;
  return Number.isFinite(phi) && Number.isFinite(delay) && delay >= 0
    ? { delay, phi }
    : null;
}

function finiteMapDerivatives(
  data: Float32Array,
  angles: Float64Array,
  firstValidRow: number,
  rows: number
) {
  for (let row = firstValidRow; row < rows; row += 1) {
    if ((data[row * 4] ?? -1) < 0) {
      continue;
    }
    const previous = Math.max(firstValidRow, row - 1);
    const next = Math.min(rows - 1, row + 1);
    const angleSpan = (angles[next] ?? 0) - (angles[previous] ?? 0);
    data[row * 4 + 2] =
      angleSpan > 0
        ? ((data[next * 4] ?? 0) - (data[previous * 4] ?? 0)) / angleSpan
        : 0;
  }
}

/**
 * Past-lightcone map to a stationary emitting sphere outside this observer.
 * The first crossing of R on the outer segment shares the existing ray and PG
 * residual-clock tables; each winding therefore samples its actual source event.
 * Source angles are measured about the black-hole centre, not the camera.
 */
export function createFiniteSkyMap(
  table: InfallTable,
  sourceRadius: number
): FiniteSkyMap {
  if (
    !Number.isFinite(sourceRadius) ||
    sourceRadius <= Math.max(1, table.distance)
  ) {
    throw new RangeError(
      "The emitting sphere must be outside the observer and horizon."
    );
  }
  const data = new Float32Array(table.rows * 4);
  const angles = new Float64Array(table.rows);
  const inverse = 1 / sourceRadius;
  const radialDelay = radialClock(sourceRadius) - radialClock(table.distance);
  let firstValidRow = table.rows;
  for (let row = 0; row < table.rows; row += 1) {
    const at = row * 4;
    data[at] = -1;
    angles[row] = rowAngle(row, table);
    const crossing = finiteSphereCrossing(table, row, inverse, radialDelay);
    if (!crossing) {
      continue;
    }
    data[at] = crossing.phi;
    data[at + 1] = crossing.delay;
    firstValidRow = Math.min(firstValidRow, row);
  }
  finiteMapDerivatives(data, angles, firstValidRow, table.rows);
  return { data, firstValidRow, sourceRadius };
}
