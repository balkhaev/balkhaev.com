export interface GravitySource {
  radius: number;
  x: number;
  y: number;
}

/** Inverse sampling offsets: a moving logarithmic field carries light inward, with stronger shear near the hole. */
export function infallField(
  x: number,
  y: number,
  source: GravitySource,
  time: number
) {
  const vx = x - source.x;
  const vy = y - source.y;
  const distance = Math.hypot(vx, vy);
  if (distance < 1) {
    return { x: 0, y: 0 };
  }
  const radius = Math.max(1, source.radius);
  const proximity = 1 / (1 + (distance / (radius * 2.8)) ** 2);
  const phase = Math.log1p(distance / radius) * 9 + time * 1.8;
  const radial = (6 + 24 * proximity) * (0.72 + Math.sin(phase) * 0.28);
  const twist = (2 + 12 * proximity) * Math.sin(phase * 0.7 + 0.8);
  return {
    x: (vx * radial - vy * twist) / distance,
    y: (vy * radial + vx * twist) / distance,
  };
}
