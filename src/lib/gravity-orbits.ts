import type { GravitySource } from "./gravity-infall";

const TAU = Math.PI * 2;
const ECCENTRICITY = 0.12;
const INCLINATION = (84 * Math.PI) / 180;
const SHADOW_RADII = 2.598_076_211;
const OBSERVER_DISTANCE = 60;

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

/** Same camera and orbital clock as the gas. A thin-lens primary image lifts the far-side pass over the shadow. */
export function projectOrbit(phase: number, radius: number, index: number) {
  const orbit = orbitalState(phase);
  const major = radius * (3.25 + index * 0.9);
  const schwarzschild = radius / SHADOW_RADII;
  const distance = schwarzschild * OBSERVER_DISTANCE;
  const z = orbit.y * major;
  const perspective = distance / (distance + z * Math.sin(INCLINATION));
  const x = -orbit.x * major * perspective;
  const y = -z * Math.cos(INCLINATION) * perspective;
  const beta = Math.max(0.001, Math.hypot(x, y));
  const einsteinSquared = 2 * schwarzschild * Math.max(0, z) * perspective;
  const imageRadius = (beta + Math.sqrt(beta * beta + 4 * einsteinSquared)) / 2;
  const magnification = imageRadius / beta;
  return {
    back: Math.max(0, orbit.depth),
    scale: perspective,
    x: x * magnification,
    y: y * magnification,
  };
}

export function orbitSpeed(index: number) {
  const radius = (3.25 + index * 0.9) * SHADOW_RADII;
  return Math.sqrt(0.5 / radius ** 3) * 3.8;
}

/** Moves the existing anchors, including their hit boxes. No text copies or extra links. */
export function createElementOrbits() {
  const conjunction =
    Math.acos(ECCENTRICITY) - ECCENTRICITY * Math.sqrt(1 - ECCENTRICITY ** 2);
  const phases = innerWidth < 600 ? [-conjunction, conjunction] : [-2.35, -0.5];
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
      element,
      index,
      initialized: false,
      original,
      phase: phases[index] ?? -2.35,
      scale: 1,
      speed: orbitSpeed(index),
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
        delete element.dataset.gravityDepth;
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
          Math.abs(pointer.x - body.x) < layout.width / 2 + 24 &&
          Math.abs(pointer.y - body.y) < layout.height / 2 + 20;
        if (!((nearby || focused) && body.initialized)) {
          body.phase += seconds * body.speed;
          const desired = projectOrbit(body.phase, source.radius, body.index);
          // Only camera/source motion is smoothed. Never clip a free orbit against viewport edges.
          const ease = body.initialized ? 1 - Math.exp(-seconds * 6) : 1;
          body.x += (source.x + desired.x - body.x) * ease;
          body.y += (source.y + desired.y - body.y) * ease;
          body.scale = desired.scale;
          element.style.zIndex = desired.back > 0 ? "0" : "2";
          element.dataset.gravityDepth = String(desired.back);
          body.initialized = true;
        }
        if (focused) {
          element.style.zIndex = "3";
          const edgeX = (layout.width * body.scale) / 2 + 24;
          const edgeY = (layout.height * body.scale) / 2 + 24;
          body.x = Math.max(edgeX, Math.min(innerWidth - edgeX, body.x));
          body.y = Math.max(edgeY, Math.min(innerHeight - edgeY, body.y));
        }
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
