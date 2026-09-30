import {
  createHoleRenderer,
  type HoleRenderer,
  type HoleView,
} from "./lib/black-hole-gl";
import { createHoleQuality, HOLE_QUALITY } from "./lib/black-hole-quality";
import {
  CLOCK_RATE,
  cameraOf,
  contactPosition,
  fittedSize,
  focalLength,
  OBSERVER_RADIUS,
} from "./lib/scene-geometry";

const canvas = document.querySelector<HTMLCanvasElement>("#hole");
const control = document.querySelector<HTMLButtonElement>("#observer");
const links = Array.from(
  document.querySelectorAll<HTMLAnchorElement>(".contacts a")
);
const hint = document.querySelector<HTMLElement>("#hint");

function start(surface: HTMLCanvasElement, input: HTMLButtonElement) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const view: HoleView = {
    azimuth: 0,
    inclination: 76,
    roll: -8,
    size: 0.06,
    spin: -1,
    stars: 0.9,
    x: 0.5,
    y: 0.5,
  };
  const quality = createHoleQuality();
  let renderer: HoleRenderer | null = null;
  let frame = 0;
  let last = 0;
  let time = 0;
  let framingTime = 0;
  let zoom = 1;
  let selected = -1;
  let tracking = -1;
  let pointer: { x: number; y: number } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: {
    x: number;
    y: number;
    distance: number;
    dragged: boolean;
    contact: number;
  } | null = null;

  const frameView = () => {
    const { width, height } = surface.getBoundingClientRect();
    view.size = fittedSize(view, width, height, framingTime) * zoom;
    view.x = 0.5;
    view.y = 0.5;
    if (tracking >= 0) {
      const point = contactPosition(tracking, time);
      const { basis, eye } = cameraOf(view);
      const distance =
        OBSERVER_RADIUS -
        (point.x * eye[0] + point.y * eye[1] + point.z * eye[2]) /
          OBSERVER_RADIUS;
      const focal = focalLength(view, width, height);
      view.x =
        0.5 -
        (focal *
          (point.x * (basis[0] ?? 0) +
            point.y * (basis[1] ?? 0) +
            point.z * (basis[2] ?? 0))) /
          distance /
          width;
      view.y =
        0.5 +
        (focal *
          (point.x * (basis[3] ?? 0) +
            point.y * (basis[4] ?? 0) +
            point.z * (basis[5] ?? 0))) /
          distance /
          height;
    }
    renderer?.view(view);
  };

  const draw = () => {
    if (!renderer) {
      return;
    }
    frameView();
    if (pointer && !gesture && tracking < 0) {
      selected = renderer.hit(pointer.x, pointer.y, time);
    }
    input.dataset.overContact = String(selected >= 0);
    renderer.draw({ accretion: 1, selected, time });
    document.documentElement.classList.add("rendered");
  };

  const fit = () => {
    const box = surface.getBoundingClientRect();
    renderer?.resize(
      box.width,
      box.height,
      Math.min(devicePixelRatio || 1, 2),
      HOLE_QUALITY[quality.level].detail
    );
    draw();
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / 30 - 1) {
      return;
    }
    const seconds = last ? (now - last) / 1000 : 0;
    last = now;
    time += seconds * CLOCK_RATE;
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
    if (!still.matches) {
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
  const reset = () => {
    framingTime = time;
    view.inclination = 76;
    view.azimuth = 0;
    zoom = 1;
    tracking = -1;
    selected = -1;
    draw();
  };
  const contactAt = (event: PointerEvent) =>
    renderer?.hit(event.clientX, event.clientY, time) ?? -1;

  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    dismissHint();
    input.focus({ preventScroll: true });
    tracking = -1;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    input.setPointerCapture(event.pointerId);
    const points = [...touches.values()];
    const [a, b] = points;
    gesture = {
      contact: contactAt(event),
      distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      dragged: points.length > 1,
      x: event.clientX,
      y: event.clientY,
    };
    input.dataset.dragging = "true";
  });
  input.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (gesture && touches.has(event.pointerId)) {
      touches.set(event.pointerId, pointer);
      const points = [...touches.values()];
      const [a, b] = points;
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.distance > 0) {
          zoom = Math.max(
            0.55,
            Math.min(2, (zoom * distance) / gesture.distance)
          );
        }
        gesture.distance = distance;
        gesture.dragged = true;
      } else {
        const dx = event.clientX - gesture.x,
          dy = event.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 3 || gesture.dragged) {
          gesture.dragged = true;
          view.azimuth = Math.max(
            -65,
            Math.min(65, (view.azimuth ?? 0) - dx * 0.16)
          );
          view.inclination = Math.max(
            28,
            Math.min(152, view.inclination + dy * 0.16)
          );
          gesture.x = event.clientX;
          gesture.y = event.clientY;
        }
      }
    }
    if (still.matches || gesture) {
      draw();
    }
  });
  const release = (event: PointerEvent) => {
    const click =
      event.type === "pointerup" &&
      gesture &&
      !gesture.dragged &&
      gesture.contact >= 0 &&
      gesture.contact === contactAt(event);
    const index = gesture?.contact ?? -1;
    touches.delete(event.pointerId);
    if (input.hasPointerCapture(event.pointerId)) {
      input.releasePointerCapture(event.pointerId);
    }
    const [remaining] = [...touches.values()];
    gesture = remaining
      ? { ...remaining, contact: -1, distance: 0, dragged: true }
      : null;
    if (!gesture) {
      delete input.dataset.dragging;
    }
    if (click) {
      links[index]?.click();
    }
  };
  input.addEventListener("pointerup", release);
  input.addEventListener("pointercancel", release);
  input.addEventListener("lostpointercapture", (event) => {
    if (touches.has(event.pointerId)) {
      release(event);
    }
  });
  input.addEventListener("pointerleave", () => {
    pointer = null;
    if (tracking < 0) {
      selected = -1;
    }
  });
  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      dismissHint();
      zoom = Math.max(
        0.55,
        Math.min(2, zoom * Math.exp(-event.deltaY * 0.001))
      );
      draw();
    },
    { passive: false }
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Home" || event.key === "Escape") {
      reset();
    } else if (event.key === "ArrowLeft") {
      view.azimuth = Math.max(-65, (view.azimuth ?? 0) - 4);
    } else if (event.key === "ArrowRight") {
      view.azimuth = Math.min(65, (view.azimuth ?? 0) + 4);
    } else if (event.key === "ArrowUp") {
      view.inclination = Math.max(28, view.inclination - 4);
    } else if (event.key === "ArrowDown") {
      view.inclination = Math.min(152, view.inclination + 4);
    } else if (event.key === "+" || event.key === "=") {
      zoom = Math.min(2, zoom * 1.1);
    } else if (event.key === "-") {
      zoom = Math.max(0.55, zoom / 1.1);
    } else {
      return;
    }
    event.preventDefault();
    dismissHint();
    draw();
  });
  for (const [index, link] of links.entries()) {
    link.addEventListener("focus", () => {
      selected = index;
      tracking = index;
      pointer = null;
      dismissHint();
      draw();
    });
    link.addEventListener("blur", () => {
      tracking = -1;
      selected = -1;
      draw();
    });
    link.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.focus();
        reset();
      }
    });
  }
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
  window.addEventListener("pagehide", (event) => {
    stop();
    if (!event.persisted) {
      resize.disconnect();
      renderer?.dispose();
      renderer = null;
    }
  });
  window.addEventListener("pageshow", resume);
  window.addEventListener("blur", () => {
    gesture = null;
    touches.clear();
    delete input.dataset.dragging;
    pointer = null;
  });
  window.setTimeout(dismissHint, 10_000);
  mount();
}

if (canvas && control) {
  start(canvas, control);
}
