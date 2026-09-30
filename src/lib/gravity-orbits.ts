import type { GravitySource } from "./gravity-infall";

const TAU = Math.PI * 2;
const ECCENTRICITY = 0.22;
const CAPTURE_SECONDS = 7;

/** Kepler's equation: equal areas in equal times, so the close pass is faster. */
export function orbitalState(meanAnomaly: number, eccentricity = ECCENTRICITY) {
  const mean = ((meanAnomaly % TAU) + TAU) % TAU;
  let eccentric = mean;
  for (let i = 0; i < 6; i += 1) {
    eccentric -=
      (eccentric - eccentricity * Math.sin(eccentric) - mean) /
      (1 - eccentricity * Math.cos(eccentric));
  }
  const rate = 1 / (1 - eccentricity * Math.cos(eccentric));
  const minor = Math.sqrt(1 - eccentricity ** 2);
  return {
    depth: Math.sin(eccentric),
    vx: -Math.sin(eccentric) * rate,
    vy: minor * Math.cos(eccentric) * rate,
    x: Math.cos(eccentric) - eccentricity,
    y: minor * Math.sin(eccentric),
  };
}

/** A capture arc joins the orbit with matching tangent velocity, without a reset or fade. */
export function captureOrbit(
  start: { x: number; y: number },
  end: { x: number; y: number },
  velocity: { x: number; y: number },
  elapsed: number
) {
  const t = Math.max(0, Math.min(1, elapsed / CAPTURE_SECONDS));
  const blend = t * t * (3 - 2 * t);
  const tangent = (t * t * t - t * t) * CAPTURE_SECONDS;
  return {
    x: start.x + (end.x - start.x) * blend + velocity.x * tangent,
    y: start.y + (end.y - start.y) * blend + velocity.y * tangent,
  };
}

function orbitGeometry(source: GravitySource, index: number, width: number) {
  const portrait = innerWidth < 600;
  const horizontal = Math.max(28, (innerWidth - width - 44) / 2);
  const vertical = Math.max(
    60,
    Math.min(source.y - 70, innerHeight - source.y - 70)
  );
  const outer = 1 + ECCENTRICITY;
  const major = portrait
    ? Math.min(source.radius * (3.0 + index * 0.45), vertical / outer)
    : Math.min(source.radius * (3.1 + index * 0.55), horizontal / outer);
  const minor = portrait
    ? Math.min(major * 0.38, horizontal / outer)
    : Math.min(major * 0.48, vertical / outer);
  return { major, minor, portrait };
}

interface OrbitTrack {
  elapsed: number;
  index: number;
  phase: number;
  speed: number;
  start: { x: number; y: number };
}

function orbitPose(track: OrbitTrack, source: GravitySource, width: number) {
  const { major, minor, portrait } = orbitGeometry(source, track.index, width);
  const elapsed = Math.max(0, track.elapsed - CAPTURE_SECONDS);
  const orbit = orbitalState(track.phase + elapsed * track.speed);
  const project = (x: number, y: number) =>
    portrait ? { x: -y * minor, y: x * major } : { x: x * major, y: y * minor };
  const offset = project(orbit.x, orbit.y);
  const end = { x: source.x + offset.x, y: source.y + offset.y };
  const velocity = project(orbit.vx * track.speed, orbit.vy * track.speed);
  const desired =
    track.elapsed < CAPTURE_SECONDS
      ? captureOrbit(track.start, end, velocity, track.elapsed)
      : end;
  const captured = Math.min(1, track.elapsed / CAPTURE_SECONDS);
  return {
    ...desired,
    scale: 1 + orbit.depth * 0.08 * captured,
    zIndex: orbit.depth >= 0 || captured < 1 ? "2" : "0",
  };
}

/** Moves the existing anchors, including their hit boxes. No text copies or extra links. */
export function createElementOrbits() {
  const targets = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".contacts a")
  );
  const bodies = targets.map((element, index) => {
    const box = element.getBoundingClientRect();
    const original = {
      transform: element.style.transform,
      zIndex: element.style.zIndex,
    };
    element.dataset.gravityOrbit = "";
    return {
      elapsed: 0,
      element,
      index,
      original,
      phase: innerWidth < 600 ? index * 0.55 : Math.PI / 2 + index * 1.2,
      scale: 1,
      speed: TAU / (26 + index * 9),
      start: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
  });
  let pointer = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  const leave = () => {
    pointer = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("blur", leave);
  return {
    dispose() {
      for (const { element, original } of bodies) {
        element.style.transform = original.transform;
        element.style.zIndex = original.zIndex;
        delete element.dataset.gravityOrbit;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    },
    update(source: GravitySource, seconds: number) {
      // Read all untransformed layout origins before moving any link.
      const layouts = bodies.map(({ element }) => {
        const parent = element.offsetParent?.getBoundingClientRect();
        return {
          height: element.offsetHeight,
          width: element.offsetWidth,
          x: (parent?.left ?? 0) + element.offsetLeft + element.offsetWidth / 2,
          y: (parent?.top ?? 0) + element.offsetTop + element.offsetHeight / 2,
        };
      });
      return bodies.map((body, index) => {
        const layout = layouts[index];
        if (!layout) {
          return new DOMRect();
        }
        const { element } = body;
        const focused = element.contains(document.activeElement);
        const nearby =
          Math.abs(pointer.x - body.x) < layout.width / 2 + 42 &&
          Math.abs(pointer.y - body.y) < layout.height / 2 + 42;
        if (!(nearby || focused)) {
          body.elapsed += seconds;
          const desired = orbitPose(body, source, layout.width);
          // Ease viewport changes and a dragged gravity source without teleporting the links.
          const ease = 1 - Math.exp(-seconds * 9);
          body.x += (desired.x - body.x) * ease;
          body.y += (desired.y - body.y) * ease;
          body.scale = desired.scale;
          element.style.zIndex = desired.zIndex;
        }
        if (focused || nearby) {
          element.style.zIndex = "3";
        }
        const edgeX = (layout.width * body.scale) / 2 + 24;
        const edgeY = (layout.height * body.scale) / 2 + 24;
        body.x = Math.max(edgeX, Math.min(innerWidth - edgeX, body.x));
        body.y = Math.max(edgeY, Math.min(innerHeight - edgeY, body.y));
        element.style.transform = `translate(${body.x - layout.x}px, ${body.y - layout.y}px) scale(${body.scale})`;
        return new DOMRect(
          body.x - layout.width / 2,
          body.y - layout.height / 2,
          layout.width,
          layout.height
        );
      });
    },
  };
}
