import { createGravityPull } from "./gravity-pull";
import { createGravityWaves } from "./gravity-waves";

const WAVE_INTERVAL_MS = 180;
const MIN_WAVE_DISTANCE = 7;
const KEY_STEP = 32;
const SPRING_STIFFNESS = 18;
const SPRING_DISTANCE = 320;
const DRAG_DAMPING = 9;
const RELEASE_DAMPING = 3.8;
const MAX_SPEED = 1000;
const REST_SPEED = 3;
const REST_DISTANCE = 0.35;
const PHYSICS_STEP = 1 / 120;

/** An explicit grab pulls a massive scene; its remaining momentum settles after release. */
export function createHoleDrag(
  scene: HTMLDivElement,
  handle: HTMLButtonElement,
  size: number
) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const waves = createGravityWaves(reducedMotion, scene, size);
  const attraction = createGravityPull(scene, handle, reducedMotion);
  let offsetX = 0;
  let offsetY = 0;
  let targetX = 0;
  let targetY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let frame = 0;
  let lastFrame = 0;
  let drag: { id: number; x: number; y: number } | null = null;
  let lastWave = { time: 0, x: 0, y: 0 };

  const move = (dx: number, dy: number) => {
    const box = scene.getBoundingClientRect();
    const radius = Math.min(box.width, box.height) * size;
    const margin = Math.min(radius * 1.6, window.innerWidth / 3);
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    // A partly offscreen starting position must not jump to the boundary on the first touch.
    const x = Math.max(
      Math.min(margin, centerX),
      Math.min(Math.max(window.innerWidth - margin, centerX), centerX + dx)
    );
    const y = Math.max(
      Math.min(56 + margin, centerY),
      Math.min(Math.max(window.innerHeight - margin, centerY), centerY + dy)
    );
    offsetX += x - centerX;
    offsetY += y - centerY;
    scene.style.translate = `${offsetX}px ${offsetY}px`;
    attraction.update();
    const now = performance.now();
    const distance = Math.hypot(x - lastWave.x, y - lastWave.y);
    if (
      now - lastWave.time >= WAVE_INTERVAL_MS &&
      distance >= MIN_WAVE_DISTANCE
    ) {
      const strength = Math.min(1, 0.35 + distance / 120);
      waves.emit(x, y, strength);
      lastWave = { time: now, x, y };
    }
  };
  const end = () => {
    if (!drag) {
      return;
    }
    const { id } = drag;
    drag = null;
    handle.removeAttribute("data-dragging");
    if (handle.hasPointerCapture(id)) {
      handle.releasePointerCapture(id);
    }
  };
  const stop = () => {
    end();
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    velocityX = 0;
    velocityY = 0;
    targetX = offsetX;
    targetY = offsetY;
  };
  const advance = (elapsed: number) => {
    let remaining = Math.min(elapsed, 0.05);
    let x = offsetX;
    let y = offsetY;
    // Small substeps keep the spring stable across refresh rates and occasional slow frames.
    while (remaining > 0) {
      const seconds = Math.min(remaining, PHYSICS_STEP);
      const distance = Math.hypot(targetX - x, targetY - y);
      const pull = drag
        ? SPRING_STIFFNESS * (1 + Math.min(distance / SPRING_DISTANCE, 2))
        : 0;
      const damping = Math.exp(
        -(drag ? DRAG_DAMPING : RELEASE_DAMPING) * seconds
      );
      velocityX = (velocityX + (targetX - x) * pull * seconds) * damping;
      velocityY = (velocityY + (targetY - y) * pull * seconds) * damping;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > MAX_SPEED) {
        velocityX *= MAX_SPEED / speed;
        velocityY *= MAX_SPEED / speed;
      }
      x += velocityX * seconds;
      y += velocityY * seconds;
      remaining -= seconds;
    }
    return { x, y };
  };
  const tick = (now: number) => {
    frame = 0;
    if (handle.disabled || document.hidden || reducedMotion.matches) {
      stop();
      return;
    }
    const { x, y } = advance((now - lastFrame) / 1000);
    lastFrame = now;
    move(x - offsetX, y - offsetY);
    // Discard momentum into a viewport boundary instead of accumulating a hidden pull.
    if (Math.abs(x - offsetX) > 0.01) {
      velocityX = 0;
      targetX = offsetX;
    }
    if (Math.abs(y - offsetY) > 0.01) {
      velocityY = 0;
      targetY = offsetY;
    }
    const settled =
      Math.hypot(velocityX, velocityY) < REST_SPEED &&
      (!drag ||
        Math.hypot(targetX - offsetX, targetY - offsetY) < REST_DISTANCE);
    if (settled) {
      velocityX = 0;
      velocityY = 0;
      if (drag) {
        move(targetX - offsetX, targetY - offsetY);
      }
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  const play = () => {
    if (frame !== 0) {
      return;
    }
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const start = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || handle.disabled) {
      return;
    }
    event.preventDefault();
    stop();
    handle.setAttribute("data-pointer", "");
    handle.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const box = scene.getBoundingClientRect();
    lastWave = {
      time: performance.now() - WAVE_INTERVAL_MS,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("data-dragging", "");
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    if (handle.disabled) {
      stop();
      return;
    }
    targetX += event.clientX - drag.x;
    targetY += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (reducedMotion.matches) {
      move(targetX - offsetX, targetY - offsetY);
      targetX = offsetX;
      targetY = offsetY;
      return;
    }
    play();
  };
  const release = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) {
      end();
    }
  };
  const cancel = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) {
      stop();
    }
  };
  const reset = () => {
    stop();
    waves.clear();
    offsetX = 0;
    offsetY = 0;
    targetX = 0;
    targetY = 0;
    scene.style.removeProperty("translate");
    attraction.update();
  };
  const key = (event: KeyboardEvent) => {
    handle.removeAttribute("data-pointer");
    if (event.key === "Home" || event.key === "Escape") {
      event.preventDefault();
      reset();
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
    };
    const direction = directions[event.key];
    if (!direction) {
      return;
    }
    event.preventDefault();
    stop();
    const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP;
    move(direction[0] * step, direction[1] * step);
  };
  const blur = () => {
    handle.removeAttribute("data-pointer");
    stop();
  };
  const visibility = () => {
    if (document.hidden) {
      stop();
    }
  };
  const scroll = () => stop();
  handle.addEventListener("pointerdown", start);
  handle.addEventListener("pointermove", pointerMove);
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  handle.addEventListener("keydown", key);
  handle.addEventListener("blur", blur);
  window.addEventListener("blur", stop);
  reducedMotion.addEventListener("change", stop);
  window.addEventListener("resize", reset);
  document.addEventListener("scroll", scroll, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  return () => {
    reset();
    waves.dispose();
    attraction.dispose();
    handle.removeEventListener("pointerdown", start);
    handle.removeEventListener("pointermove", pointerMove);
    handle.removeEventListener("pointerup", release);
    handle.removeEventListener("pointercancel", cancel);
    handle.removeEventListener("lostpointercapture", cancel);
    handle.removeEventListener("keydown", key);
    handle.removeEventListener("blur", blur);
    window.removeEventListener("blur", stop);
    reducedMotion.removeEventListener("change", stop);
    window.removeEventListener("resize", reset);
    document.removeEventListener("scroll", scroll, true);
    document.removeEventListener("visibilitychange", visibility);
  };
}
