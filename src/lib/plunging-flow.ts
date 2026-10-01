/** Test-body plunge from the ISCO, in r_s = c = 1 and ingoing PG time.
 * A small inward kick makes the boundary travel time finite; E and L then stay constant. */
export const PLUNGE_IN = 0.02;
export const PLUNGE_OUT = 3;
export const PLUNGE_SAMPLES = 2048;
export const PLUNGE_KICK = 0.045;
export const PLUNGE_L = Math.sqrt(3);
export const PLUNGE_E = Math.sqrt(8 / 9 + PLUNGE_KICK ** 2);
const LOG_RANGE = Math.log(PLUNGE_OUT / PLUNGE_IN);

export interface PlungingFlow {
  clock: number;
  data: Float32Array;
  proper: number;
}

export function plungeVelocity(radius: number, spin = -1) {
  const u = 1 / radius;
  const transverse = 1 + PLUNGE_L ** 2 * u * u;
  const speed = Math.sqrt(Math.max(0, PLUNGE_E ** 2 - (1 - u) * transverse));
  return {
    angular: (-spin * PLUNGE_L) / radius ** 2,
    radial: -speed,
    // Rationalized (E - sqrt(1/r) speed)/(1 - 1/r), regular at the horizon.
    time: (PLUNGE_E ** 2 + u * transverse) / (PLUNGE_E + Math.sqrt(u) * speed),
  };
}

/** Photon covector contracted with the emitting fluid's four-velocity. No static frame at r <= 1. */
export function plungeShift(
  radius: number,
  angular: number,
  energy: number,
  slope: number,
  lambda: number,
  spin = -1
) {
  const u = 1 / radius;
  const radial = angular * slope;
  const time =
    (energy ** 2 + angular ** 2 * u ** 3) / (energy - Math.sqrt(u) * radial);
  const covector = radial + Math.sqrt(u) * time;
  const velocity = plungeVelocity(radius, spin);
  return (
    1 /
    (energy * velocity.time -
      covector * velocity.radial +
      lambda * velocity.angular)
  );
}

/** Radius-parametrized age, winding and proper age of a fluid element released at r = 3. */
export function createPlungingFlow() {
  const ages = new Float64Array(PLUNGE_SAMPLES * 4);
  let time = 0;
  let angle = 0;
  let proper = 0;
  let outer = PLUNGE_OUT;
  ages[3] = PLUNGE_KICK;
  for (let i = 1; i < PLUNGE_SAMPLES; i += 1) {
    const inner =
      PLUNGE_OUT * Math.exp((-i * LOG_RANGE) / (PLUNGE_SAMPLES - 1));
    // Composite Simpson integration avoids the steep but finite ISCO boundary layer.
    const steps = 8;
    const step = (outer - inner) / steps;
    for (let j = 0; j <= steps; j += 1) {
      const r = inner + j * step;
      const v = plungeVelocity(r);
      const interiorWeight = j % 2 === 0 ? 2 : 4;
      const weight = j === 0 || j === steps ? 1 : interiorWeight;
      const measure = (weight * step) / (-3 * v.radial);
      time += v.time * measure;
      angle += Math.abs(v.angular) * measure;
      proper += measure;
    }
    ages.set([time, angle, proper, -plungeVelocity(inner).radial], i * 4);
    outer = inner;
  }
  // Store ages relative to a shared, exactly representable clock. This retains the tiny
  // interior travel-time differences which would disappear next to the full accumulated age.
  const clock = Math.fround(time);
  const properClock = Math.fround(proper);
  const data = Float32Array.from(ages);
  for (let i = 0; i < PLUNGE_SAMPLES; i += 1) {
    data[i * 4] = clock - (ages[i * 4] ?? 0);
    data[i * 4 + 2] = properClock - (ages[i * 4 + 2] ?? 0);
  }
  return { clock, data, proper: properClock };
}

export function samplePlungingFlow(table: PlungingFlow, radius: number) {
  const at = Math.max(
    0,
    Math.min(
      PLUNGE_SAMPLES - 1,
      (Math.log(PLUNGE_OUT / radius) / LOG_RANGE) * (PLUNGE_SAMPLES - 1)
    )
  );
  const low = Math.floor(at);
  return [0, 1, 2, 3].map((axis) => {
    const a = table.data[low * 4 + axis] ?? 0;
    const b = table.data[Math.min(low + 1, PLUNGE_SAMPLES - 1) * 4 + axis] ?? a;
    const value = a + (b - a) * (at - low);
    if (axis === 0) {
      return table.clock - value;
    }
    if (axis === 2) {
      return table.proper - value;
    }
    return value;
  });
}

export const PLUNGE_SHADER = `
uniform sampler2D uPlunge;
uniform vec2 uPlungeClock;
const float PLUNGE_E = ${PLUNGE_E.toPrecision(15)};
const float PLUNGE_L = ${PLUNGE_L.toPrecision(15)};
const float PLUNGE_MIN = ${PLUNGE_IN.toFixed(2)};

vec4 plungeState(float r) {
  float at = clamp(log(3.0 / r) / ${LOG_RANGE.toPrecision(15)}, 0.0, 1.0) * ${PLUNGE_SAMPLES - 1}.0;
  int low = int(floor(at));
  return mix(texelFetch(uPlunge, ivec2(low, 0), 0),
    texelFetch(uPlunge, ivec2(min(low + 1, ${PLUNGE_SAMPLES - 1}), 0), 0), fract(at));
}

vec4 inflowMaterial(float phase, float birthTime) {
  vec2 material = vec2(cos(phase), sin(phase));
  float clouds = filteredDensity(material * 3.4 + vec2(birthTime * 0.028, 7.0));
  float filaments = filteredDensity(material * 47.0 + vec2(birthTime * 0.7, clouds * 2.0));
  float fine = filteredDensity(material * 180.0 + vec2(birthTime * 3.4, 0.0));
  // Irregular injection patches shear naturally into streams, with no evenly spaced spiral arms.
  vec2 gradient = vec2(dFdx(filaments), dFdy(filaments));
  float variance = dot(gradient, gradient) / 12.0;
  float width = 0.0016 + 2.0 * variance;
  float stream = sqrt(0.0016 / width) * exp(-pow(filaments - 0.55, 2.0) / width);
  stream *= 0.2 + 0.8 * clouds * clouds;
  return vec4(clouds, filaments, fine, stream);
}

vec4 plungingDisk(float r, float psi, float lambda, float angular, float energy, float slope, float delay) {
  float u = 1.0 / r;
  float transverse = 1.0 + PLUNGE_L * PLUNGE_L * u * u;
  float speed = sqrt(max(0.0, PLUNGE_E * PLUNGE_E - (1.0 - u) * transverse));
  float fluidTime = (PLUNGE_E * PLUNGE_E + u * transverse) / (PLUNGE_E + sqrt(u) * speed);
  float photonRadial = angular * slope;
  float photonTime = (energy * energy + angular * angular * u * u * u) / max(1e-10, energy - sqrt(u) * photonRadial);
  float photonCovector = photonRadial + sqrt(u) * photonTime;
  vec2 velocity = vec2(-speed / fluidTime + sqrt(u), -uSpin * PLUNGE_L * u / fluidTime);
  vec2 photon = vec2(photonCovector, -lambda * u) / photonTime;
  float beta = sqrt(max(0.0, 1.0 - 1.0 / (fluidTime * fluidTime)));
  // Stable Lorentz contraction, retaining 1-beta even for an almost comoving photon.
  float frequency = photonTime * fluidTime * (1.0 / (fluidTime * fluidTime * (1.0 + beta)) + max(0.0, beta - dot(velocity, photon)));
  float shift = 1.0 / frequency;
  vec4 state = plungeState(r);
  float emissionTime = uTime - delay + EPOCH;
  float birthTime = (emissionTime - uPlungeClock.x) + state.x;
  float omegaISCO = sqrt(0.5 / 27.0);
  // These two labels stay fixed on the same timelike material worldline.
  float birthAngle = psi + uSpin * state.y;
  float phase = birthAngle + uSpin * omegaISCO * birthTime;
  vec4 structure = inflowMaterial(phase, birthTime);
  // Constant stationary mass flux: r Sigma |U^r| is conserved.
  float column = 3.0 * ${PLUNGE_KICK.toFixed(3)} / (r * speed);
  float density = (0.015 + 0.1 * structure.x + 0.45 * structure.y * structure.y + 2.2 * structure.w) * column;
  float alpha = 1.0 - exp(-density * 0.9);
  // Prescribed thermal emission with a restrained compression contribution; no luminous horizon.
  float temperature = 2050.0 * pow(max(column, 0.0001), 0.12) * pow(3.0 / r, 0.08);
  temperature *= 0.6 + 0.55 * structure.x + 0.1 * structure.z + structure.w * 0.2;
  return vec4(blackbody(temperature * shift) * uAccretion, alpha);
}
`;
