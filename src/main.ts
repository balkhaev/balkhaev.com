import {
  createHoleRenderer,
  type HoleRenderer,
  type HoleView,
} from "./lib/black-hole-gl";
import { createHoleQuality } from "./lib/black-hole-quality";
import { createDrumAudio } from "./lib/drum-audio";
import { observedScore, scoreAt } from "./lib/drum-score";
import { createFlight } from "./lib/flight";
import { CLOCK_RATE, OBSERVER_RADIUS } from "./lib/scene-geometry";

const canvas = document.querySelector<HTMLCanvasElement>("#hole");
const control = document.querySelector<HTMLButtonElement>("#observer");
const hint = document.querySelector<HTMLElement>("#hint");

function start(surface: HTMLCanvasElement, input: HTMLButtonElement) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const localPreview = ["localhost", "127.0.0.1"].includes(location.hostname)
    ? new URLSearchParams(location.search).get("preview-stage")
    : null;
  const previewProgress = Number(localPreview);
  const previewStill =
    localPreview !== null &&
    Number.isFinite(previewProgress) &&
    previewProgress >= 0 &&
    previewProgress <= 20;
  const view: HoleView = {
    distance: OBSERVER_RADIUS,
    fov: 64,
    pitch: 0,
    roll: 0,
    spin: -1,
    stars: 0.25,
    x: 0.5,
    y: 0.5,
    yaw: 0,
  };
  const quality = createHoleQuality();
  const flight = createFlight();
  const audio = createDrumAudio();
  const sound = document.querySelector<HTMLButtonElement>("#sound");
  sound?.addEventListener("click", async () => {
    const enabled = await audio.toggle();
    sound.setAttribute("aria-pressed", String(enabled));
    sound.setAttribute(
      "aria-label",
      enabled ? "Выключить звук бубна" : "Включить звук бубна"
    );
  });
  let lastBeat = -1;
  if (previewStill && previewProgress > 0) {
    flight.travel(previewProgress, true);
    hint?.classList.add("dismissed");
  }
  const flightStatus = document.querySelector<HTMLElement>("#flight-status");
  let renderer: HoleRenderer | null = null;
  let frame = 0;
  let last = 0;
  let time = previewStill ? flight.journey.clock : 0;
  let lookYaw = 0;
  let pointer: { x: number; y: number; at: number } | null = null;
  let lastImpulse = 0;
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: {
    x: number;
    y: number;
    distance: number;
    dragged: boolean;
  } | null = null;

  const frameView = () => {
    const { journey } = flight;
    view.distance = journey.radius;
    view.yaw = lookYaw + (still.matches ? 0 : journey.cameraYaw);
    view.x = 0.5;
    view.y = 0.5;
    surface.dataset.observerRadius = view.distance.toFixed(4);
    surface.dataset.horizon = String(flight.crossed);
    surface.dataset.journeyStage = flight.active ? journey.stage : "Обзор";
    surface.dataset.journeyCycle = String(journey.cycle);
    surface.dataset.journeyPhase = journey.phase.toFixed(3);
    surface.dataset.beatClock = journey.beatClock.toFixed(3);
    surface.dataset.observedScore = observedScore(
      journey.beatClock,
      journey.camera
    ).toFixed(3);
    if (flightStatus) {
      const label = flight.active ? journey.stage : "";
      if (flightStatus.textContent !== label) {
        flightStatus.textContent = label;
      }
    }
    renderer?.view(view);
    return journey;
  };

  const draw = () => {
    if (!renderer) {
      return;
    }
    const journey = frameView();
    const { passage } = journey;
    renderer.draw({
      accretion: 1,
      exitVelocity: journey.exitVelocity,
      passage,
      passageCamera: journey.camera,
      time,
    });
    const { index: beat } = scoreAt(
      observedScore(journey.beatClock, journey.camera)
    );
    const beatId = journey.cycle * 4 + beat;
    if (beatId !== lastBeat) {
      if (
        flight.active &&
        !previewStill &&
        !still.matches &&
        (passage[0] ?? 0) > 0.99 &&
        (passage[3] ?? 0) < 0.1 &&
        beat >= 0
      ) {
        audio.pulse(beat === 3 ? 1.5 : 0.7 + beat * 0.15);
      }
      lastBeat = beatId;
    }
    document.documentElement.classList.add("rendered");
  };

  const fit = () => {
    const box = surface.getBoundingClientRect();
    renderer?.resize(box.width, box.height, devicePixelRatio || 1);
    draw();
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / 30 - 1) {
      return;
    }
    const seconds = last ? (now - last) / 1000 : 0;
    last = now;
    time += flight.active ? flight.advance(seconds) : seconds * CLOCK_RATE;
    if (quality.sample(seconds, renderer?.gpuTime() ?? null)) {
      renderer?.quality(quality.level);
      fit();
    }
    draw();
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
  const resume = () => {
    stop();
    if (document.hidden || !renderer) {
      return;
    }
    draw();
    if (!(still.matches || previewStill)) {
      frame = requestAnimationFrame(tick);
    }
  };
  const mount = () => {
    renderer = createHoleRenderer(surface, view);
    if (!renderer) {
      return;
    }
    renderer.quality(quality.level);
    fit();
    resume();
  };
  const dismissHint = () => {
    hint?.classList.add("dismissed");
  };
  const travel = (amount: number) => {
    time += flight.travel(amount, still.matches || previewStill);
  };

  const disturb = (event: PointerEvent, tap = false) => {
    const now = event.timeStamp;
    const box = surface.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const speed = pointer
      ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) /
        Math.max(16, now - pointer.at)
      : 0.3;
    pointer = { at: now, x: event.clientX, y: event.clientY };
    if (!tap && (now - lastImpulse < 65 || speed < 0.035)) {
      return;
    }
    if (
      renderer?.disturb(
        x,
        y,
        time,
        tap ? 1.25 : 0.65 + Math.min(0.85, speed * 0.6)
      )
    ) {
      lastImpulse = now;
      if (still.matches || previewStill) {
        draw();
      }
    }
  };

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dismissHint();
    input.dataset.pointerFocused = "true";
    disturb(event, true);
    input.focus({ preventScroll: true });
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    input.setPointerCapture(event.pointerId);
    const points = [...touches.values()];
    const [a, b] = points;
    gesture = {
      distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      dragged: points.length > 1,
      x: event.clientX,
      y: event.clientY,
    };
    input.dataset.dragging = "true";
  });
  input.addEventListener("pointermove", (event) => {
    if (!gesture && event.pointerType === "mouse") {
      disturb(event);
    }
  });
  input.addEventListener("pointermove", (event) => {
    if (gesture && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...touches.values()];
      const [a, b] = points;
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.distance > 0) {
          travel(Math.log(distance / gesture.distance) * 0.8);
        }
        gesture.distance = distance;
        gesture.dragged = true;
      } else {
        const dx = event.clientX - gesture.x,
          dy = event.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 3 || gesture.dragged) {
          gesture.dragged = true;
          lookYaw -= dx * 0.15;
          view.pitch = Math.max(-89, Math.min(89, view.pitch + dy * 0.15));
          gesture.x = event.clientX;
          gesture.y = event.clientY;
        }
      }
    }
    if (still.matches || gesture) {
      draw();
    }
  });
  input.addEventListener("pointerleave", () => {
    pointer = null;
  });
  const release = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (input.hasPointerCapture(event.pointerId)) {
      input.releasePointerCapture(event.pointerId);
    }
    const [remaining] = [...touches.values()];
    gesture = remaining ? { ...remaining, distance: 0, dragged: true } : null;
    if (!gesture) {
      delete input.dataset.dragging;
    }
  };
  input.addEventListener("pointerup", release);
  input.addEventListener("pointercancel", release);
  input.addEventListener("lostpointercapture", (event) => {
    if (touches.has(event.pointerId)) {
      release(event);
    }
  });
  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      dismissHint();
      let unit = 1;
      if (event.deltaMode === 1) {
        unit = 16;
      } else if (event.deltaMode === 2) {
        unit = surface.clientHeight;
      }
      travel(event.deltaY * unit * 0.002);
      draw();
    },
    { passive: false }
  );
  input.addEventListener("keydown", (event) => {
    delete input.dataset.pointerFocused;
    if (event.key === "ArrowLeft") {
      lookYaw -= 4;
    } else if (event.key === "ArrowRight") {
      lookYaw += 4;
    } else if (event.key === "ArrowUp") {
      view.pitch = Math.min(89, view.pitch + 4);
    } else if (event.key === "ArrowDown") {
      view.pitch = Math.max(-89, view.pitch - 4);
    } else if (event.key === "+" || event.key === "=") {
      travel(0.24);
    } else if (event.key === "-") {
      travel(-0.24);
    } else {
      return;
    }
    event.preventDefault();
    dismissHint();
    draw();
  });
  const resize = new ResizeObserver(fit);
  resize.observe(surface);
  still.addEventListener("change", resume);
  document.addEventListener("visibilitychange", resume);
  surface.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    renderer?.dispose();
    renderer = null;
    document.documentElement.classList.remove("rendered");
  });
  surface.addEventListener("webglcontextrestored", mount);
  surface.addEventListener("sceneassetload", draw);
  window.addEventListener("pagehide", (event) => {
    stop();
    if (!event.persisted) {
      resize.disconnect();
      renderer?.dispose();
      audio.dispose();
      renderer = null;
    }
  });
  window.addEventListener("pageshow", resume);
  window.addEventListener("blur", () => {
    gesture = null;
    touches.clear();
    pointer = null;
    delete input.dataset.dragging;
  });
  mount();
}

if (canvas && control) {
  start(canvas, control);
}
