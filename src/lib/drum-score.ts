export const DRUM_STRIKES = [12, 28, 43, 76.5] as const;
export const DRUM_CENTER = [0.6, 0.72, -0.12] as const;
export const DRUM_RADIUS = 0.64;
export const APPROACH_DISTANCE = 2.35;
type Vec3 = [number, number, number];

export const ease = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 =>
  a.map((v, i) => v + ((b[i] ?? 0) - v) * t) as Vec3;
const length = (v: Vec3) => Math.hypot(...v);
const normalized = (v: Vec3): Vec3 => v.map((n) => n / length(v)) as Vec3;
const plus = (a: Vec3, b: Vec3, scale = 1): Vec3 =>
  a.map((v, i) => v + (b[i] ?? 0) * scale) as Vec3;
const dot = (a: Vec3, b: Vec3) =>
  a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

/** Four deliberate contacts; a quiet recovery separates the third from the final wind-up. */
export function scoreAt(time: number) {
  let index = -1;
  let impulse = 0;
  for (const [i, strike] of DRUM_STRIKES.entries()) {
    const age = time - strike;
    if (age >= 0) {
      index = i;
      impulse += Math.exp(-age * 1.8) * (i === 3 ? 2 : 1);
    }
  }
  return {
    impulse,
    index,
    release: ease(DRUM_STRIKES[3], DRUM_STRIKES[3] + 5, time),
  };
}

/** A two-bone arm with a stable 3D pole. Its lengths never change during the stroke. */
export function solveArm(
  shoulder: Vec3,
  hand: Vec3,
  upper = 0.68,
  lower = 0.66
) {
  const direction = plus(hand, shoulder, -1);
  const distance = Math.max(
    0.001,
    Math.min(upper + lower - 0.001, length(direction))
  );
  const axis = normalized(direction);
  const pole: Vec3 = [-1, -0.45, -0.65];
  const perpendicular = normalized(plus(pole, axis, -dot(pole, axis)));
  const along =
    (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const side = Math.sqrt(Math.max(0, upper * upper - along * along));
  return plus(plus(shoulder, axis, along), perpendicular, side);
}

export function drummerPose(time: number) {
  const rest: Vec3 = [-0.48, 0.37, -0.26];
  const strikeAngle = -0.1;
  const contact: Vec3 = [
    DRUM_CENTER[0] - Math.cos(strikeAngle) * 0.62,
    DRUM_CENTER[1] - Math.sin(strikeAngle) * 0.62,
    DRUM_CENTER[2] - 0.025,
  ];
  let hand = rest;
  let angle = 1.42;
  let effort = 0;
  let recoil = 0;
  for (const [index, strike] of DRUM_STRIKES.entries()) {
    const age = time - strike;
    if (age < -9 || age > 6) {
      continue;
    }
    const final = index === 3;
    const lifted: Vec3 = final ? [-0.76, 1.56, -0.4] : [-0.82, 1.36, -0.32];
    const peakAngle = final ? 1.84 : 1.7;
    const peakEffort = final ? 1.25 : 1;
    if (age < -2.5) {
      const t = ease(-9, -2.5, age);
      hand = interpolate(rest, lifted, t);
      angle = 1.42 + t * (peakAngle - 1.42);
      effort = t * peakEffort;
    } else if (age < 0) {
      const t = Math.max(0, (age + 2.5) / 2.5) ** 2.2;
      hand = interpolate(lifted, contact, t);
      hand[1] += Math.sin(t * Math.PI) * 0.09;
      angle = peakAngle + (strikeAngle - peakAngle) * t;
      effort = peakEffort + t * (0.7 - peakEffort);
    } else {
      effort = 0.7 * (1 - ease(0, 2.5, age));
      const bounce =
        Math.sin((Math.min(age, 1.2) / 1.2) * Math.PI) * Math.exp(-age * 0.7);
      const t = ease(0.7, 6, age);
      hand = interpolate(contact, rest, t);
      hand[1] += bounce * 0.16;
      hand[2] -= bounce * 0.1;
      angle = strikeAngle + (1.42 - strikeAngle) * t + bounce * 0.45;
      recoil = Math.exp(-age * 2.3) * Math.sin(age * 4);
    }
  }
  const lean = -0.025 * effort + recoil * 0.018;
  const breathe = 1 + Math.sin(time * 0.21) * 0.006;
  const nod = Math.sin(time * 0.16) * 0.018 - effort * 0.025 + recoil * 0.025;
  const transform = (p: Vec3): Vec3 => {
    const y = (p[1] + 0.35) * breathe;
    return [
      p[0] * Math.cos(lean) - y * Math.sin(lean),
      p[0] * Math.sin(lean) + y * Math.cos(lean) - 0.35,
      p[2],
    ];
  };
  const shoulder = transform([-0.63, 0.97, -0.08]);
  const grip = hand;
  const elbow = solveArm(shoulder, grip);
  const head = plus(
    grip,
    [Math.cos(angle), Math.sin(angle), 0.025 / 0.62],
    0.62
  );
  return {
    body: new Float32Array([lean, breathe, nod, time]),
    bones: new Float32Array([...shoulder, ...elbow, ...grip, ...head]),
    elbow,
    grip,
    head,
    shoulder,
  };
}

export function observedScore(clock: number, camera: ArrayLike<number>) {
  return (
    clock -
    Math.hypot(
      (camera[0] ?? 0) - DRUM_CENTER[0],
      (camera[1] ?? 0) - DRUM_CENTER[1],
      (camera[2] ?? 0) - DRUM_CENTER[2]
    )
  );
}

export const SCORE_SHADER = `
const vec3 DRUM = vec3(${DRUM_CENTER.map((v) => v.toFixed(3)).join(", ")});
const float DRUM_RADIUS = ${DRUM_RADIUS.toFixed(3)};
const float STRIKES[4] = float[4](${DRUM_STRIKES.map((v) => v.toFixed(3)).join(", ")});
float scorePulse(float time) {
  float pulse = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = time - STRIKES[i];
    if (age >= 0.0) pulse += exp(-age * 1.8) * (i == 3 ? 2.0 : 1.0);
  }
  return pulse;
}
float pressureAt(float radius, float time) {
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = time - STRIKES[i];
    if (age < 0.0) continue;
    float separation = radius - age * 0.65;
    wave += exp(-separation * separation / 0.08) * exp(-age * 0.035) * (i == 3 ? 2.0 : 1.0);
  }
  return wave;
}
`;
