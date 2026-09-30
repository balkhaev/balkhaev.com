import {
  createHoleRenderer,
  type HoleRenderer,
  type HoleView,
} from "./lib/black-hole-gl";
import { createHoleQuality, HOLE_QUALITY } from "./lib/black-hole-quality";
import { createFlight } from "./lib/flight";
import {
  CLOCK_RATE,
  contactPosition,
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
    distance: OBSERVER_RADIUS,
    fov: 56,
    pitch: 0,
    roll: 0,
    spin: -1,
    stars: 0.9,
    x: 0.5,
    y: 0.5,
    yaw: 0,
  };
  const quality = createHoleQuality();
  const flight = createFlight();
  const flightStatus = document.querySelector<HTMLElement>("#flight-status");
  const restart = document.querySelector<HTMLButtonElement>("#restart");
  let renderer: HoleRenderer | null = null;
  let frame = 0;
  let last = 0;
  let time = 0;
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
    view.distance = flight.radius;
    view.x = 0.5;
    view.y = 0.5;
    if (tracking >= 0) {
      const point = contactPosition(tracking, time);
      const tilt = (84 * Math.PI) / 180;
      const dy = point.y - view.distance * Math.cos(tilt);
      const dz = point.z + view.distance * Math.sin(tilt);
      view.yaw =
        (Math.atan2(-point.x, -dy * Math.cos(tilt) + dz * Math.sin(tilt)) *
          180) /
        Math.PI;
      view.pitch =
        (Math.asin(
          (dy * Math.sin(tilt) + dz * Math.cos(tilt)) /
            Math.hypot(point.x, dy, dz)
        ) *
          180) /
        Math.PI;
    }
    surface.dataset.observerRadius = view.distance.toFixed(4);
    surface.dataset.horizon = String(flight.crossed);
    if (flightStatus) {
      let label = "";
      if (flight.active) {
        label = `Свободное падение · ${view.distance.toFixed(2)} rₛ`;
      }
      if (flight.crossed) {
        label = "За горизонтом · оглянитесь";
      }
      if (flight.ended) {
        label = "Конец траектории";
      }
      if (flightStatus.textContent !== label) {
        flightStatus.textContent = label;
      }
    }
    if (restart) {
      restart.hidden = !flight.active;
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
    flight.reset();
    time = 0;
    view.pitch = 0;
    view.yaw = 0;
    tracking = -1;
    selected = -1;
    draw();
  };
  restart?.addEventListener("click", reset);
  const travel = (amount: number) => {
    tracking = -1;
    time += flight.travel(amount, still.matches);
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
          travel(Math.log(distance / gesture.distance));
        }
        gesture.distance = distance;
        gesture.dragged = true;
      } else {
        const dx = event.clientX - gesture.x,
          dy = event.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 3 || gesture.dragged) {
          gesture.dragged = true;
          view.yaw -= dx * 0.19;
          view.pitch = Math.max(-89, Math.min(89, view.pitch + dy * 0.19));
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
      let unit = 1;
      if (event.deltaMode === 1) {
        unit = 16;
      } else if (event.deltaMode === 2) {
        unit = surface.clientHeight;
      }
      travel(event.deltaY * unit * 0.0025);
      draw();
    },
    { passive: false }
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Home" || event.key === "Escape") {
      reset();
    } else if (event.key === "ArrowLeft") {
      view.yaw -= 5;
    } else if (event.key === "ArrowRight") {
      view.yaw += 5;
    } else if (event.key === "ArrowUp") {
      view.pitch = Math.min(89, view.pitch + 5);
    } else if (event.key === "ArrowDown") {
      view.pitch = Math.max(-89, view.pitch - 5);
    } else if (event.key === "+" || event.key === "=") {
      travel(0.3);
    } else if (event.key === "-") {
      travel(-0.3);
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
