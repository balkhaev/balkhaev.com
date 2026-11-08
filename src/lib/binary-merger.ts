/**
 * An equal-mass binary black hole: quadrupole inspiral, merger and ringdown.
 * Units: G = c = 1 and total mass M = 1 (each hole has m = 1/2, r_s = 1).
 *
 * Inspiral follows Peters (1964): da/dt = -(64/5) m1 m2 M / a^3, which
 * integrates to a(t) = a0 (1 - t/τ)^(1/4). The orbital phase has the closed
 * form Φ = (8/5) τ a0^(-3/2) (1 - (1 - t/τ)^(5/8)). The quadrupole strain at
 * distance r is h = 4 η M (M ω)^(2/3) / r with gravitational-wave phase 2Φ.
 * When the horizons meet, a single remnant rings down in its fundamental
 * l = m = 2 quasinormal mode (Berti, Cardoso & Will 2006 fits).
 */

export const MASS_1 = 0.5;
export const MASS_2 = 0.5;
export const TOTAL_MASS = MASS_1 + MASS_2;
const ETA = (MASS_1 * MASS_2) / TOTAL_MASS ** 2;
/** Initial separation: about four orbits of visible inspiral. */
export const START_SEPARATION = 9;
/** Horizons (r_s = 2m) touch: a common horizon forms. */
export const MERGE_SEPARATION = 2 * (MASS_1 + MASS_2) * 1.05;
/** Peters coalescence time from the start separation. */
export const INSPIRAL_TIME =
  ((5 / 256) * START_SEPARATION ** 4) / (MASS_1 * MASS_2 * TOTAL_MASS);
const TAU = INSPIRAL_TIME;
/** Time at which the horizons touch. */
export const MERGE_TIME =
  TAU * (1 - (MERGE_SEPARATION / START_SEPARATION) ** 4);
/** The two horizons fall together into one within a few M after touching. */
export const PLUNGE_TIME = 4;
/** Ringdown frequency is reached smoothly from the last orbital chirp. */
const BLEND_TIME = 2;

/** Remnant of a non-spinning equal-mass merger (numerical relativity). */
export const REMNANT_MASS = 0.952 * TOTAL_MASS;
export const REMNANT_SPIN = 0.686;
/** Fundamental l = m = 2 quasinormal mode of the remnant (Berti et al. fit). */
const QNM_FREQUENCY =
  (1.5251 - 1.1568 * (1 - REMNANT_SPIN) ** 0.1292) / REMNANT_MASS;
const QNM_QUALITY = 0.7 + 1.4187 * (1 - REMNANT_SPIN) ** -0.499;
export const RINGDOWN_ANGULAR_FREQUENCY = QNM_FREQUENCY;
export const RINGDOWN_DAMPING_TIME = (2 * QNM_QUALITY) / QNM_FREQUENCY;
/** Total length of the sequence shown, in M: the last burst travels outward. */
export const SEQUENCE_END = MERGE_TIME + 6 * RINGDOWN_DAMPING_TIME;

export function separationAt(t: number) {
  const clamped = Math.min(Math.max(t, 0), MERGE_TIME);
  return START_SEPARATION * (1 - clamped / TAU) ** 0.25;
}

/** Orbital phase of the binary; frozen at the merger (the remnant has no two bodies). */
export function orbitalPhaseAt(t: number) {
  const clamped = Math.min(Math.max(t, 0), MERGE_TIME);
  return (
    (8 / 5) *
    TAU *
    START_SEPARATION ** -1.5 *
    (1 - (1 - clamped / TAU) ** (5 / 8))
  );
}

export function orbitalFrequencyAt(t: number) {
  return Math.sqrt(TOTAL_MASS / separationAt(t) ** 3);
}

const MERGE_OMEGA = Math.sqrt(TOTAL_MASS / MERGE_SEPARATION ** 3);
const MERGE_AMPLITUDE =
  4 * ETA * TOTAL_MASS * (TOTAL_MASS * MERGE_OMEGA) ** (2 / 3);
/** Peak strain, reached just after the horizons meet. */
export const PEAK_AMPLITUDE = MERGE_AMPLITUDE * 1.4;

/** Strain amplitude × distance (r h) and gravitational-wave phase at source time t. */
export function waveAt(t: number) {
  if (t <= MERGE_TIME) {
    const omega = orbitalFrequencyAt(t);
    return {
      amplitude: 4 * ETA * TOTAL_MASS * (TOTAL_MASS * omega) ** (2 / 3),
      angularFrequency: 2 * omega,
      phase: 2 * orbitalPhaseAt(t),
    };
  }
  const after = t - MERGE_TIME;
  const blend = Math.exp(-after / BLEND_TIME);
  const chirp = 2 * MERGE_OMEGA - QNM_FREQUENCY;
  return {
    amplitude:
      MERGE_AMPLITUDE *
      (1 + 0.6 * (1 - Math.exp(-after))) *
      Math.exp(-after / RINGDOWN_DAMPING_TIME),
    angularFrequency: QNM_FREQUENCY + chirp * blend,
    phase:
      2 * orbitalPhaseAt(MERGE_TIME) +
      QNM_FREQUENCY * after +
      chirp * BLEND_TIME * (1 - blend),
  };
}

export type MergerStage = "inspiral" | "plunge" | "ringdown" | "settled";

export function mergerStageAt(t: number): MergerStage {
  if (t > MERGE_TIME + 5 * RINGDOWN_DAMPING_TIME) {
    return "settled";
  }
  if (t > MERGE_TIME + PLUNGE_TIME) {
    return "ringdown";
  }
  return separationAt(t) < 3.2 ? "plunge" : "inspiral";
}

export const MERGER_STAGES: Record<
  MergerStage,
  { description: string; title: string }
> = {
  inspiral: {
    description:
      "Две дыры по половине массы. Излучая волны, пара теряет энергию и сближается.",
    title: "Сближение",
  },
  plunge: {
    description:
      "Орбита больше не держит: дыры падают друг на друга, частота волн растёт.",
    title: "Слияние",
  },
  ringdown: {
    description:
      "Общий горизонт звенит и успокаивается. Около 5% массы ушло в волны.",
    title: "Затухание",
  },
  settled: {
    description:
      "Одна вращающаяся дыра, 95% исходной массы. Волны уходят со скоростью света.",
    title: "Остаток",
  },
};

/** Mass-energy still in the holes (M minus what has left as waves). */
export function massAt(t: number) {
  return TOTAL_MASS - radiatedAt(t);
}

/**
 * Positions of the two holes in the orbital (x, z) plane. After the horizons
 * touch, the two centres fall together within PLUNGE_TIME into one remnant.
 */
export function holesAt(t: number) {
  let a = separationAt(t);
  let phase = orbitalPhaseAt(t);
  if (t > MERGE_TIME) {
    const after = Math.min(t - MERGE_TIME, PLUNGE_TIME);
    const left = 1 - after / PLUNGE_TIME;
    a = MERGE_SEPARATION * left * left;
    phase += MERGE_OMEGA * (after + (after * after) / PLUNGE_TIME);
  }
  const r1 = (a * MASS_2) / TOTAL_MASS;
  const r2 = (a * MASS_1) / TOTAL_MASS;
  return {
    merged: t >= MERGE_TIME + PLUNGE_TIME,
    positions: [
      [r1 * Math.cos(phase), 0, r1 * Math.sin(phase)],
      [-r2 * Math.cos(phase), 0, -r2 * Math.sin(phase)],
    ] as [number, number, number][],
  };
}

/** Radiated energy so far, as a fraction of M (binding energy until merger). */
export function radiatedAt(t: number): number {
  if (t <= MERGE_TIME) {
    const a = separationAt(t);
    return (
      (MASS_1 * MASS_2) / (2 * a) - (MASS_1 * MASS_2) / (2 * START_SEPARATION)
    );
  }
  const atMerge = radiatedAt(MERGE_TIME);
  const total = TOTAL_MASS - REMNANT_MASS;
  const after = 1 - Math.exp(-(t - MERGE_TIME) / (0.5 * RINGDOWN_DAMPING_TIME));
  return atMerge + (total - atMerge) * after;
}

/** The same model as GLSL, so the renderer and the panel agree exactly. */
export const MERGER_SHADER = `
const float M1 = ${MASS_1.toFixed(4)};
const float M2 = ${MASS_2.toFixed(4)};
const float MTOT = ${TOTAL_MASS.toFixed(4)};
const float A0 = ${START_SEPARATION.toFixed(4)};
const float TAU_INSPIRAL = ${TAU.toFixed(6)};
const float T_MERGE = ${MERGE_TIME.toFixed(6)};
const float ETA = ${ETA.toFixed(6)};
const float QNM_W = ${QNM_FREQUENCY.toFixed(6)};
const float QNM_T = ${RINGDOWN_DAMPING_TIME.toFixed(6)};
const float MERGE_AMP = ${MERGE_AMPLITUDE.toFixed(6)};
float orbitPhase(float t) {
  float c = clamp(t, 0.0, T_MERGE);
  return 1.6 * TAU_INSPIRAL * pow(A0, -1.5) * (1.0 - pow(1.0 - c / TAU_INSPIRAL, 0.625));
}
float orbitSeparation(float t) {
  return A0 * pow(1.0 - clamp(t, 0.0, T_MERGE) / TAU_INSPIRAL, 0.25);
}
const float MERGE_W = ${MERGE_OMEGA.toFixed(6)};
const float BLEND_T = ${BLEND_TIME.toFixed(4)};
// The inspiral formulas also hold before the sequence starts (wider, slower
// orbits), so waves emitted earlier already fill the space far away.
float earlyPhase(float t) {
  return 1.6 * TAU_INSPIRAL * pow(A0, -1.5) * (1.0 - pow(1.0 - min(t, T_MERGE) / TAU_INSPIRAL, 0.625));
}
// (r h, gravitational-wave phase) of the outgoing quadrupole wave emitted at source time t.
vec2 wave(float t) {
  if (t <= T_MERGE) {
    float a = A0 * pow(1.0 - t / TAU_INSPIRAL, 0.25);
    float w = sqrt(MTOT / (a * a * a));
    return vec2(4.0 * ETA * MTOT * pow(MTOT * w, 0.6666667), 2.0 * earlyPhase(t));
  }
  float after = t - T_MERGE;
  float blend = exp(-after / BLEND_T);
  float chirp = 2.0 * MERGE_W - QNM_W;
  return vec2(
    MERGE_AMP * (1.0 + 0.6 * (1.0 - exp(-after))) * exp(-after / QNM_T),
    2.0 * orbitPhase(T_MERGE) + QNM_W * after + chirp * BLEND_T * (1.0 - blend)
  );
}
`;
