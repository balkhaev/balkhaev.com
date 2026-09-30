/** Pointer motion stays outside React so typing never competes with animation renders. */
export interface HoleInteraction {
  energy: number;
  strength: number;
  x: number;
  y: number;
}

const FOLLOW_RATE = 22;
const MOTION_DECAY = 3;
/** Pointer speed in CSS pixels per millisecond at which the disk's response peaks. */
const FULL_ENERGY_SPEED = 1.5;
const MIN_EVENT_MS = 8;
const GLOW_RADIUS = 36;

/** Approximate the projected disk for the ambient glow; the shader heats actual gas pixels. */
function diskContact(x: number, y: number): number {
  const arch = Math.hypot(x / 1.5, (y + 0.1) / 1.65) - 1;
  const ring = Math.exp(-((arch / 0.16) ** 2));
  const front =
    Math.exp(-(((y - 0.16) / 0.19) ** 2)) *
    Math.max(0, Math.min(1, (4.4 - Math.abs(x)) / 0.9));
  return Math.max(ring, front);
}

export function createHoleInteraction(
  canvas: HTMLCanvasElement,
  surface: HTMLElement,
  reducedMotion: MediaQueryList,
  getGlow: () => HTMLDivElement | null,
  getView: () => { size: number; x: number; y: number }
) {
  const current: HoleInteraction = { energy: 0, strength: 0, x: 0.5, y: 0.5 };
  let energy = 0;
  let previous: { time: number; x: number; y: number } | null = null;

  const reset = () => {
    energy = 0;
    previous = null;
    current.energy = 0;
    current.strength = 0;
    const glow = getGlow();
    if (glow) {
      glow.style.opacity = "0";
    }
  };
  const move = (event: PointerEvent) => {
    const occluded =
      event.target instanceof Element &&
      event.target.closest(
        "[data-gravity], input, textarea, select, [role=dialog]"
      );
    if (reducedMotion.matches || event.pointerType !== "mouse" || occluded) {
      reset();
      return;
    }
    if (previous) {
      const distance = Math.hypot(
        event.clientX - previous.x,
        event.clientY - previous.y
      );
      const elapsed = Math.max(MIN_EVENT_MS, event.timeStamp - previous.time);
      energy = Math.min(1, distance / elapsed / FULL_ENERGY_SPEED);
    }
    previous = { time: event.timeStamp, x: event.clientX, y: event.clientY };
  };

  surface.addEventListener("pointermove", move, { passive: true });
  surface.addEventListener("pointerleave", reset);
  surface.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  document.addEventListener("scroll", reset, true);

  return {
    dispose() {
      reset();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
      surface.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      document.removeEventListener("scroll", reset, true);
    },
    reset,
    update(seconds: number, feeding: boolean): HoleInteraction {
      if (reducedMotion.matches || feeding) {
        reset();
        return current;
      }
      if (!previous) {
        return current;
      }
      const box = canvas.getBoundingClientRect();
      const view = getView();
      const radius = Math.min(box.width, box.height) * view.size;
      if (radius <= 0) {
        reset();
        return current;
      }
      const x = previous.x - box.left;
      const y = previous.y - box.top;
      const contact = diskContact(
        (x - view.x * box.width) / radius,
        (y - view.y * box.height) / radius
      );
      const ease = 1 - Math.exp(-seconds * FOLLOW_RATE);
      energy *= Math.exp(-seconds * MOTION_DECAY);
      current.x = x / box.width;
      current.y = y / box.height;
      current.energy += (energy - current.energy) * ease;
      current.strength += (contact - current.strength) * ease;
      const glow = getGlow();
      if (glow) {
        glow.style.transform = `translate3d(${previous.x - GLOW_RADIUS}px, ${previous.y - GLOW_RADIUS}px, 0)`;
        glow.style.opacity = `${current.strength * (0.24 + current.energy * 0.7)}`;
      }
      return current;
    },
  };
}
