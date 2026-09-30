export interface GravitySource {
  radius: number;
  x: number;
  y: number;
}

const smoothstep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

/** Static inverse lens map. Light bends radially; empty space has no animation of its own. */
export function lensingField(x: number, y: number, source: GravitySource) {
  const vx = x - source.x;
  const vy = y - source.y;
  const distance = Math.hypot(vx, vy);
  if (distance < 1) {
    return { x: 0, y: 0 };
  }
  const radius = Math.max(1, source.radius);
  const r = distance / radius;
  const taper = 1 - smoothstep(3.5, 5.5, r);
  const radial =
    Math.min(150, (radius * 1.12) / Math.max(0.65, r)) *
    smoothstep(0, 0.7, r) *
    taper;
  return {
    x: (-vx * radial) / distance,
    y: (-vy * radial) / distance,
  };
}
