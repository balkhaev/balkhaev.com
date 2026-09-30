/** Bound Schwarzschild geodesic in Darwin's relativistic anomaly, in r_s = c = 1.
 * The photosphere is a compact test star; its centre follows the exact timelike orbit.
 * Tabulation uses horizon-regular ingoing PG time so the GPU can sample retarded emission. */
export const STAR_RADIUS = 0.34;
export const STAR_PERIAPSIS = 12;
export const STAR_APOAPSIS = 32;
// Includes both periapsis endpoints and fits WebGL 2's 2048-texel minimum.
export const STAR_SAMPLES = 2047;
const TAU = 2 * Math.PI;
const ECCENTRICITY =
  (STAR_APOAPSIS - STAR_PERIAPSIS) / (STAR_APOAPSIS + STAR_PERIAPSIS);
const P =
  (4 * STAR_APOAPSIS * STAR_PERIAPSIS) / (STAR_APOAPSIS + STAR_PERIAPSIS);

function anomalyState(chi: number) {
  const cosine = Math.cos(chi);
  const shape = 1 + ECCENTRICITY * cosine;
  const root = Math.sqrt(P - 6 - 2 * ECCENTRICITY * cosine);
  const schwarzschildTime =
    (0.5 * P ** 2 * Math.sqrt((P - 2) ** 2 - 4 * ECCENTRICITY ** 2)) /
    ((P - 2 - 2 * ECCENTRICITY * cosine) * shape ** 2 * root);
  const dphi = Math.sqrt(P) / root;
  const radius = (0.5 * P) / shape;
  const dr = (0.5 * P * ECCENTRICITY * Math.sin(chi)) / shape ** 2;
  const dt = schwarzschildTime + dr / (Math.sqrt(radius) * (1 - 1 / radius));
  return {
    angular: dphi / dt,
    dphi,
    dt,
    radial: dr / dt,
    radius,
  };
}

export function createStellarOrbit() {
  const steps = 8192;
  const h = TAU / steps;
  const times = new Float64Array(steps + 1);
  const angles = new Float64Array(steps + 1);
  for (let i = 1; i <= steps; i += 1) {
    const a = anomalyState((i - 1) * h);
    const m = anomalyState((i - 0.5) * h);
    const b = anomalyState(i * h);
    times[i] = (times[i - 1] ?? 0) + (h * (a.dt + 4 * m.dt + b.dt)) / 6;
    angles[i] = (angles[i - 1] ?? 0) + (h * (a.dphi + 4 * m.dphi + b.dphi)) / 6;
  }
  const period = times[steps] ?? 1;
  const advance = angles[steps] ?? TAU;
  const initial = 5.05 / h;
  const low = Math.floor(initial);
  const offset =
    (times[low] ?? 0) +
    ((times[low + 1] ?? 0) - (times[low] ?? 0)) * (initial - low);
  const data = new Float32Array(STAR_SAMPLES * 4);
  let next = 1;
  for (let i = 0; i < STAR_SAMPLES; i += 1) {
    const t = (i * period) / (STAR_SAMPLES - 1);
    while (next < steps && (times[next] ?? 0) < t) {
      next += 1;
    }
    const fraction =
      (t - (times[next - 1] ?? 0)) /
      ((times[next] ?? 1) - (times[next - 1] ?? 0));
    const state = anomalyState((next - 1 + fraction) * h);
    data.set(
      [
        state.radius,
        (angles[next - 1] ?? 0) +
          ((angles[next] ?? 0) - (angles[next - 1] ?? 0)) * fraction,
        state.radial,
        state.angular,
      ],
      i * 4
    );
  }
  const orientation = Math.PI / 2 + advance;
  return { advance, data, offset, orientation, period };
}

export type StellarOrbit = ReturnType<typeof createStellarOrbit>;

export function stellarState(orbit: StellarOrbit, time: number) {
  const cycles = Math.floor((time + orbit.offset) / orbit.period);
  const fraction = (time + orbit.offset) / orbit.period - cycles;
  const at = fraction * (STAR_SAMPLES - 1);
  const low = Math.floor(at);
  const sample = (channel: number) => {
    const a = orbit.data[low * 4 + channel] ?? 0;
    const b = orbit.data[(low + 1) * 4 + channel] ?? a;
    return a + (b - a) * (at - low);
  };
  const radius = sample(0);
  const angle = orbit.orientation - sample(1) - cycles * orbit.advance;
  const radial = sample(2);
  const angular = -sample(3);
  return {
    angle,
    angular,
    radial,
    radius,
    vx: radial * Math.cos(angle) - radius * angular * Math.sin(angle),
    vz: radial * Math.sin(angle) + radius * angular * Math.cos(angle),
    x: radius * Math.cos(angle),
    z: radius * Math.sin(angle),
  };
}
