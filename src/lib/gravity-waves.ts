import { createGravityLens } from "./gravity-lens";

interface Wave {
  birth: number;
  strength: number;
  x: number;
  y: number;
}

const WAVE_SPEED = 460;
const WAVE_WIDTH = 56;
const WAVE_LIFETIME_MS = 2800;
const MAX_WAVES = 16;
const FRAME_MS = 1000 / 30;
const MAP_LONG_EDGE = 280;
const MAX_DISPLACEMENT = 20;

/** A screen-space vector field: neighbouring pixels are bent by different amounts at a wavefront. */
function drawDisplacement(
  context: CanvasRenderingContext2D,
  pixels: ImageData,
  waves: Wave[],
  now: number,
  stepX: number,
  stepY: number
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
      let dx = 0;
      let dy = 0;
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
        dx += (vx / distance) * deflection;
        dy += (vy / distance) * deflection;
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

/** One shared texture refracts the actual rendered stars, text, borders and controls. */
export function createGravityWaves(reducedMotion: MediaQueryList) {
  const map = document.createElement("canvas");
  const context = map.getContext("2d");
  let pixels: ImageData | null = null;
  let lens: ReturnType<typeof createGravityLens> | null = null;
  let waves: Wave[] = [];
  let frame = 0;
  let last = 0;
  let width = 0;
  let height = 0;

  const clear = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    waves = [];
    lens?.dispose();
    lens = null;
    pixels = null;
  };
  const tick = (now: number) => {
    waves = waves.filter((wave) => now - wave.birth < WAVE_LIFETIME_MS);
    if (waves.length === 0 || reducedMotion.matches || document.hidden) {
      clear();
      return;
    }
    frame = requestAnimationFrame(tick);
    if (now - last < FRAME_MS - 1 || !(context && pixels)) {
      return;
    }
    last = now;
    drawDisplacement(
      context,
      pixels,
      waves,
      now,
      width / map.width,
      height / map.height
    );
    lens?.update(map.toDataURL());
  };
  const visibility = () => {
    if (document.hidden) {
      clear();
    }
  };
  const editing = (event: FocusEvent) => {
    if (
      event.target instanceof Element &&
      event.target.matches("input, textarea, select, [contenteditable=true]")
    ) {
      clear();
    }
  };
  window.addEventListener("resize", clear);
  window.addEventListener("blur", clear);
  document.addEventListener("scroll", clear, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("focusin", editing);
  reducedMotion.addEventListener("change", clear);

  return {
    clear,
    dispose() {
      clear();
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("scroll", clear, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", editing);
      reducedMotion.removeEventListener("change", clear);
    },
    emit(x: number, y: number, strength: number) {
      if (reducedMotion.matches || document.hidden || !context) {
        return;
      }
      if (frame === 0) {
        width = window.innerWidth;
        height = window.innerHeight;
        const ratio = MAP_LONG_EDGE / Math.max(width, height);
        map.width = Math.max(1, Math.round(width * ratio));
        map.height = Math.max(1, Math.round(height * ratio));
        pixels = context.createImageData(map.width, map.height);
        lens = createGravityLens(width, height, MAX_DISPLACEMENT);
        frame = requestAnimationFrame(tick);
      }
      waves.push({ birth: performance.now(), strength, x, y });
      if (waves.length > MAX_WAVES) {
        waves.shift();
      }
    },
  };
}
