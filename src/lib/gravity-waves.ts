import { type GravitySource, lensingField } from "./gravity-infall";
import { createGravityLens } from "./gravity-lens";
import { createElementOrbits } from "./gravity-orbits";

interface Wave {
  birth: number;
  strength: number;
  x: number;
  y: number;
}

const WAVE_SPEED = 460;
const WAVE_WIDTH = 56;
const WAVE_LIFETIME_MS = 2800;
const MAX_WAVES = 8;
const MAX_DISPLACEMENT = 160;

function sourceShift(source: GravitySource, previous: GravitySource | null) {
  return previous
    ? Math.hypot(
        source.x - previous.x,
        source.y - previous.y,
        source.radius - previous.radius
      )
    : Number.POSITIVE_INFINITY;
}

/** A screen-space vector field: neighbouring pixels are bent by different amounts at a wavefront. */
function drawDisplacement(
  context: CanvasRenderingContext2D,
  pixels: ImageData,
  waves: Wave[],
  now: number,
  stepX: number,
  stepY: number,
  source: GravitySource
) {
  const fronts = waves.map((wave) => {
    const age = (now - wave.birth) / 1000;
    // Smoothly reach zero before retirement, including a wave still inside a very large viewport.
    const fade = Math.min(1, (WAVE_LIFETIME_MS / 1000 - age) / 0.4);
    return {
      ...wave,
      amplitude: wave.strength * Math.exp(-age * 0.55) * fade,
      radius: age * WAVE_SPEED,
    };
  });
  let index = 0;
  for (let row = 0; row < pixels.height; row += 1) {
    const y = (row + 0.5) * stepY;
    for (let column = 0; column < pixels.width; column += 1) {
      const x = (column + 0.5) * stepX;
      const field = lensingField(x, y, source);
      let dx = field.x / MAX_DISPLACEMENT;
      let dy = field.y / MAX_DISPLACEMENT;
      for (const wave of fronts) {
        const vx = x - wave.x;
        const vy = y - wave.y;
        const distance = Math.hypot(vx, vy);
        const phase = (distance - wave.radius) / WAVE_WIDTH;
        if (Math.abs(phase) > 2.5 || distance < 1) {
          continue;
        }
        const deflection =
          Math.sin(phase * Math.PI) * Math.exp(-phase * phase) * wave.amplitude;
        dx += (vx / distance) * deflection * (7 / MAX_DISPLACEMENT);
        dy += (vy / distance) * deflection * (7 / MAX_DISPLACEMENT);
      }
      pixels.data[index] = 128 + Math.max(-1, Math.min(1, dx)) * 127;
      pixels.data[index + 1] = 128 + Math.max(-1, Math.min(1, dy)) * 127;
      pixels.data[index + 2] = 128;
      pixels.data[index + 3] = 255;
      index += 4;
    }
  }
  context.putImageData(pixels, 0, 0);
}

/** The lens stays fixed until its mass moves; only an explicit drag produces a short ripple. */
export function createGravityWaves(
  reducedMotion: MediaQueryList,
  scene: HTMLElement,
  size: number
) {
  const map = document.createElement("canvas");
  const context = map.getContext("2d");
  let pixels: ImageData | null = null;
  let lens: ReturnType<typeof createGravityLens> | null = null;
  let orbits: ReturnType<typeof createElementOrbits> | null = null;
  let waves: Wave[] = [];
  let frame = 0;
  let last = 0;
  let lastOrbit = 0;
  let width = 0;
  let height = 0;
  let previousSource: GravitySource | null = null;
  let hadWaves = false;
  let dirty = true;
  let detail = "";
  const canvas = scene.querySelector("canvas");

  const clear = () => {
    waves = [];
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    lastOrbit = 0;
    clear();
    lens?.dispose();
    lens = null;
    if (reducedMotion.matches) {
      orbits?.dispose();
      orbits = null;
    }
    pixels = null;
    previousSource = null;
    detail = "";
  };
  const fit = (next: string) => {
    width = innerWidth;
    height = innerHeight;
    const edges: Record<string, number> = {
      balanced: 320,
      high: 400,
      low: 200,
    };
    const ratio = (edges[next] ?? 200) / Math.max(width, height);
    map.width = Math.max(1, Math.round(width * ratio));
    map.height = Math.max(1, Math.round(height * ratio));
    pixels = context?.createImageData(map.width, map.height) ?? null;
    lens?.dispose();
    lens = createGravityLens(width, height, MAX_DISPLACEMENT);
    previousSource = null;
    detail = next;
  };
  const renderLens = (now: number, source: GravitySource) => {
    if (!(pixels && context)) {
      return;
    }
    waves = waves.filter((wave) => now - wave.birth < WAVE_LIFETIME_MS);
    const moved = sourceShift(source, previousSource) > 0.15;
    if (moved || waves.length > 0 || hadWaves || dirty) {
      drawDisplacement(
        context,
        pixels,
        waves,
        now,
        width / map.width,
        height / map.height,
        source
      );
      dirty = !lens?.update(source, map.toDataURL());
      if (!dirty) {
        previousSource = source;
      }
    } else {
      lens?.update(source);
    }
    hadWaves = waves.length > 0;
  };
  const tick = (now: number) => {
    if (reducedMotion.matches || document.hidden) {
      stop();
      return;
    }
    frame = requestAnimationFrame(tick);
    const orbitSeconds = lastOrbit
      ? Math.min(0.05, (now - lastOrbit) / 1000)
      : 0;
    lastOrbit = now;
    const box = scene.getBoundingClientRect();
    const image = canvas?.getBoundingClientRect() ?? box;
    const source = {
      radius: Math.min(image.width, image.height) * size,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
    orbits?.update(source, orbitSeconds);
    const next = canvas?.dataset.holeQuality ?? "balanced";
    const interval = next === "high" ? 1000 / 30 : 1000 / 20;
    if (now - last < interval - 1 || !context) {
      return;
    }
    last = now;
    if (next !== detail) {
      fit(next);
    }
    renderLens(now, source);
  };
  const wake = () => {
    if (frame || reducedMotion.matches || document.hidden || !context) {
      return;
    }
    orbits ??= createElementOrbits();
    frame = requestAnimationFrame(tick);
  };
  const reset = () => {
    stop();
    wake();
  };
  const visibility = () => (document.hidden ? stop() : wake());
  window.addEventListener("resize", reset);
  window.addEventListener("blur", stop);
  window.addEventListener("focus", wake);
  document.addEventListener("scroll", reset, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  reducedMotion.addEventListener("change", reset);
  wake();
  return {
    clear,
    dispose() {
      stop();
      orbits?.dispose();
      orbits = null;
      window.removeEventListener("resize", reset);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", wake);
      document.removeEventListener("scroll", reset, true);
      document.removeEventListener("visibilitychange", visibility);
      reducedMotion.removeEventListener("change", reset);
    },
    emit(x: number, y: number, strength: number) {
      if (reducedMotion.matches || document.hidden || !context) {
        return;
      }
      wake();
      waves.push({ birth: performance.now(), strength, x, y });
      if (waves.length > MAX_WAVES) {
        waves.shift();
      }
    },
  };
}
