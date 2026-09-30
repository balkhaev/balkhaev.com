import { type GravitySource, infallField } from "./gravity-infall";
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
const MAX_DISPLACEMENT = 48;

/** A screen-space vector field: neighbouring pixels are bent by different amounts at a wavefront. */
function drawDisplacement(
  context: CanvasRenderingContext2D,
  pixels: ImageData,
  waves: Wave[],
  now: number,
  stepX: number,
  stepY: number,
  source: GravitySource,
  time: number,
  anchors: DOMRect[]
) {
  const tides = anchors.map((anchor) => {
    const x = anchor.left + anchor.width / 2;
    const y = anchor.top + anchor.height / 2;
    const angle = Math.atan2(y - source.y, x - source.x);
    return {
      span: anchor.width / 2 + 60,
      ux: Math.cos(angle),
      uy: Math.sin(angle),
      x,
      y,
    };
  });
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
      const field = infallField(x, y, source, time);
      let dx = field.x / MAX_DISPLACEMENT;
      let dy = field.y / MAX_DISPLACEMENT;
      // Local tidal gradients visibly bend the letters and their surrounding stars together.
      for (const anchor of tides) {
        const vx = x - anchor.x;
        const vy = y - anchor.y;
        const { span, ux, uy } = anchor;
        if (Math.abs(vx) > span * 1.5 || Math.abs(vy) > 80) {
          continue;
        }
        const along = vx * ux + vy * uy;
        const envelope = Math.exp(-((vx / span) ** 2 + (vy / 45) ** 2));
        const tide = Math.sin(along / 28 + time * 1.8) * envelope * 6;
        dx += (ux * tide) / MAX_DISPLACEMENT;
        dy += (uy * tide) / MAX_DISPLACEMENT;
      }
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
        dx += (vx / distance) * deflection * (20 / MAX_DISPLACEMENT);
        dy += (vy / distance) * deflection * (20 / MAX_DISPLACEMENT);
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

/** Continuous infall and transient drag waves share one field, so filters never overwrite each other. */
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
  let time = 0;
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
    detail = "";
  };
  const fit = (next: string) => {
    width = innerWidth;
    height = innerHeight;
    const edges: Record<string, number> = {
      balanced: 200,
      high: 240,
      low: 144,
    };
    const ratio = (edges[next] ?? 200) / Math.max(width, height);
    map.width = Math.max(1, Math.round(width * ratio));
    map.height = Math.max(1, Math.round(height * ratio));
    pixels = context?.createImageData(map.width, map.height) ?? null;
    lens?.dispose();
    lens = createGravityLens(width, height, MAX_DISPLACEMENT);
    detail = next;
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
    const anchors = orbits?.update(source, orbitSeconds) ?? [];
    const next = canvas?.dataset.holeQuality ?? "balanced";
    const interval = next === "high" ? 1000 / 30 : 1000 / 20;
    if (now - last < interval - 1 || !context) {
      return;
    }
    const elapsed = last ? Math.min(0.1, (now - last) / 1000) : 0;
    time += elapsed;
    last = now;
    if (next !== detail) {
      fit(next);
    }
    if (!pixels) {
      return;
    }
    waves = waves.filter((wave) => now - wave.birth < WAVE_LIFETIME_MS);
    drawDisplacement(
      context,
      pixels,
      waves,
      now,
      width / map.width,
      height / map.height,
      source,
      time,
      anchors
    );
    lens?.update(map.toDataURL());
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
