/**
 * How light bends round a black hole that does not spin (Schwarzschild), in units of its horizon's radius (r_s = 1).
 *
 * A photon moves in the plane that holds it and the hole; in that plane its inverse distance u = 1/r, as a function
 * of the angle φ it has swept, obeys u'' = −u + 3/2·u². Every ray that leaves an observer standing still at distance
 * D is fixed by one number, its impact parameter b: the ray falls in when b is under the photon sphere's b_c = 3√3/2,
 * and escapes after bending round the hole when it is over it. So one table u(b, φ) holds every ray of every picture
 * taken from that distance, whichever way the camera looks: the shader reads it where a ray's plane crosses the disk
 * and where the ray ends. Ray tracing by table, as in E. Bruneton, «Real-time high-quality rendering of non-rotating
 * black holes» (2020).
 */

/** The photon sphere's impact parameter: rays under it fall in, rays over it get away. */
export const CRITICAL_B = (3 * Math.sqrt(3)) / 2;

export interface GeodesicTable {
  /** Rows under the photon sphere's b; the rest are over it. */
  below: number;
  /** The largest impact parameter in the table. */
  bMax: number;
  /** The observer's distance, r_s. */
  distance: number;
  /**
   * Where each ray ends, per row: the angle it escapes at (positive), or minus the angle it falls through the horizon
   * at (negative).
   */
  ends: Float32Array;
  /** Angles per row. */
  phiCount: number;
  /** The last angle, radians: three half-turns and a little, enough for the disk's third image. */
  phiMax: number;
  /** Rows: impact parameters, dense near the photon sphere. */
  rows: number;
  /** Coordinate light-travel time from the observer, in r_s/c. */
  times: Float32Array;
  /** u(b, φ), row by row; 0 once a ray has escaped, 1 once it has fallen in. */
  u: Float32Array;
}

const STEPS_PER_SAMPLE = 3;

/** The impact parameter of a row: squeezed towards b_c from both sides, where rays wind round the photon sphere. */
export function rowImpact(
  row: number,
  rows: number,
  below: number,
  bMax: number
): number {
  if (row < below) {
    const s = (below - row) / below;
    return CRITICAL_B * (1 - s * s);
  }
  const s = (row - below) / (rows - 1 - below);
  return CRITICAL_B + (bMax - CRITICAL_B) * s * s * s;
}

/** One ray from the observer at `distance` with impact parameter `b`, falling inwards, sampled every `step` radians. */
function trace(
  b: number,
  distance: number,
  count: number,
  step: number,
  out: Float32Array,
  offset: number,
  times: Float32Array
): number {
  const u0 = 1 / distance;
  let u = u0;
  let v = Math.sqrt(Math.max(0, 1 / (b * b) - u0 * u0 + u0 * u0 * u0));
  const h = step / STEPS_PER_SAMPLE;
  let time = 0;
  out[offset] = u;
  const accel = (x: number) => -x + 1.5 * x * x;
  for (let sample = 1; sample < count; sample += 1) {
    for (let sub = 0; sub < STEPS_PER_SAMPLE; sub += 1) {
      const k1u = v;
      const k1v = accel(u);
      const k2u = v + 0.5 * h * k1v;
      const k2v = accel(u + 0.5 * h * k1u);
      const k3u = v + 0.5 * h * k2v;
      const k3v = accel(u + 0.5 * h * k2u);
      const k4u = v + h * k3v;
      const k4v = accel(u + h * k3u);
      const clock = (inverse: number) =>
        1 /
        (Math.max(b, 1e-6) *
          Math.max(inverse, 1e-8) ** 2 *
          Math.max(1 - inverse, 1e-5));
      time +=
        (h / 6) *
        (clock(u) +
          2 * clock(u + 0.5 * h * k1u) +
          2 * clock(u + 0.5 * h * k2u) +
          clock(u + h * k3u));
      const next = u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      const phi = (sample - 1) * step + (sub + 1) * h;
      if (next >= 1) {
        out.fill(1, offset + sample, offset + count);
        times.fill(time, offset + sample, offset + count);
        return -(phi - (h * (next - 1)) / (next - u));
      }
      if (next <= 0) {
        out.fill(0, offset + sample, offset + count);
        times.fill(time, offset + sample, offset + count);
        return phi - (h * -next) / (u - next);
      }
      u = next;
    }
    out[offset + sample] = u;
    times[offset + sample] = time;
  }
  // Still winding at the end: close enough to the photon sphere to count as falling in.
  return -count * step;
}

/** Traces every row; about a million small steps, some tens of milliseconds. */
export function geodesicTable({
  bMax = 30,
  below = 256,
  distance,
  phiCount = 512,
  rows = 1024,
}: {
  bMax?: number;
  below?: number;
  distance: number;
  phiCount?: number;
  rows?: number;
}): GeodesicTable {
  const phiMax = 3.3 * Math.PI;
  const step = phiMax / (phiCount - 1);
  const u = new Float32Array(rows * phiCount);
  const times = new Float32Array(rows * phiCount);
  const ends = new Float32Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const b = Math.max(rowImpact(row, rows, below, bMax), 1e-4);
    ends[row] = trace(b, distance, phiCount, step, u, row * phiCount, times);
  }
  return { below, bMax, distance, ends, phiCount, phiMax, rows, times, u };
}
